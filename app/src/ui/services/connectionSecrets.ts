import { secretKeys, type SecureStore } from '../../core/storage/SecureStore.ts';
import {
  answerFor,
  entryKey,
  isFresh,
  parseDeviceRecord,
  pickValues,
  policyTtlMs,
  serializeDeviceRecord,
  type RememberPolicy,
  type RememberTarget,
  type RememberedEntry,
} from '../../session/credentials/rememberedParams.ts';

/** `ConnectionSecrets.bind`: what the session screen gets (`CredentialMemory` + policy). */
export interface BoundConnectionSecrets {
  readonly policy: RememberPolicy;
  recall(names: readonly string[]): Promise<Record<string, string> | null>;
  remember(names: readonly string[], values: Readonly<Record<string, string>>): void;
  forget(names: readonly string[]): void;
}

export interface ConnectionSecretsOptions {
  readonly secure: SecureStore;
  /**
   * Resolves true when a secret stored on the device may be used now. The app passes
   * `AuthService.mayUseStoredSecret` (start-up check, app lock, credential gate), the same
   * gate as saved server passwords (SRV-6(b)).
   */
  readonly mayUseStored: () => Promise<boolean>;
  /**
   * Resolves once stored secrets may be looked at (the start-up "sign out after …" check
   * has run), without any prompt. The app passes `AuthService.storedSecretsReady`.
   */
  readonly storedReady?: () => Promise<void>;
  /**
   * The device check before a remembered value is released, when the session asks for one
   * ("Ask for Face ID / fingerprint …"). `label` names the connection in the prompt. The
   * app passes `LockService.confirmPresence`. Without it, no check is made.
   */
  readonly confirm?: (label: string) => Promise<boolean>;
  readonly now?: () => number;
}

/**
 * Remembered answers to the server's connection prompt (SRV-11), per server profile and
 * connection. "Saved on this device" keeps them in the secure store (Keychain / Keystore,
 * `secretKeys.connectionPasswords`, so every path that deletes a profile's secrets deletes
 * them too); every other policy keeps them in memory only, for this run of the app.
 *
 * The policy is passed in on every call (it is an app setting). Values are never logged.
 */
export class ConnectionSecrets {
  private readonly secure: SecureStore;
  private readonly mayUseStored: () => Promise<boolean>;
  private readonly storedReady: () => Promise<void>;
  private readonly confirm: (label: string) => Promise<boolean>;
  private readonly now: () => number;
  /** profile id → entry key → entry (memory policies). */
  private readonly memory = new Map<string, Map<string, RememberedEntry>>();
  /** Read-modify-write of the secure-store records, one at a time. */
  private queue: Promise<unknown> = Promise.resolve();
  /** Fires `prune` when the earliest memory entry runs out (`schedulePrune`). */
  private pruneTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: ConnectionSecretsOptions) {
    this.secure = opts.secure;
    this.mayUseStored = opts.mayUseStored;
    this.storedReady = opts.storedReady ?? (() => Promise.resolve());
    const confirm = opts.confirm;
    this.confirm = confirm ? (label) => confirm(label).catch(() => false) : async () => true;
    this.now = opts.now ?? (() => Date.now());
  }

  /**
   * Remembered values for every requested name, or null (then the user is asked).
   *
   * `confirmAs` (the connection's name): release the values only after the device check
   * ("Ask for Face ID / fingerprint …"). The check is made only when there is something to
   * fill, before anything is returned; for a value saved on the device it comes before the
   * app-lock gate, which a successful check satisfies (one prompt, naming the connection).
   * A cancelled or failed check returns null and keeps the value (the user types it this
   * time). The entry is looked up again after the check: it may have expired or been
   * forgotten while the prompt was showing.
   */
  async recall(
    policy: RememberPolicy,
    profileId: string,
    target: RememberTarget,
    names: readonly string[],
    confirmAs?: string,
  ): Promise<Record<string, string> | null> {
    this.prune(policy);
    if (policy === 'never') return null;
    const key = entryKey(target, names);
    const inMemory = (): Record<string, string> | null => {
      const mem = this.memory.get(profileId)?.get(key);
      return mem ? answerFor(mem, names) : null;
    };
    if (inMemory()) {
      if (confirmAs !== undefined && !(await this.confirm(confirmAs))) return null;
      this.prune(policy);
      const mem = this.memory.get(profileId)?.get(key);
      const answer = mem ? answerFor(mem, names) : null;
      if (mem && answer) {
        // Time limits count from the last use.
        this.memory.get(profileId)?.set(key, { ...mem, at: this.now() });
        this.schedulePrune(policy);
        return answer;
      }
    }
    if (policy !== 'device') return null;
    await this.storedReady();
    const saved = (await this.read(profileId)).get(key);
    if (!saved || !answerFor(saved, names)) return null;
    if (confirmAs !== undefined && !(await this.confirm(confirmAs))) return null;
    // Only after the lock / biometric gate, as for a saved server password.
    if (!(await this.mayUseStored())) return null;
    if (confirmAs === undefined) return answerFor(saved, names);
    const again = (await this.read(profileId)).get(key);
    return again ? answerFor(again, names) : null;
  }

  /** Keeps values the user typed (after the connection succeeded). */
  async remember(
    policy: RememberPolicy,
    profileId: string,
    target: RememberTarget,
    names: readonly string[],
    values: Readonly<Record<string, string | undefined>>,
  ): Promise<void> {
    this.prune(policy);
    if (policy === 'never') return;
    const key = entryKey(target, names);
    const entry: RememberedEntry = { values: pickValues(names, values), at: this.now() };
    if (policy !== 'device') {
      let m = this.memory.get(profileId);
      if (!m) {
        m = new Map();
        this.memory.set(profileId, m);
      }
      m.set(key, entry);
      this.schedulePrune(policy);
      return;
    }
    this.memory.get(profileId)?.delete(key);
    await this.update(profileId, (record) => {
      const prev = record.get(key);
      if (prev && sameValues(prev.values, entry.values)) return false;
      record.set(key, entry);
      return true;
    });
  }

  /** Forgets one connection's values for these names (rejected, or "Remember" unticked). */
  async forget(profileId: string, target: RememberTarget, names: readonly string[]): Promise<void> {
    const key = entryKey(target, names);
    this.memory.get(profileId)?.delete(key);
    await this.update(profileId, (record) => record.delete(key));
  }

  /** Forgets what is kept in memory for a server (sign-out). The device record stays. */
  forgetMemory(profileId: string): void {
    this.memory.delete(profileId);
  }

  /** "Forget remembered connection passwords": memory and device, for these servers. */
  async forgetAll(profileIds: readonly string[]): Promise<void> {
    this.memory.clear();
    await this.serial(async () => {
      for (const id of profileIds) {
        await this.secure.remove(secretKeys.connectionPasswords(id)).catch(() => undefined);
      }
    });
  }

  /**
   * The setting changed: "Never" forgets everything; any choice other than "Saved on this
   * device" deletes what was saved on the device (memory entries follow the new limit).
   */
  async applyPolicy(policy: RememberPolicy, profileIds: readonly string[]): Promise<void> {
    if (policy === 'never') {
      await this.forgetAll(profileIds);
      return;
    }
    this.prune(policy);
    if (policy === 'device') return;
    await this.serial(async () => {
      for (const id of profileIds) {
        await this.secure.remove(secretKeys.connectionPasswords(id)).catch(() => undefined);
      }
    });
  }

  /**
   * The store bound to one session's server and connection, for the session screen. The
   * address is read at each use (`server`), so values never go to a server whose address
   * changed; the last known one is kept only to forget a rejected value.
   */
  bind(opts: {
    readonly profileId: string;
    readonly policy: RememberPolicy;
    readonly server: () => string | undefined;
    readonly connection: Omit<RememberTarget, 'server'>;
    /** Set (the connection's name) when values are released only after the device check. */
    readonly confirmAs?: string;
  }): BoundConnectionSecrets {
    let known: RememberTarget | null = null;
    const where = (): RememberTarget | null => {
      const server = opts.server();
      if (!server) return null;
      known = { ...opts.connection, server };
      return known;
    };
    const { profileId, policy, confirmAs } = opts;
    return {
      policy,
      recall: async (names) => {
        const at = where();
        return at ? this.recall(policy, profileId, at, names, confirmAs) : null;
      },
      remember: (names, values) => {
        const at = where();
        if (at) void this.remember(policy, profileId, at, names, values).catch(() => undefined);
      },
      forget: (names) => {
        const at = where() ?? known;
        if (at) void this.forget(profileId, at, names).catch(() => undefined);
      },
    };
  }

  /** Number of connections with values in memory (tests, diagnostics: never the values). */
  memoryCount(): number {
    let n = 0;
    for (const m of this.memory.values()) n += m.size;
    return n;
  }

  /** Drops expired memory entries, so values do not linger after their time. */
  private prune(policy: RememberPolicy): void {
    const now = this.now();
    for (const [id, m] of this.memory) {
      for (const [k, e] of m) if (!isFresh(e, policy, now)) m.delete(k);
      if (m.size === 0) this.memory.delete(id);
    }
    this.schedulePrune(policy);
  }

  /**
   * Prunes again when the earliest memory entry expires: without it, a value typed once and
   * never used again would stay in memory for the rest of the run.
   */
  private schedulePrune(policy: RememberPolicy): void {
    if (this.pruneTimer !== null) clearTimeout(this.pruneTimer);
    this.pruneTimer = null;
    const due = nextExpiry(this.memory, policy);
    if (due === null) return;
    this.pruneTimer = setTimeout(
      () => {
        this.pruneTimer = null;
        this.prune(policy);
      },
      Math.max(0, due - this.now()) + 50,
    );
  }

  private async read(profileId: string): Promise<Map<string, RememberedEntry>> {
    const raw = await this.secure.get(secretKeys.connectionPasswords(profileId)).catch(() => null);
    return parseDeviceRecord(raw);
  }

  /** `change` returns whether it changed the record. */
  private update(
    profileId: string,
    change: (record: Map<string, RememberedEntry>) => boolean,
  ): Promise<void> {
    return this.serial(async () => {
      const key = secretKeys.connectionPasswords(profileId);
      const raw = await this.secure.get(key).catch(() => null);
      if (raw === null) {
        const fresh = new Map<string, RememberedEntry>();
        if (!change(fresh) || fresh.size === 0) return;
        await this.secure.set(key, serializeDeviceRecord(fresh)).catch(() => undefined);
        return;
      }
      const record = parseDeviceRecord(raw);
      if (!change(record)) return;
      if (record.size === 0) await this.secure.remove(key).catch(() => undefined);
      else await this.secure.set(key, serializeDeviceRecord(record)).catch(() => undefined);
    });
  }

  private serial(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }
}

/**
 * When the first memory entry expires under `policy` (ms since the epoch), or null when
 * none ever does (no time limit, or nothing kept). Pure.
 */
export function nextExpiry(
  memory: ReadonlyMap<string, ReadonlyMap<string, RememberedEntry>>,
  policy: RememberPolicy,
): number | null {
  const ttl = policyTtlMs(policy);
  if (ttl === null || ttl === 0) return null;
  let first: number | null = null;
  for (const m of memory.values()) {
    for (const e of m.values()) {
      const end = e.at + ttl;
      if (first === null || end < first) first = end;
    }
  }
  return first;
}

function sameValues(
  a: Readonly<Record<string, string>>,
  b: Readonly<Record<string, string>>,
): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}
