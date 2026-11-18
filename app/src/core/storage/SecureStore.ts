import type { StorageLike } from './KeyValueStore.ts';

/**
 * Storage for secrets: saved passwords and auth tokens (SPEC SRV-3).
 *
 * The production implementation is backed by the iOS Keychain or Android Keystore:
 * `NativeSecureStore` (see `NativeSecureStore.ts`), selected in `core/platform.ts`
 * `createSecureStore()`. Web builds use `MemorySecureStore` (or the insecure dev store).
 */
export interface SecureStore {
  /** Whether values are protected at rest by the OS (Keychain/Keystore). */
  readonly protectedAtRest: boolean;
  /** Whether values survive an app restart. */
  readonly persistent: boolean;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Key names for the secrets of one server profile. */
export const secretKeys = {
  password: (profileId: string): string => `profile/${profileId}/password`,
  authToken: (profileId: string): string => `profile/${profileId}/authToken`,
  /** Every secret key for a profile, for deletion. */
  all: (profileId: string): string[] => [
    secretKeys.password(profileId),
    secretKeys.authToken(profileId),
  ],
} as const;

/** Keeps secrets in memory only. They are lost on reload. Safe, but not persistent. */
export class MemorySecureStore implements SecureStore {
  readonly protectedAtRest = false;
  readonly persistent = false;
  private readonly map = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }
}

/**
 * INSECURE, DEV ONLY. Stores "secrets" in plain `localStorage`, readable by any script on
 * the origin and by anyone with the device or browser profile. It exists so that desktop
 * browser development keeps the dev login across reloads.
 *
 * Never use it in a release build. `createSecureStore()` in `core/platform.ts` selects it
 * only when `import.meta.env.DEV` is true and the app is not running natively.
 */
export class InsecureDevLocalStorageSecureStore implements SecureStore {
  readonly protectedAtRest = false;
  readonly persistent = true;
  private readonly storage: StorageLike;
  private readonly namespace: string;

  constructor(storage: StorageLike, namespace = 'omg-insecure-dev-secret:') {
    this.storage = storage;
    this.namespace = namespace;
  }

  async get(key: string): Promise<string | null> {
    return this.storage.getItem(this.namespace + key);
  }

  async set(key: string, value: string): Promise<void> {
    this.storage.setItem(this.namespace + key, value);
  }

  async remove(key: string): Promise<void> {
    this.storage.removeItem(this.namespace + key);
  }
}
