import { NEW_PASSWORD_FIELD } from '../../core/api/authFields.ts';
import { GuacApiError, isGuacApiError } from '../../core/api/errors.ts';
import type { GuacApi } from '../../core/api/GuacApi.ts';
import type { Logger } from '../../core/diagnostics/log.ts';
import { FieldType } from '../../core/models/ApiErrorBody.ts';
import type { AuthSession } from '../../core/models/AuthSession.ts';
import type { ServerProfile } from '../../core/models/ServerProfile.ts';
import type { ProfileStore } from '../../core/storage/ProfileStore.ts';
import type { KeyValueStore } from '../../core/storage/KeyValueStore.ts';
import { secretKeys, type SecureStore } from '../../core/storage/SecureStore.ts';
import {
  parseTotpInput,
  totpAt,
  totpCounter,
  waitForFreshCode,
  type TotpParams,
} from '../../core/totp/totp.ts';
import { findDuoRedirect } from '../../core/sso/sso.ts';
import { pinOrigin } from '../../core/tls/fingerprint.ts';
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
  /**
   * The app signed out of this server after its time in the background ("Sign out of
   * servers after …"): the saved password is not used until the user signs in once.
   */
  readonly signedOutInBackground?: boolean;
  /**
   * A new certificate was just trusted for this server's address (SRV-8): the saved password
   * is not sent over it until the user types it once (pre-release review R2).
   */
  readonly newCertificate?: boolean;
}

/** Why the saved password is held back until the user signs in once. */
export type PasswordRequiredReason = 'background' | 'certificate';

export interface LoginRequest {
  readonly username: string;
  readonly password: string;
  readonly remember: boolean;
  readonly extra: Readonly<Record<string, string>>;
}

/** Outcome of re-validating a server's session before reconnecting. */
export type RevalidateResult = 'ok' | 'relogged' | 'needs-sign-in';

export type CredentialGate = () => Promise<boolean>;

const passwordRequiredKey = (profileId: string): string => `auth/passwordRequired/${profileId}`;
/** Stored value of `passwordRequiredKey` for a newly trusted certificate ('1': background). */
const CERT_MARK = 'certificate';

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
  /** Servers whose last `revalidate` ended in `needs-sign-in` (`silentSignInFailed`). */
  private readonly silentSignInFailures = new Set<string>();
  private readonly passwordListeners = new Set<(profileId: string, password: string) => void>();
  private readonly backgroundSignOutListeners = new Set<(profileId: string) => void>();
  private readonly signedOutListeners = new Set<(profileId: string) => void>();
  /** Servers whose saved password is held back: known answer per id (`kv` is the truth). */
  private readonly passwordRequired = new Map<string, PasswordRequiredReason | null>();
  /** Whether an address has a trusted certificate (pin, saved or pending): `TlsTrustService`. */
  private pinned: (baseUrl: string) => boolean = () => false;
  private readonly kv: KeyValueStore | undefined;
  /** Start-up check ("Sign out of servers after …" while the app was not running). */
  private entry: Promise<void> = Promise.resolve();

  constructor(
    api: GuacApi,
    secure: SecureStore,
    profiles: ProfileStore,
    log?: Logger,
    kv?: KeyValueStore,
  ) {
    this.api = api;
    this.secure = secure;
    this.profiles = profiles;
    this.log = log;
    this.kv = kv;
  }

  /**
   * Holds every use of a stored token or password until `check` settles: the start-up
   * background sign-out must run before anything signs in with what it removes.
   */
  setEntryCheck(check: Promise<void>): void {
    this.entry = check.catch(() => undefined);
  }

  private async ready(): Promise<void> {
    await this.entry;
    await this.unlocked();
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

  /**
   * SRV-6(b) for other secrets stored on the device (SRV-11 remembered connection
   * passwords): waits like a saved password does (start-up check, app lock), then asks the
   * credential gate. True = the secret may be used now.
   */
  async mayUseStoredSecret(): Promise<boolean> {
    await this.ready();
    return this.gate ? this.gate() : true;
  }

  /**
   * The wait of `mayUseStoredSecret` without the credential gate: start-up check and app
   * lock. SRV-11 waits on it before its own named prompt, so it never asks for Face ID for
   * a value the start-up sign-out is about to delete.
   */
  storedSecretsReady(): Promise<void> {
    return this.ready();
  }

  /**
   * Called when the app signs out of a server: `logout`, "Clear saved credentials", an
   * address change or deletion (`reset`), "Sign out of all servers" and the background
   * sign-out. Used to drop what is remembered in memory for that server.
   */
  onSignedOut(fn: (profileId: string) => void): () => void {
    this.signedOutListeners.add(fn);
    return () => this.signedOutListeners.delete(fn);
  }

  private signedOut(profileId: string): void {
    for (const l of this.signedOutListeners) {
      try {
        l(profileId);
      } catch {
        // a listener must not stop a sign-out
      }
    }
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
    await this.ready();
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
    const required = await this.passwordRequiredReason(profile.id);
    if (required === 'certificate') return { token, password: null, newCertificate: true };
    if (required) return { token, password: null, signedOutInBackground: true };
    if (!(await this.hasSavedPassword(profile))) return { token, password: null };
    await this.ready();
    if (this.gate && !(await this.gate())) {
      this.log?.info('auth', 'saved password not used: unlock cancelled');
      return { token, password: null, lockedOut: true };
    }
    const password = await this.secure.get(secretKeys.password(profile.id)).catch(() => null);
    return { token, password: password && password.length > 0 ? password : null };
  }

  /** Re-validates the stored token. Rejects with `GuacApiError` (`session-expired`, …). */
  async resume(profile: ServerProfile, token: string): Promise<AuthSession> {
    await this.ready();
    const live = this.sessions.get(profile.id);
    if (live && live.token === token) return live;
    try {
      const session = await this.api.resumeSession(profile, token);
      this.sessions.set(profile.id, session);
      this.log?.info('auth', 'stored session resumed');
      void this.noteSystemTrust(profile);
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
    await this.ready();
    // A forced password change (`new-password`, database extension) is stored by the server
    // during this request, so the new password is the one to remember.
    const newPassword = req.extra[NEW_PASSWORD_FIELD] || undefined;
    let session: AuthSession;
    try {
      session = await this.api.login(
        profile,
        { username: req.username, password: req.password },
        req.extra,
      );
    } catch (err) {
      // The server went on to another step (TOTP) after the reset: the new password is
      // already in effect. Remember it now, so an interrupted sign-in does not leave the
      // old one saved (docs/protocol-notes.md §1.7).
      if (
        newPassword &&
        req.remember &&
        !this.virtualPasswords.has(profile.id) &&
        isGuacApiError(err, 'additional-credentials-required') &&
        err.info.kind === 'additional-credentials-required' &&
        !err.info.expected.some((f) => f.name === NEW_PASSWORD_FIELD) &&
        // Duo may run before the database extension: then nothing was reset yet.
        !findDuoRedirect(err.info.expected)
      ) {
        await this.secure.set(secretKeys.password(profile.id), newPassword).catch(() => undefined);
      }
      throw err;
    }
    void this.noteSystemTrust(profile);
    await this.adopt(profile.id, session);
    if (!this.virtualPasswords.has(profile.id)) {
      if (req.remember) {
        await this.secure
          .set(secretKeys.password(profile.id), newPassword ?? req.password)
          .catch(() => undefined);
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
    await this.ready();
    const session = await this.api.loginWithParameters(profile, parameters);
    void this.noteSystemTrust(profile);
    await this.adopt(profile.id, session);
    return session;
  }

  private async adopt(profileId: string, session: AuthSession): Promise<void> {
    this.sessions.set(profileId, session);
    // Signed in by the user: the saved password may be used silently again.
    await this.setPasswordRequired(profileId, false);
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
    this.signedOut(profileId);
    await this.forgetToken(profileId);
    if (session) await this.api.logout(session).catch(() => undefined);
  }

  /** Called after the account password changed through the app (not at sign-in). */
  onPasswordChange(fn: (profileId: string, password: string) => void): () => void {
    this.passwordListeners.add(fn);
    return () => this.passwordListeners.delete(fn);
  }

  /** Whether the signed-in account may change its own password (`GuacApi.canChangePassword`). */
  async canChangePassword(profileId: string): Promise<boolean> {
    const session = this.sessions.get(profileId);
    if (!session || isShareServerId(profileId)) return false;
    return this.api.canChangePassword(session);
  }

  /**
   * Changes the account password on the server with the live session, then replaces a
   * password saved on this device so silent sign-in keeps working. Rejects with
   * `GuacApiError` (`invalid-credentials` = wrong current password). Returns whether a saved
   * password was updated.
   */
  async changePassword(
    profile: ServerProfile,
    oldPassword: string,
    newPassword: string,
  ): Promise<{ readonly savedUpdated: boolean }> {
    await this.ready();
    const session = this.sessions.get(profile.id);
    if (!session || isShareServerId(profile.id)) {
      throw new GuacApiError({
        kind: 'session-expired',
        status: 0,
        message: undefined,
        translatableMessage: undefined,
      });
    }
    await this.api.changePassword(session, oldPassword, newPassword);
    this.log?.info('auth', 'account password changed');
    let savedUpdated = false;
    if (this.virtualPasswords.has(profile.id)) {
      this.virtualPasswords.set(profile.id, newPassword);
    } else if (await this.hasSavedPassword(profile)) {
      savedUpdated = await this.secure
        .set(secretKeys.password(profile.id), newPassword)
        .then(() => true)
        .catch(() => false);
    }
    this.transientPasswords.delete(profile.id);
    for (const l of this.passwordListeners) l(profile.id, newPassword);
    return { savedUpdated };
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
      this.signedOut(p.id);
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
    await this.setPasswordRequired(profileId, false);
    for (const key of secretKeys.all(profileId)) {
      await this.secure.remove(key).catch(() => undefined);
    }
  }

  // ---- "Sign out of servers after …" (background time) ----------------------------------

  /** Called for each server the background sign-out ended (screens start their sign-in over). */
  onBackgroundSignOut(fn: (profileId: string) => void): () => void {
    this.backgroundSignOutListeners.add(fn);
    return () => this.backgroundSignOutListeners.delete(fn);
  }

  /**
   * Ends every server sign-in on this device after the app was too long in the background:
   * live sessions and stored tokens are dropped (the servers are told in the background,
   * best effort) and the next sign-in asks for the password, even when one is saved, until
   * the user signs in once. Saved passwords and TOTP seeds stay. Returns how many servers
   * were signed out.
   *
   * The live sessions are dropped before the first `await`, so no reconnect that runs right
   * after this call can still pick up a token.
   */
  async signOutAfterBackground(): Promise<number> {
    const live = [...this.sessions.entries()];
    this.sessions.clear();
    const ids = new Set(live.map(([id]) => id));
    const revoke: AuthSession[] = live.map(([, s]) => s);
    const profiles = await this.profiles.list().catch((): ServerProfile[] => []);
    for (const p of profiles) {
      const stored = await this.secure.get(secretKeys.authToken(p.id)).catch(() => null);
      if (stored === null) continue;
      ids.add(p.id);
      if (!revoke.some((s) => s.token === stored)) revoke.push(tokenOnlySession(p.baseUrl, stored));
      await this.secure.remove(secretKeys.authToken(p.id)).catch(() => undefined);
    }
    for (const id of ids) {
      this.signedOut(id);
      this.transientPasswords.delete(id);
      if (!isShareServerId(id)) await this.setPasswordRequired(id, true);
    }
    for (const id of ids) {
      this.emit(id);
      for (const l of this.backgroundSignOutListeners) l(id);
    }
    if (ids.size > 0)
      this.log?.info('auth', `signed out of ${ids.size} server(s) after background`);
    void Promise.allSettled(revoke.map((s) => this.api.logout(s)));
    return ids.size;
  }

  /** Whether the saved password is held back until the user signs in (see above). */
  async isPasswordRequired(profileId: string): Promise<boolean> {
    return (await this.passwordRequiredReason(profileId)) !== null;
  }

  /** Why the saved password is held back, or `null` when it is not. */
  async passwordRequiredReason(profileId: string): Promise<PasswordRequiredReason | null> {
    const known = this.passwordRequired.get(profileId);
    if (known !== undefined) return known;
    const raw = this.kv
      ? await this.kv.get(passwordRequiredKey(profileId)).catch(() => null)
      : null;
    const stored: PasswordRequiredReason | null =
      raw === CERT_MARK ? 'certificate' : raw === null ? null : 'background';
    this.passwordRequired.set(profileId, stored);
    return stored;
  }

  private async setPasswordRequired(
    profileId: string,
    required: boolean,
    reason: PasswordRequiredReason = 'background',
  ): Promise<void> {
    const next = required ? reason : null;
    if (this.passwordRequired.get(profileId) === next) return;
    this.passwordRequired.set(profileId, next);
    if (!this.kv) return;
    const key = passwordRequiredKey(profileId);
    // Best effort: without the persisted mark a restart only means the saved password is
    // used again (the behaviour before this setting existed).
    await (
      next === null
        ? this.kv.remove(key)
        : this.kv.set(key, next === 'certificate' ? CERT_MARK : '1')
    ).catch(() => undefined);
  }

  // ---- newly trusted certificates (SRV-8, pre-release review R2) ------------------------

  /** Installs the "has a trusted certificate" check (`TlsTrustService.pinFor`). */
  setPinnedCheck(pinned: (baseUrl: string) => boolean): void {
    this.pinned = pinned;
  }

  /**
   * After a new certificate was trusted for `origin` (`https://host:port`): every server at
   * that address is signed out on this device (live session and stored token dropped, with no
   * request over the new certificate), and the saved password is held back until the user
   * types it once. A stored token or password must never go to a certificate the user has
   * just accepted on trust.
   */
  async requirePasswordAfterNewCertificate(origin: string): Promise<void> {
    const profiles = await this.profiles.list().catch((): ServerProfile[] => []);
    const ids = profiles.filter((p) => pinOrigin(p.baseUrl) === origin).map((p) => p.id);
    for (const [id, s] of this.sessions) {
      if (pinOrigin(s.baseUrl) === origin && !ids.includes(id)) ids.push(id);
    }
    for (const id of ids) {
      if (isShareServerId(id)) continue;
      this.sessions.delete(id);
      await this.secure.remove(secretKeys.authToken(id)).catch(() => undefined);
      await this.setPasswordRequired(id, true, 'certificate');
      this.signedOut(id);
    }
    for (const id of ids) {
      if (isShareServerId(id)) continue;
      this.emit(id);
      for (const l of this.backgroundSignOutListeners) l(id);
    }
    if (ids.length > 0) this.log?.info('auth', 'new certificate trusted: password required once');
  }

  /**
   * A sign-in over https with the operating system's trust (no pin for that address) worked:
   * remember it per address, so a self-signed certificate there later gets the stronger
   * warning (`ServerProfile.systemTrustSeen`). Best effort, and not awaited by sign-in: the
   * profile write is queued synchronously (so later reads see it) but the sign-in does not
   * wait behind other profile writes.
   */
  private async noteSystemTrust(profile: Pick<ServerProfile, 'id' | 'baseUrl'>): Promise<void> {
    const origin = pinOrigin(profile.baseUrl);
    if (origin === undefined || isShareServerId(profile.id)) return;
    if (this.virtualPasswords.has(profile.id) || this.pinned(profile.baseUrl)) return;
    await this.profiles.setSystemTrustSeenForOrigin(origin, true).catch(() => undefined);
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
    await this.ready();
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
    const r = await this.revalidateOnce(profile, opts);
    if (r === 'needs-sign-in' && !this.sessions.has(profile.id)) {
      // Screens that wait for a renewal because a password is saved learn it failed.
      this.silentSignInFailures.add(profile.id);
      this.emit(profile.id);
    }
    return r;
  }

  /**
   * The last silent sign-in (`revalidate`) for this server failed although a password may
   * be saved, and nobody has signed in since: the user must sign in.
   */
  silentSignInFailed(profileId: string): boolean {
    return this.silentSignInFailures.has(profileId) && !this.sessions.has(profileId);
  }

  private async revalidateOnce(
    profile: ServerProfile,
    opts: { readonly httpAllowed: boolean; readonly totpAutofill: boolean },
  ): Promise<RevalidateResult> {
    await this.ready();
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
    if (this.sessions.has(profileId)) this.silentSignInFailures.delete(profileId);
    for (const l of this.listeners) l(profileId);
  }
}
