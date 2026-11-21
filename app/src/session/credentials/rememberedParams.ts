/**
 * Remembered answers to the server's `required` prompt (SRV-11): the policy ("Remember
 * connection passwords"), the keys values are filed under, expiry, the record kept in the
 * secure store, and the per-attempt guard that stops an auto-answer loop.
 *
 * Pure: no DOM, no storage, no clock of its own (callers pass `now`). Values are never
 * logged by this module.
 */

/**
 * How long typed connection parameters are remembered. Time limits count from the last
 * use; every choice except `device` keeps the values in memory only.
 */
export type RememberPolicy = 'never' | '5m' | '15m' | '1h' | 'app' | 'device';

export const REMEMBER_POLICIES: readonly RememberPolicy[] = [
  'never',
  '5m',
  '15m',
  '1h',
  'app',
  'device',
];

/**
 * Default: saved on this device (Keychain / Keystore), released by the device check where
 * one is set up. It ends the repeated prompt on every reconnect and survives restarts and
 * updates; the owner chose it over "until closed" (2026-11-21). The prompt's Remember box
 * still lets the user decline for one connection.
 */
export const DEFAULT_REMEMBER_POLICY: RememberPolicy = 'device';

export function parseRememberPolicy(raw: unknown): RememberPolicy {
  return REMEMBER_POLICIES.includes(raw as RememberPolicy)
    ? (raw as RememberPolicy)
    : DEFAULT_REMEMBER_POLICY;
}

/**
 * "Ask for Face ID / fingerprint before filling a remembered connection password": a
 * device check (biometrics or the device passcode) each time a remembered value is about
 * to be sent. `auto` (the default) = on for "On this device", off for the memory-only
 * choices; `on` / `off` = the user's own choice, for every policy.
 */
export type RememberUnlock = 'auto' | 'on' | 'off';

export const DEFAULT_REMEMBER_UNLOCK: RememberUnlock = 'auto';

export function parseRememberUnlock(raw: unknown): RememberUnlock {
  return raw === 'auto' || raw === 'on' || raw === 'off' ? raw : DEFAULT_REMEMBER_UNLOCK;
}

/**
 * Whether remembered values are released only after a device check. `deviceCheck`: the
 * device has biometrics or a passcode (false on the web build or with nothing set up:
 * then there is no check, and Settings shows the toggle disabled with a hint).
 */
export function rememberUnlockOn(
  setting: RememberUnlock,
  policy: RememberPolicy,
  deviceCheck = true,
): boolean {
  if (!deviceCheck || policy === 'never') return false;
  return setting === 'on' || (setting === 'auto' && policy === 'device');
}

/** Whether the prompt offers "Remember for this connection" (null: nothing can be kept). */
export function offersRemember(
  policy: RememberPolicy | null | undefined,
): policy is Exclude<RememberPolicy, 'never'> {
  return policy !== null && policy !== undefined && policy !== 'never';
}

const MINUTE = 60_000;

/** How long an entry stays valid after its last use: 0 = never kept, null = no time limit. */
export function policyTtlMs(policy: RememberPolicy): number | null {
  switch (policy) {
    case 'never':
      return 0;
    case '5m':
      return 5 * MINUTE;
    case '15m':
      return 15 * MINUTE;
    case '1h':
      return 60 * MINUTE;
    case 'app':
    case 'device':
      return null;
  }
}

/** The connection the values were typed for. Values are only ever offered to this one. */
export interface RememberTarget {
  /**
   * The Guacamole server's address (the signed-in base URL). Part of the key as a second
   * fence besides the profile id: values typed for one address never match another.
   */
  readonly server: string;
  readonly dataSource: string;
  /** `c` connection, `g` balancing group. */
  readonly type: string;
  readonly identifier: string;
}

/** Key of one connection within a server profile. */
export function connectionKey(t: RememberTarget): string {
  return JSON.stringify([t.server, t.dataSource, t.type, t.identifier]);
}

/** The requested parameter names, de-duplicated and sorted (order does not matter). */
export function normalizeNames(names: readonly string[]): string[] {
  return [...new Set(names.filter((n) => typeof n === 'string' && n !== ''))].sort();
}

/** Key of one set of requested parameters of one connection. */
export function entryKey(t: RememberTarget, names: readonly string[]): string {
  return `${connectionKey(t)}\n${normalizeNames(names).join('\n')}`;
}

export interface RememberedEntry {
  /** Values by parameter name; an empty string is a stored answer (e.g. no domain). */
  readonly values: Readonly<Record<string, string>>;
  /** Last use (remembered or answered with), ms since the epoch. */
  readonly at: number;
}

/** Whether an entry may still be used under `policy` at `now`. */
export function isFresh(entry: RememberedEntry, policy: RememberPolicy, now: number): boolean {
  const ttl = policyTtlMs(policy);
  if (ttl === 0) return false;
  if (ttl === null) return true;
  // A clock that went backwards is treated as expired, not as "used in the future".
  return now >= entry.at && now - entry.at < ttl;
}

/** The answer for every requested name, or null when any one is missing. */
export function answerFor(
  entry: RememberedEntry,
  names: readonly string[],
): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const n of normalizeNames(names)) {
    const v = entry.values[n];
    if (typeof v !== 'string') return null;
    out[n] = v;
  }
  return names.length > 0 ? out : null;
}

/** Only the requested names, as strings. */
export function pickValues(
  names: readonly string[],
  values: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of normalizeNames(names)) out[n] = values[n] ?? '';
  return out;
}

// ---- the record in the secure store (one per server profile) ------------------------------

/** At most this many entries per server profile; the least recently used go first. */
export const MAX_DEVICE_ENTRIES = 64;

/** Entries by `entryKey`, read from untrusted stored JSON (bad parts are dropped). */
export function parseDeviceRecord(raw: string | null): Map<string, RememberedEntry> {
  const out = new Map<string, RememberedEntry>();
  if (raw === null || raw === '') return out;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return out;
  }
  if (typeof data !== 'object' || data === null) return out;
  const entries = (data as { entries?: unknown }).entries;
  if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) return out;
  for (const [key, e] of Object.entries(entries as Record<string, unknown>)) {
    if (typeof e !== 'object' || e === null) continue;
    const at = (e as { at?: unknown }).at;
    const values = (e as { values?: unknown }).values;
    if (typeof at !== 'number' || !Number.isFinite(at)) continue;
    if (typeof values !== 'object' || values === null || Array.isArray(values)) continue;
    const clean: Record<string, string> = {};
    for (const [n, v] of Object.entries(values as Record<string, unknown>)) {
      if (typeof v === 'string') clean[n] = v;
    }
    out.set(key, { at, values: clean });
  }
  return out;
}

export function serializeDeviceRecord(entries: ReadonlyMap<string, RememberedEntry>): string {
  const kept = [...entries.entries()]
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX_DEVICE_ENTRIES);
  return JSON.stringify({ v: 1, entries: Object.fromEntries(kept) });
}

// ---- loop guard (one per connection attempt) ---------------------------------------------

/**
 * guacd's status codes for "the remote computer refused the credentials": RDP reports
 * CLIENT_UNAUTHORIZED (0x0301) for a failed sign-in, CLIENT_FORBIDDEN (0x0303) for a
 * denied one (`statusMessage` in `ui/session/status.ts`, source `client`).
 */
export function isCredentialRejection(code: number): boolean {
  return code === 0x0301 || code === 0x0303;
}

export interface RequiredStep {
  /** `recall`: try remembered values first; `prompt`: ask the user. */
  readonly action: 'recall' | 'prompt';
  /** Remembered values that the server has just rejected: forget them (empty = nothing). */
  readonly forget: readonly (readonly string[])[];
}

export interface Answer {
  readonly names: readonly string[];
  readonly values: Readonly<Record<string, string>>;
}

/**
 * Per connection attempt: which parameters were answered, how, and what to remember or
 * forget once the attempt is decided.
 *
 * - A parameter is answered automatically at most once per attempt. If the server asks for
 *   one again, the remembered answer was rejected: it is forgotten and the user is asked.
 * - Typed values (with "Remember" ticked) are kept only once the attempt reaches the
 *   remote desktop, so a mistyped password is never remembered.
 * - An attempt that answered automatically and then ended before the remote desktop was
 *   shown (guacd reported an error, or the server closed it) forgets that answer; a
 *   network drop reported by the tunnel does not.
 */
export class RequiredAnswerGuard {
  private answered = new Set<string>();
  private auto: Answer[] = [];
  private typed: Answer[] = [];
  /**
   * Names answered when this attempt connected. Names only: the values are not needed
   * afterwards and must not outlive their time limit in this session's memory.
   */
  private committed: (readonly string[])[] = [];
  private refused = false;
  private connectedOnce = false;

  /** A new connection attempt. */
  begin(): void {
    this.answered = new Set();
    this.auto = [];
    this.typed = [];
    this.committed = [];
    this.refused = false;
    this.connectedOnce = false;
  }

  onRequired(names: readonly string[]): RequiredStep {
    const asked = normalizeNames(names);
    const repeat = asked.some((n) => this.answered.has(n));
    if (!repeat) return { action: 'recall', forget: [] };
    const rejected = this.auto.filter((a) => a.names.some((n) => asked.includes(n)));
    this.auto = this.auto.filter((a) => !rejected.includes(a));
    return { action: 'prompt', forget: rejected.map((a) => a.names) };
  }

  /** Remembered values were sent. */
  answeredAutomatically(names: readonly string[], values: Readonly<Record<string, string>>): void {
    const n = normalizeNames(names);
    for (const x of n) this.answered.add(x);
    this.auto.push({ names: n, values });
  }

  /**
   * The user typed values. Returns the names whose remembered values must be forgotten
   * now (the user unticked "Remember"), or null.
   */
  answeredByUser(
    names: readonly string[],
    values: Readonly<Record<string, string>>,
    remember: boolean,
  ): readonly string[] | null {
    const n = normalizeNames(names);
    for (const x of n) this.answered.add(x);
    this.typed = this.typed.filter((a) => a.names.join('\n') !== n.join('\n'));
    if (!remember) return n;
    // Nothing worth remembering when every field was left empty.
    if (Object.values(values).some((v) => v !== '')) this.typed.push({ names: n, values });
    return null;
  }

  /**
   * guacd reported an error (`error` instruction) during this attempt. A credential
   * rejection (CLIENT_UNAUTHORIZED / CLIENT_FORBIDDEN from guacd) forgets at once whatever
   * this attempt answered, also after `connected()`: the library reports "connected" at the
   * first frame, which a server may send before the remote computer has checked the
   * credentials. Returns the answers to forget now.
   */
  serverError(code: number): (readonly string[])[] {
    if (!this.connectedOnce) this.refused = true;
    if (!isCredentialRejection(code)) return [];
    const out = [...this.committed, ...this.auto.map((a) => a.names)];
    this.committed = [];
    this.auto = [];
    this.typed = [];
    return out;
  }

  /** The remote desktop is shown: what to remember (typed) and refresh (answered with). */
  connected(): Answer[] {
    if (this.connectedOnce) return [];
    this.connectedOnce = true;
    const out = [...this.typed, ...this.auto];
    this.committed = out.map((a) => a.names);
    this.typed = [];
    this.auto = [];
    return out;
  }

  /**
   * The attempt ended without being closed by the app. `networkDrop`: the tunnel reported
   * a connection loss (not guacd). Returns the remembered answers to forget.
   */
  ended(networkDrop: boolean): (readonly string[])[] {
    this.typed = [];
    if (this.connectedOnce || (networkDrop && !this.refused)) {
      this.auto = [];
      return [];
    }
    const out = this.auto.map((a) => a.names);
    this.auto = [];
    return out;
  }
}
