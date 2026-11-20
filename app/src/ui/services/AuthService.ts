import { isGuacApiError } from '../../core/api/errors.ts';
import type { GuacApi } from '../../core/api/GuacApi.ts';
import type { Logger } from '../../core/diagnostics/log.ts';
import { FieldType } from '../../core/models/ApiErrorBody.ts';
import type { AuthSession } from '../../core/models/AuthSession.ts';
import type { ServerProfile } from '../../core/models/ServerProfile.ts';
import type { ProfileStore } from '../../core/storage/ProfileStore.ts';
import { secretKeys, type SecureStore } from '../../core/storage/SecureStore.ts';
import {
  parseTotpInput,
  totpAt,
  totpCounter,
  waitForFreshCode,
  type TotpParams,
} from '../../core/totp/totp.ts';
import { isShareServerId } from './shareSessions.ts';

/**
 * Session tokens and saved credentials per server (SRV-3, SRV-4, SRV-6, SRV-9). Keeps the
 * live `AuthSession` in memory and the token/password/TOTP seed in `SecureStore`.
 *
 * Every read of a saved password or TOTP seed for signing in goes through the credential
 * gate (the biometric lock, when on). That makes this class the one choke point for
 * SRV-6(b): silent re-login, reconnects and deep links all pass here.
 */
export interface SavedSecrets {
  readonly token: string | null;
  readonly password: string | null;
  /** A saved password exists but the gate refused it (the user cancelled the unlock). */
  readonly lockedOut?: boolean;
}

export interface LoginRequest {
  readonly username: string;
  readonly password: string;
  readonly remember: boolean;
  readonly extra: Readonly<Record<string, string>>;
}

/** Outcome of re-validating a server's session before reconnecting. */
export type RevalidateResult = 'ok' | 'relogged' | 'needs-sign-in';

export type CredentialGate = () => Promise<boolean>;

/** Enough of a session to call `DELETE api/session` with a stored token. */
export function tokenOnlySession(baseUrl: string, token: string): AuthSession {
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    token,
    username: '',
    primaryDataSource: '',
    dataSources: [''],
  };
}

export class AuthService {
  private readonly api: GuacApi;
  private readonly secure: SecureStore;
  private readonly profiles: ProfileStore;
  private readonly log: Logger | undefined;
  private readonly sessions = new Map<string, AuthSession>();
  /** Secrets for virtual profiles (the dev server) that are not in `ProfileStore`. */
  private readonly virtualPasswords = new Map<string, string>();
  /** A password typed in the server form but not remembered, used once for the first sign-in. */
  private readonly transientPasswords = new Map<string, string>();
  /** The last TOTP time step sent per server; the server refuses a reused code. */
  private readonly lastTotpCounter = new Map<string, number>();
  /** Servers where the user agreed to send credentials over plain http in this run. */
  private readonly httpConfirmed = new Set<string>();
  private gate: CredentialGate | undefined;
  /** Waits while the app lock is shown; every use of a stored secret passes it. */
  private unlocked: () => Promise<void> = () => Promise.resolve();
  private readonly listeners = new Set<(profileId: string) => void>();

  constructor(api: GuacApi, secure: SecureStore, profiles: ProfileStore, log?: Logger) {
    this.api = api;
    this.secure = secure;
    this.profiles = profiles;
    this.log = log;
  }

  /** Installs the biometric gate (SRV-6). Without one, saved credentials are used freely. */
  setCredentialGate(gate: CredentialGate | undefined): void {
    this.gate = gate;
  }

  /**
   * Installs the wait for the app lock (AUDIT #3): stored tokens, passwords and TOTP seeds
   * are not read, and no silent re-login or token check runs, while the lock screen is up.
   */
  setUnlockWaiter(wait: () => Promise<void>): void {
    this.unlocked = wait;
  }

  /** Called when a server's session changes (signed in, out, or expired). */
  onSessionChange(fn: (profileId: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Registers a fixed password for a virtual profile (dev server from .env.local). */
  setVirtualPassword(profileId: string, password: string): void {
    this.virtualPasswords.set(profileId, password);
  }

  /** Hands a not-remembered password from the server form to the first sign-in. */
  setTransientPassword(profileId: string, password: string): void {
    this.transientPasswords.set(profileId, password);
  }

  markHttpConfirmed(profileId: string): void {
    this.httpConfirmed.add(profileId);
  }

  isHttpConfirmed(profileId: string): boolean {
    return this.httpConfirmed.has(profileId);
  }

  current(profileId: string): AuthSession | undefined {
    return this.sessions.get(profileId);
  }

  async loadToken(profileId: string): Promise<string | null> {
    // Share-link sessions are memory only (CON-6): their "stored" token is the live one, so
    // the sign-in flow resumes it instead of showing a password form.
    if (isShareServerId(profileId)) return this.sessions.get(profileId)?.token ?? null;
    await this.unlocked();
    return this.secure.get(secretKeys.authToken(profileId)).catch(() => null);
  }

  /** Whether a password is saved, without using it (no gate, no prompt). */
  async hasSavedPassword(profile: ServerProfile): Promise<boolean> {
    if (!profile.rememberPassword) return false;
    const pw = await this.secure.get(secretKeys.password(profile.id)).catch(() => null);
    return pw !== null && pw.length > 0;
  }

  async loadSecrets(profile: ServerProfile): Promise<SavedSecrets> {
    const token = await this.loadToken(profile.id);
    const virtual = this.virtualPasswords.get(profile.id);
    if (virtual !== undefined) return { token, password: virtual || null };
    const transient = this.transientPasswords.get(profile.id);
    if (transient !== undefined) {
      this.transientPasswords.delete(profile.id);
      return { token, password: transient || null };
    }
    if (!(await this.hasSavedPassword(profile))) return { token, password: null };
    await this.unlocked();
    if (this.gate && !(await this.gate())) {
      this.log?.info('auth', 'saved password not used: unlock cancelled');
      return { token, password: null, lockedOut: true };
    }
    const password = await this.secure.get(secretKeys.password(profile.id)).catch(() => null);
    return { token, password: password && password.length > 0 ? password : null };
  }

  /** Re-validates the stored token. Rejects with `GuacApiError` (`session-expired`, …). */
  async resume(profile: ServerProfile, token: string): Promise<AuthSession> {
    await this.unlocked();
    const live = this.sessions.get(profile.id);
    if (live && live.token === token) return live;
    try {
      const session = await this.api.resumeSession(profile, token);
      this.sessions.set(profile.id, session);
      this.log?.info('auth', 'stored session resumed');
      this.emit(profile.id);
      return session;
    } catch (err) {
      // Only a token the server rejected is dropped; a network failure (VPN not up yet)
      // keeps it for the next attempt (SRV-4).
      if (isGuacApiError(err, 'session-expired')) await this.forgetToken(profile.id);
      throw err;
    }
  }

  async login(profile: ServerProfile, req: LoginRequest): Promise<AuthSession> {
    await this.unlocked();
    const session = await this.api.login(
      profile,
      { username: req.username, password: req.password },
      req.extra,
    );
    await this.adopt(profile.id, session);
    if (!this.virtualPasswords.has(profile.id)) {
      if (req.remember) {
        await this.secure.set(secretKeys.password(profile.id), req.password).catch(() => undefined);
      } else {
        await this.secure.remove(secretKeys.password(profile.id)).catch(() => undefined);
      }
      if (profile.username !== req.username || profile.rememberPassword !== req.remember) {
        await this.profiles
          .update(profile.id, { username: req.username, rememberPassword: req.remember })
          .catch(() => undefined);
      }
    }
    return session;
  }

  /**
   * Signs in with parameters only: an SSO result or a share-link `key` (SRV-7, CON-6).
   * For a share-link profile (`isShareServerId`) the session stays in memory only.
   */
  async loginWithParameters(
    profile: ServerProfile,
    parameters: Readonly<Record<string, string>>,
  ): Promise<AuthSession> {
    await this.unlocked();
    const session = await this.api.loginWithParameters(profile, parameters);
    await this.adopt(profile.id, session);
    return session;
  }

  private async adopt(profileId: string, session: AuthSession): Promise<void> {
    this.sessions.set(profileId, session);
    this.log?.info('auth', `signed in (${session.dataSources.length} data source(s))`);
    if (isShareServerId(profileId)) {
      // A share key's session is never persisted (CON-6).
      this.emit(profileId);
      return;
    }
    // Storage failures must not turn a successful sign-in into an error: the session is
    // live in memory either way.
    await this.secure.set(secretKeys.authToken(profileId), session.token).catch(() => undefined);
    this.emit(profileId);
  }

  /** Drops a token the server no longer accepts. */
  async forgetToken(profileId: string): Promise<void> {
    const had = this.sessions.delete(profileId);
    if (isShareServerId(profileId)) {
      if (had) this.emit(profileId);
      return;
    }
    await this.secure.remove(secretKeys.authToken(profileId)).catch(() => undefined);
    if (had) this.emit(profileId);
  }

  /** Signs out on the server (best effort) and forgets the token. The saved password stays. */
  async logout(profileId: string): Promise<void> {
    const session = this.sessions.get(profileId);
    await this.forgetToken(profileId);
    if (session) await this.api.logout(session).catch(() => undefined);
  }

  /** Saves or clears the password from the server form. */
  async savePassword(profileId: string, password: string | null): Promise<void> {
    // Best effort: a storage failure only means the user is asked for the password later.
    if (password === null) {
      await this.secure.remove(secretKeys.password(profileId)).catch(() => undefined);
    } else {
      await this.secure.set(secretKeys.password(profileId), password).catch(() => undefined);
    }
  }

  /** "Clear saved credentials": password, token and TOTP seed. */
  async clearCredentials(profileId: string): Promise<void> {
    await this.logout(profileId);
    for (const key of secretKeys.all(profileId)) {
      await this.secure.remove(key).catch(() => undefined);
    }
  }

  /**
   * "Sign out of all servers": for every profile, removes the saved password, session token
   * and TOTP seed from this device, then asks each server to end its session (best effort,
   * in parallel; a stored token is used when no session is live). Local data is removed
   * first, so an unreachable server cannot keep anything on the device.
   * Returns how many servers confirmed the sign-out.
   */
  /**
   * Like `signOutEverywhere`, but returns as soon as everything is removed from this device;
   * the servers are told in the background (no wait for an unreachable server).
   */
  async signOutLocally(profiles: readonly ServerProfile[]): Promise<void> {
    await new Promise<void>((resolve) => {
      this.signOutEverywhere(profiles, resolve).catch(() => resolve());
    });
  }

  async signOutEverywhere(
    profiles: readonly ServerProfile[],
    onLocalDone?: () => void,
  ): Promise<{ serverSignOuts: number }> {
    const revoke: AuthSession[] = [];
    for (const p of profiles) {
      const live = this.sessions.get(p.id);
      const stored = isShareServerId(p.id)
        ? null
        : await this.secure.get(secretKeys.authToken(p.id)).catch(() => null);
      const token = live?.token ?? stored;
      if (token) revoke.push(live ?? tokenOnlySession(p.baseUrl, token));
      this.sessions.delete(p.id);
      this.transientPasswords.delete(p.id);
      this.lastTotpCounter.delete(p.id);
      for (const key of secretKeys.all(p.id)) {
        await this.secure.remove(key).catch(() => undefined);
      }
      this.emit(p.id);
    }
    this.log?.info('auth', `signed out of ${profiles.length} server(s) on this device`);
    onLocalDone?.();
    const results = await Promise.allSettled(revoke.map((s) => this.api.logout(s)));
    return { serverSignOuts: results.filter((r) => r.status === 'fulfilled').length };
  }

  /**
   * Called when a profile's address (scheme, host, port or path) changes or it is deleted.
   * Signs out on the old host with the live session, then drops every secret tied to the old
   * endpoint (token, saved password, TOTP seed) and this run's http confirmation, so nothing
   * saved for the old host can be sent to the new one (AUDIT #2).
   */
  async reset(profileId: string): Promise<void> {
    await this.logout(profileId);
    this.transientPasswords.delete(profileId);
    this.lastTotpCounter.delete(profileId);
    this.httpConfirmed.delete(profileId);
    for (const key of secretKeys.all(profileId)) {
      await this.secure.remove(key).catch(() => undefined);
    }
  }

  // ---- TOTP seed (SRV-9) -----------------------------------------------------------------

  async hasTotpSeed(profileId: string): Promise<boolean> {
    return (await this.secure.get(secretKeys.totpSeed(profileId)).catch(() => null)) !== null;
  }

  async saveTotpSeed(profileId: string, serialized: string | null): Promise<void> {
    if (serialized === null) await this.secure.remove(secretKeys.totpSeed(profileId));
    else await this.secure.set(secretKeys.totpSeed(profileId), serialized);
  }

  /** The stored seed, after the credential gate. `undefined` if none or refused. */
  async loadTotpSeed(profileId: string): Promise<TotpParams | undefined> {
    const raw = await this.secure.get(secretKeys.totpSeed(profileId)).catch(() => null);
    if (raw === null) return undefined;
    await this.unlocked();
    if (this.gate && !(await this.gate())) return undefined;
    try {
      return parseTotpInput(raw);
    } catch {
      return undefined;
    }
  }

  /**
   * A code that the server will accept now: if the current time step was already used
   * from this app, waits for the next one (the TOTP extension refuses reused codes).
   * `onWait` reports the wait in ms before it starts.
   */
  async freshTotpCode(
    profileId: string,
    seed: TotpParams,
    onWait?: (ms: number) => void,
    now: () => number = () => Date.now(),
  ): Promise<string> {
    const wait = waitForFreshCode(this.lastTotpCounter.get(profileId), now(), seed.period);
    if (wait > 0) {
      onWait?.(wait);
      await new Promise((r) => setTimeout(r, wait + 250));
    }
    return totpAt(seed, now());
  }

  lastTotpCounterFor(profileId: string): number | undefined {
    return this.lastTotpCounter.get(profileId);
  }

  /** Records that the code for `atMs` was sent. */
  noteTotpUsed(profileId: string, period: number, atMs: number = Date.now()): void {
    this.lastTotpCounter.set(profileId, totpCounter(atMs, period));
  }

  // ---- re-validation for open sessions (T2.1) ---------------------------------------------

  /**
   * Before reconnecting a session: checks the token; if it expired, signs in again silently
   * with the saved password (and a TOTP code from the stored seed when the server asks and
   * autofill is on). Never sends a password over plain http unless `httpAllowed`.
   * Network failures reject, so the caller can show the session's own error.
   */
  async revalidate(
    profile: ServerProfile,
    opts: { readonly httpAllowed: boolean; readonly totpAutofill: boolean },
  ): Promise<RevalidateResult> {
    await this.unlocked();
    const live = this.sessions.get(profile.id);
    if (live && (await this.api.isSessionValid(live))) return 'ok';
    if (isShareServerId(profile.id)) {
      // A share key cannot be replayed silently; the user opens the link again.
      if (live) await this.forgetToken(profile.id);
      return 'needs-sign-in';
    }
    if (!live) {
      const token = await this.loadToken(profile.id);
      if (token) {
        try {
          await this.resume(profile, token);
          return 'ok';
        } catch (err) {
          if (!isGuacApiError(err, 'session-expired')) throw err;
        }
      }
    } else {
      this.log?.info('auth', 'token expired while sessions were open');
      await this.forgetToken(profile.id);
    }
    if (!opts.httpAllowed) return 'needs-sign-in';
    const { password } = await this.loadSecrets(profile);
    if (!password) return 'needs-sign-in';
    const req: LoginRequest = {
      username: profile.username,
      password,
      remember: true,
      extra: {},
    };
    try {
      await this.login(profile, req);
      return 'relogged';
    } catch (err) {
      if (!isGuacApiError(err, 'additional-credentials-required') || !opts.totpAutofill) {
        if (isGuacApiError(err) && err.info.kind !== 'unreachable' && err.info.kind !== 'tls') {
          return 'needs-sign-in';
        }
        throw err;
      }
      const info = err.info;
      const expected = info.kind === 'additional-credentials-required' ? info.expected : [];
      const field = expected.find((f) => f.type === FieldType.GUAC_TOTP_CODE);
      const seed = field ? await this.loadTotpSeed(profile.id) : undefined;
      if (!field || !seed) return 'needs-sign-in';
      const code = await this.freshTotpCode(profile.id, seed);
      this.noteTotpUsed(profile.id, seed.period);
      try {
        await this.login(profile, { ...req, extra: { [field.name]: code } });
        return 'relogged';
      } catch {
        return 'needs-sign-in';
      }
    }
  }

  private emit(profileId: string): void {
    for (const l of this.listeners) l(profileId);
  }
}
