import { describe, expect, it } from 'vitest';
import {
  MemoryKeyValueStore,
  WebStorageKeyValueStore,
  type KeyValueStore,
  type StorageLike,
} from './KeyValueStore.ts';
import { ProfileStore, type ConnectionRef } from './ProfileStore.ts';
import {
  InsecureDevLocalStorageSecureStore,
  MemorySecureStore,
  secretKeys,
} from './SecureStore.ts';

/** A tiny in-memory `Storage` implementation, so no DOM is needed. */
class FakeStorage implements StorageLike {
  private readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

function makeStore(kv: KeyValueStore = new MemoryKeyValueStore()) {
  let n = 0;
  let t = 1000;
  const secure = new MemorySecureStore();
  const store = new ProfileStore(kv, {
    secureStore: secure,
    generateId: () => `id${++n}`,
    now: () => t++,
    maxRecents: 3,
  });
  return { store, kv, secure };
}

const refA: ConnectionRef = { dataSource: 'postgresql', identifier: '1', type: 'c' };
const refB: ConnectionRef = { dataSource: 'postgresql', identifier: '2', type: 'c' };
const refC: ConnectionRef = { dataSource: 'ldap', identifier: '1', type: 'c' };
const refD: ConnectionRef = { dataSource: 'postgresql', identifier: '4', type: 'g' };

describe('ProfileStore profiles', () => {
  it('adds, gets, updates and lists in insertion order', async () => {
    const { store } = makeStore();
    const a = await store.add({
      name: 'Home',
      baseUrl: 'https://guac.example/guacamole',
      username: 'testuser',
    });
    const b = await store.add({ name: 'Lab', baseUrl: 'http://guac.example:8080' });
    expect(a).toEqual({
      id: 'id1',
      name: 'Home',
      baseUrl: 'https://guac.example/guacamole',
      username: 'testuser',
      rememberPassword: false,
      createdAt: 1000,
    });
    expect((await store.list()).map((p) => p.id)).toEqual(['id1', 'id2']);

    const updated = await store.update(b.id, {
      name: 'Lab 2',
      rememberPassword: true,
      username: undefined,
    });
    expect(updated).toMatchObject({
      id: 'id2',
      name: 'Lab 2',
      rememberPassword: true,
      username: '',
    });
    expect(await store.get('id2')).toEqual(updated);
    expect(await store.get('nope')).toBeUndefined();
  });

  it('drops the token, password and TOTP seed when the address changes (AUDIT #1, #2)', async () => {
    const { store, secure } = makeStore();
    const a = await store.add({ name: 'Home', baseUrl: 'https://guac.example/guacamole' });
    const fill = async () => {
      for (const k of secretKeys.all(a.id)) await secure.set(k, 'not-a-real-secret');
    };
    await fill();
    // Same endpoint (case and trailing slash only): secrets stay.
    await store.update(a.id, { name: 'Renamed', baseUrl: 'https://GUAC.example/guacamole/' });
    expect(await secure.get(secretKeys.authToken(a.id))).toBe('not-a-real-secret');
    // Another host: all gone.
    await store.update(a.id, { baseUrl: 'https://other.example/guacamole' });
    for (const k of secretKeys.all(a.id)) expect(await secure.get(k)).toBeNull();
    // Restore onto the same id with another address: gone too.
    await fill();
    await store.applyRestore([
      {
        targetId: a.id,
        merge: true,
        data: {
          profile: { ...a, baseUrl: 'http://other.example:8080/guacamole' },
          favourites: [],
          recents: [],
          connectionSettings: {},
          options: undefined,
        },
      },
    ]);
    for (const k of secretKeys.all(a.id)) expect(await secure.get(k)).toBeNull();
  });

  it('validates base URLs and unknown ids', async () => {
    const { store } = makeStore();
    await expect(store.add({ name: 'x', baseUrl: 'ftp://guac.example' })).rejects.toThrow(/http/);
    await expect(store.update('missing', { name: 'y' })).rejects.toThrow(/No profile/);
  });

  it('reorders and moves', async () => {
    const { store } = makeStore();
    for (const name of ['a', 'b', 'c']) await store.add({ name, baseUrl: 'https://guac.example' });
    expect((await store.reorder(['id3', 'id1', 'id2'])).map((p) => p.name)).toEqual([
      'c',
      'a',
      'b',
    ]);
    expect((await store.move('id2', 0)).map((p) => p.name)).toEqual(['b', 'c', 'a']);
    expect((await store.move('id2', 99)).map((p) => p.name)).toEqual(['c', 'a', 'b']);
    await expect(store.reorder(['id1', 'id2'])).rejects.toThrow(/exactly once/);
    await expect(store.reorder(['id1', 'id1', 'id2'])).rejects.toThrow(/exactly once/);
    await expect(store.reorder(['id1', 'id2', 'zzz'])).rejects.toThrow(/No profile/);
  });

  it('serialises concurrent adds without losing updates', async () => {
    const { store } = makeStore();
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        store.add({ name: `p${i}`, baseUrl: 'https://guac.example' }),
      ),
    );
    expect(await store.list()).toHaveLength(10);
  });

  it('skips corrupt entries and survives corrupt JSON', async () => {
    const kv = new MemoryKeyValueStore();
    await kv.set(
      'profiles',
      JSON.stringify({
        v: 1,
        profiles: [{ id: 'ok', name: 'ok', baseUrl: 'https://guac.example' }, { id: 'bad' }],
      }),
    );
    const { store } = makeStore(kv);
    expect((await store.list()).map((p) => p.id)).toEqual(['ok']);
    await kv.set('profiles', '{not json');
    expect(await store.list()).toEqual([]);
  });

  it('remove() deletes the profile, its local data and its secrets, and nothing else', async () => {
    const { store, secure } = makeStore();
    const a = await store.add({ name: 'a', baseUrl: 'https://guac.example' });
    const b = await store.add({ name: 'b', baseUrl: 'https://guac.example' });
    await secure.set(secretKeys.password(a.id), 'pw');
    await secure.set(secretKeys.authToken(a.id), 'tok');
    await secure.set(secretKeys.password(b.id), 'pw-b');
    await store.setFavourite(a.id, refA, true);
    await store.recordRecent(a.id, refA);
    await store.setConnectionSettings(a.id, refA, { scale: 'fit' });
    await store.setFavourite(b.id, refA, true);

    await store.remove(a.id);

    expect((await store.list()).map((p) => p.id)).toEqual([b.id]);
    expect(await store.listFavourites(a.id)).toEqual([]);
    expect(await store.listRecents(a.id)).toEqual([]);
    expect(await store.getConnectionSettings(a.id, refA)).toBeUndefined();
    expect(await secure.get(secretKeys.password(a.id))).toBeNull();
    expect(await secure.get(secretKeys.authToken(a.id))).toBeNull();
    expect(await secure.get(secretKeys.password(b.id))).toBe('pw-b');
    expect(await store.listFavourites(b.id)).toEqual([refA]);
  });

  it('never writes secrets into the key-value store', async () => {
    const { store, kv } = makeStore();
    await store.add({ name: 'a', baseUrl: 'https://guac.example', rememberPassword: true });
    const values = await Promise.all((await kv.keys()).map((k) => kv.get(k)));
    expect(values.join(' ')).not.toMatch(/password"\s*:\s*"/);
  });
});

describe('ProfileStore favourites, recents, settings', () => {
  it('toggles favourites per profile, idempotently', async () => {
    const { store } = makeStore();
    await store.setFavourite('p', refA, true);
    await store.setFavourite('p', refA, true);
    await store.setFavourite('p', refD, true);
    expect(await store.listFavourites('p')).toEqual([refA, refD]);
    expect(await store.isFavourite('p', refA)).toBe(true);
    expect(await store.isFavourite('p', refC)).toBe(false);
    expect(await store.isFavourite('other', refA)).toBe(false);
    await store.setFavourite('p', refA, false);
    expect(await store.listFavourites('p')).toEqual([refD]);
  });

  it('keeps recents newest first, de-duplicated and capped', async () => {
    const { store } = makeStore();
    await store.recordRecent('p', refA, 1);
    await store.recordRecent('p', refB, 2);
    await store.recordRecent('p', refC, 3);
    await store.recordRecent('p', refA, 4);
    expect(
      (await store.listRecents('p')).map((e) => [e.ref.identifier, e.ref.dataSource, e.at]),
    ).toEqual([
      ['1', 'postgresql', 4],
      ['1', 'ldap', 3],
      ['2', 'postgresql', 2],
    ]);
    await store.recordRecent('p', refD, 5);
    expect((await store.listRecents('p')).map((e) => e.at)).toEqual([5, 4, 3]);
    await store.clearRecents('p');
    expect(await store.listRecents('p')).toEqual([]);
  });

  it('remembers settings per connection and distinguishes connections from groups', async () => {
    const { store } = makeStore();
    await store.setConnectionSettings('p', refA, { pointerMode: 'trackpad', zoom: 1.5 });
    await store.setConnectionSettings('p', { ...refA, type: 'g' }, { pointerMode: 'direct' });
    expect(await store.getConnectionSettings('p', refA)).toEqual({
      pointerMode: 'trackpad',
      zoom: 1.5,
    });
    expect(await store.getConnectionSettings('p', { ...refA, type: 'g' })).toEqual({
      pointerMode: 'direct',
    });
    expect(await store.getConnectionSettings('p', refB)).toBeUndefined();
    await store.setConnectionSettings('p', refA, undefined);
    expect(await store.getConnectionSettings('p', refA)).toBeUndefined();
    expect(await store.getConnectionSettings('p', { ...refA, type: 'g' })).toBeDefined();
  });

  it('works on top of WebStorageKeyValueStore with namespacing', async () => {
    const storage = new FakeStorage();
    storage.setItem('unrelated', 'x');
    const kv = new WebStorageKeyValueStore(storage, 'ns:');
    const { store } = makeStore(kv);
    await store.add({ name: 'a', baseUrl: 'https://guac.example' });
    await store.setFavourite('id1', refA, true);
    expect(await kv.keys()).toEqual(['profiles', 'profile/id1/favourites']);
    expect(storage.getItem('ns:profiles')).toContain('"name":"a"');
    expect(storage.getItem('unrelated')).toBe('x');
  });
});

describe('SecureStore implementations', () => {
  it('MemorySecureStore is non-persistent and not protected at rest', async () => {
    const s = new MemorySecureStore();
    expect([s.persistent, s.protectedAtRest]).toEqual([false, false]);
    await s.set('k', 'v');
    expect(await s.get('k')).toBe('v');
    await s.remove('k');
    expect(await s.get('k')).toBeNull();
  });

  it('InsecureDevLocalStorageSecureStore is clearly labelled and namespaced', async () => {
    const storage = new FakeStorage();
    const s = new InsecureDevLocalStorageSecureStore(storage);
    expect([s.persistent, s.protectedAtRest]).toEqual([true, false]);
    await s.set(secretKeys.password('p1'), 'pw');
    expect(storage.key(0)).toBe('omg-insecure-dev-secret:profile/p1/password');
    expect(await s.get(secretKeys.password('p1'))).toBe('pw');
    await s.remove(secretKeys.password('p1'));
    expect(storage.length).toBe(0);
  });
});
