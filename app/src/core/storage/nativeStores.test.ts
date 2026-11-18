import { describe, expect, it } from 'vitest';
import { NativeSecureStore, type SecureStoragePluginLike } from './NativeSecureStore.ts';
import { PreferencesKeyValueStore, type PreferencesLike } from './PreferencesKeyValueStore.ts';

class FakeSecurePlugin implements SecureStoragePluginLike {
  calls: string[] = [];
  prefix = '';
  data = new Map<string, string>();
  failReads = false;
  async setKeyPrefix(prefix: string) {
    this.calls.push(`prefix:${prefix}`);
    this.prefix = prefix;
  }
  async setSynchronize(sync: boolean) {
    this.calls.push(`sync:${sync}`);
  }
  async setDefaultKeychainAccess(access: number) {
    this.calls.push(`access:${access}`);
  }
  async getItem(key: string) {
    if (this.failReads) throw new Error('invalidData');
    return this.data.get(this.prefix + key) ?? null;
  }
  async setItem(key: string, value: string) {
    this.data.set(this.prefix + key, value);
  }
  async removeItem(key: string) {
    this.data.delete(this.prefix + key);
  }
}

describe('NativeSecureStore', () => {
  it('configures the plugin once before the first operation', async () => {
    const plugin = new FakeSecurePlugin();
    const store = new NativeSecureStore(plugin, { keychainAccess: 1 });
    await Promise.all([store.get('a'), store.set('b', 'x')]);
    await store.remove('b');
    expect(plugin.calls).toEqual(['prefix:omg-secret_', 'sync:false', 'access:1']);
    expect(store.protectedAtRest).toBe(true);
    expect(store.persistent).toBe(true);
  });

  it('round-trips raw strings, including ones that look like JSON or dates', async () => {
    const store = new NativeSecureStore(new FakeSecurePlugin(), { keychainAccess: 1 });
    for (const v of ['"quoted"', '2026-01-01T00:00:00Z', '{"a":1}', '', 'p@ss w0rd']) {
      await store.set('k', v);
      expect(await store.get('k')).toBe(v);
    }
    await store.remove('k');
    expect(await store.get('k')).toBeNull();
  });

  it('treats an unreadable item as missing', async () => {
    const plugin = new FakeSecurePlugin();
    const errors: string[] = [];
    const store = new NativeSecureStore(plugin, {
      keychainAccess: 1,
      onReadError: (key) => errors.push(key),
    });
    await store.set('k', 'v');
    plugin.failReads = true;
    expect(await store.get('k')).toBeNull();
    expect(errors).toEqual(['k']);
  });

  it('rejects a blank prefix', async () => {
    const store = new NativeSecureStore(new FakeSecurePlugin(), { keychainAccess: 1, prefix: ' ' });
    await expect(store.get('k')).rejects.toThrow(/blank/);
  });
});

describe('PreferencesKeyValueStore', () => {
  const fakePrefs = (): PreferencesLike & { map: Map<string, string> } => {
    const map = new Map<string, string>();
    return {
      map,
      async get({ key }) {
        return { value: map.get(key) ?? null };
      },
      async set({ key, value }) {
        map.set(key, value);
      },
      async remove({ key }) {
        map.delete(key);
      },
      async keys() {
        return { keys: [...map.keys()] };
      },
    };
  };

  it('namespaces keys and lists by prefix', async () => {
    const prefs = fakePrefs();
    prefs.map.set('other-plugin', 'x');
    const kv = new PreferencesKeyValueStore(prefs);
    await kv.set('profiles', '[]');
    await kv.set('profile/1/recents', '[]');
    expect(prefs.map.get('omg:profiles')).toBe('[]');
    expect(await kv.get('profiles')).toBe('[]');
    expect(await kv.get('missing')).toBeNull();
    expect((await kv.keys()).sort()).toEqual(['profile/1/recents', 'profiles']);
    expect(await kv.keys('profile/')).toEqual(['profile/1/recents']);
    await kv.remove('profiles');
    expect(await kv.get('profiles')).toBeNull();
  });
});
