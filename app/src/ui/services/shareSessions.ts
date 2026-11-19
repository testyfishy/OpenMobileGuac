import type { ShareLink } from '../../core/links/links.ts';
import type { ServerProfile } from '../../core/models/ServerProfile.ts';

/**
 * Share-link sessions (CON-6) as temporary, memory-only server entries.
 *
 * A share key signs in as a different (anonymous, share-scoped) Guacamole user. Signing in
 * with it under a saved server's id would replace that server's own token and sign-in, so
 * each opened link gets its own virtual profile instead: never written to `ProfileStore`,
 * its token never written to `SecureStore` (see `AuthService.loginWithParameters`), and
 * gone when the app restarts.
 */
export const SHARE_ID_PREFIX = 'share-';

export function isShareServerId(id: string): boolean {
  return id.startsWith(SHARE_ID_PREFIX);
}

/** A virtual profile for one opened share link. Pure. */
export function makeShareProfile(
  link: ShareLink,
  baseUrl: string,
  name: string,
  now: number,
  random: string,
): ServerProfile {
  return {
    id: `${SHARE_ID_PREFIX}${now.toString(36)}-${random}`,
    name,
    baseUrl: baseUrl || link.baseUrl,
    username: '',
    rememberPassword: false,
    createdAt: now,
  };
}

/** The share-link profiles opened in this run (memory only). */
export class ShareProfiles {
  private readonly byId = new Map<string, ServerProfile>();
  private readonly listeners = new Set<() => void>();
  private cached: readonly ServerProfile[] = [];

  add(profile: ServerProfile): void {
    if (!isShareServerId(profile.id)) throw new Error('Not a share-link profile id');
    this.byId.set(profile.id, profile);
    this.emit();
  }

  get(id: string): ServerProfile | undefined {
    return this.byId.get(id);
  }

  /** The open share profiles; the same array until the next change (for React). */
  list(): readonly ServerProfile[] {
    return this.cached;
  }

  remove(id: string): void {
    if (this.byId.delete(id)) this.emit();
  }

  onChange = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private emit(): void {
    this.cached = [...this.byId.values()];
    for (const l of this.listeners) l();
  }
}
