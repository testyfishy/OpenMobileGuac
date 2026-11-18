import type { SecureStore } from './SecureStore.ts';

/**
 * The subset of `@aparajita/capacitor-secure-storage` (`SecureStorage`) this store uses.
 * Injected so tests need neither Capacitor nor the plugin.
 *
 * Only the raw-string methods (`getItem`/`setItem`/`removeItem`) are used: `get`/`set`
 * JSON-encode values and turn ISO-date-looking strings into `Date`s, which could mangle a
 * password.
 */
export interface SecureStoragePluginLike {
  setKeyPrefix(prefix: string): Promise<void>;
  setSynchronize(sync: boolean): Promise<void>;
  setDefaultKeychainAccess(access: number): Promise<void>;
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface NativeSecureStoreOptions {
  /** Key prefix inside the Keychain / encrypted preferences. Must not be blank. */
  readonly prefix?: string;
  /**
   * iOS keychain accessibility (`KeychainAccess` value). Default: the caller passes
   * `whenUnlockedThisDeviceOnly`, so items never migrate through backups (SRV-3).
   */
  readonly keychainAccess: number;
  /** Called when a read fails (corrupt or undecryptable item). Defaults to a no-op. */
  readonly onReadError?: (key: string, err: unknown) => void;
}

/**
 * `SecureStore` backed by the iOS Keychain and Android Keystore via
 * `@aparajita/capacitor-secure-storage` (SPEC SRV-3).
 *
 * - iOS: Keychain items, iCloud sync off, accessibility "this device only".
 * - Android: values encrypted with an AES key held in the Android Keystore.
 *
 * Configuration (prefix, sync off, access level) is applied once, before the first
 * operation. A read that fails (for example an item restored from a backup that this
 * device's Keystore key cannot decrypt) is treated as "no value", so the user is simply
 * asked for the password again.
 */
export class NativeSecureStore implements SecureStore {
  readonly protectedAtRest = true;
  readonly persistent = true;
  private readonly plugin: SecureStoragePluginLike;
  private readonly options: NativeSecureStoreOptions;
  private ready: Promise<void> | undefined;

  constructor(plugin: SecureStoragePluginLike, options: NativeSecureStoreOptions) {
    this.plugin = plugin;
    this.options = options;
  }

  private init(): Promise<void> {
    if (!this.ready) {
      const prefix = this.options.prefix ?? 'omg-secret_';
      if (prefix.trim().length === 0) throw new Error('NativeSecureStore prefix must not be blank');
      this.ready = (async () => {
        await this.plugin.setKeyPrefix(prefix);
        await this.plugin.setSynchronize(false);
        await this.plugin.setDefaultKeychainAccess(this.options.keychainAccess);
      })();
      // Allow a retry on the next call if configuration failed.
      this.ready.catch(() => {
        this.ready = undefined;
      });
    }
    return this.ready;
  }

  async get(key: string): Promise<string | null> {
    await this.init();
    try {
      return await this.plugin.getItem(key);
    } catch (err) {
      this.options.onReadError?.(key, err);
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    await this.init();
    await this.plugin.setItem(key, value);
  }

  async remove(key: string): Promise<void> {
    await this.init();
    await this.plugin.removeItem(key);
  }
}
