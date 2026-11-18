import { isGuacApiError } from '../../core/api/errors.ts';
import type { GuacApi } from '../../core/api/GuacApi.ts';
import type { AuthSession } from '../../core/models/AuthSession.ts';
import type { ServerProfile } from '../../core/models/ServerProfile.ts';
import type { ProfileStore } from '../../core/storage/ProfileStore.ts';
import { secretKeys, type SecureStore } from '../../core/storage/SecureStore.ts';

/**
 * Session tokens and saved passwords per server (SRV-3, SRV-4). Keeps the live
 * `AuthSession` in memory and the token/password in `SecureStore`.
 */
export interface SavedSecrets {
  readonly token: string | null;
  readonly password: string | null;
}

export interface LoginRequest {
  readonly username: string;
  readonly password: string;
  readonly remember: boolean;
  readonly extra: Readonly<Record<string, string>>;
}

export class AuthService {
  private readonly api: GuacApi;
  private readonly secure: SecureStore;
  private readonly profiles: ProfileStore;
  private readonly sessions = new Map<string, AuthSession>();
  /** Secrets for virtual profiles (the dev server) that are not in `ProfileStore`. */
  private readonly virtualPasswords = new Map<string, string>();
  /** A password typed in the server form but not remembered, used once for the first sign-in. */
  private readonly transientPasswords = new Map<string, string>();

  constructor(api: GuacApi, secure: SecureStore, profiles: ProfileStore) {
    this.api = api;
    this.secure = secure;
    this.profiles = profiles;
  }

  /** Registers a fixed password for a virtual profile (dev server from .env.local). */
  setVirtualPassword(profileId: string, password: string): void {
    this.virtualPasswords.set(profileId, password);
  }

  /** Hands a not-remembered password from the server form to the first sign-in. */
  setTransientPassword(profileId: string, password: string): void {
    this.transientPasswords.set(profileId, password);
  }

  current(profileId: string): AuthSession | undefined {
    return this.sessions.get(profileId);
  }

  async loadSecrets(profile: ServerProfile): Promise<SavedSecrets> {
    const token = await this.secure.get(secretKeys.authToken(profile.id)).catch(() => null);
    const virtual = this.virtualPasswords.get(profile.id);
    if (virtual !== undefined) return { token, password: virtual || null };
    const transient = this.transientPasswords.get(profile.id);
    if (transient !== undefined) {
      this.transientPasswords.delete(profile.id);
      return { token, password: transient || null };
    }
    const password = profile.rememberPassword
      ? await this.secure.get(secretKeys.password(profile.id)).catch(() => null)
      : null;
    return { token, password: password && password.length > 0 ? password : null };
  }

  /** Re-validates the stored token. Rejects with `GuacApiError` (`session-expired`, …). */
  async resume(profile: ServerProfile, token: string): Promise<AuthSession> {
    const live = this.sessions.get(profile.id);
    if (live && live.token === token) return live;
    try {
      const session = await this.api.resumeSession(profile, token);
      this.sessions.set(profile.id, session);
      return session;
    } catch (err) {
      // Only a token the server rejected is dropped; a network failure (VPN not up yet)
      // keeps it for the next attempt (SRV-4).
      if (isGuacApiError(err, 'session-expired')) await this.forgetToken(profile.id);
      throw err;
    }
  }

  async login(profile: ServerProfile, req: LoginRequest): Promise<AuthSession> {
    const session = await this.api.login(
      profile,
      { username: req.username, password: req.password },
      req.extra,
    );
    this.sessions.set(profile.id, session);
    // Storage failures must not turn a successful sign-in into an error: the session is
    // live in memory either way.
    await this.secure.set(secretKeys.authToken(profile.id), session.token).catch(() => undefined);
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

  /** Drops a token the server no longer accepts. */
  async forgetToken(profileId: string): Promise<void> {
    this.sessions.delete(profileId);
    await this.secure.remove(secretKeys.authToken(profileId)).catch(() => undefined);
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

  /** Called when a profile's URL changes or it is deleted. */
  async reset(profileId: string): Promise<void> {
    await this.logout(profileId);
  }
}
