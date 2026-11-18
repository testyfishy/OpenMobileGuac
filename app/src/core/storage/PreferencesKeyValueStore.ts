import type { KeyValueStore } from './KeyValueStore.ts';

/** The subset of `@capacitor/preferences` (`Preferences`) used here. Injected for tests. */
export interface PreferencesLike {
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
  keys(): Promise<{ keys: string[] }>;
}

/**
 * `KeyValueStore` over Capacitor Preferences (UserDefaults on iOS, SharedPreferences on
 * Android). For **non-secret** data only. Keys are namespaced so other plugins' entries are
 * never touched.
 */
export class PreferencesKeyValueStore implements KeyValueStore {
  private readonly prefs: PreferencesLike;
  private readonly namespace: string;

  constructor(prefs: PreferencesLike, namespace = 'omg:') {
    this.prefs = prefs;
    this.namespace = namespace;
  }

  async get(key: string): Promise<string | null> {
    return (await this.prefs.get({ key: this.namespace + key })).value;
  }

  async set(key: string, value: string): Promise<void> {
    await this.prefs.set({ key: this.namespace + key, value });
  }

  async remove(key: string): Promise<void> {
    await this.prefs.remove({ key: this.namespace + key });
  }

  async keys(prefix = ''): Promise<string[]> {
    const full = this.namespace + prefix;
    return (await this.prefs.keys()).keys
      .filter((k) => k.startsWith(full))
      .map((k) => k.slice(this.namespace.length));
  }
}
