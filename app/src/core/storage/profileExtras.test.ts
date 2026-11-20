import { describe, expect, it } from 'vitest';
import { MemoryKeyValueStore } from './KeyValueStore.ts';
import { ProfileStore, type ConnectionRef } from './ProfileStore.ts';
import { MemorySecureStore, secretKeys } from './SecureStore.ts';

function makeStore() {
  let n = 0;
  let t = 1000;
  const kv = new MemoryKeyValueStore();
  const secure = new MemorySecureStore();
  const thumbs = new MemoryKeyValueStore();
  const store = new ProfileStore(kv, {
    secureStore: secure,
    generateId: () => `id${++n}`,
    now: () => t++,
    thumbnails: thumbs,
  });
  return { store, kv, secure, thumbs };
}

const ref: ConnectionRef = { dataSource: 'postgresql', identifier: '1', type: 'c' };
const ref2: ConnectionRef = { dataSource: 'postgresql', identifier: '2', type: 'c' };
const base = { baseUrl: 'https://guac.example/guacamole', username: 'testuser' };

describe('ProfileStore extras', () => {
  it('remove() also deletes the TOTP seed, options and thumbnails', async () => {
    const { store, kv, secure } = makeStore();
    const a = await store.add({ name: 'A', ...base });
    const b = await store.add({ name: 'B', ...base });
    await secure.set(secretKeys.totpSeed(a.id), 'otpauth://totp/x?secret=AAAA');
    await store.setOptions(a.id, { ssoMode: 'webview' });
    await store.setThumbnail(a.id, ref, { dataUrl: 'data:image/jpeg;base64,AA', at: 1 });
    await store.setThumbnail(b.id, ref, { dataUrl: 'data:image/jpeg;base64,BB', at: 1 });
    await store.remove(a.id);
    expect(await secure.get(secretKeys.totpSeed(a.id))).toBeNull();
    expect(await store.getOptions(a.id)).toBeUndefined();
    expect(await store.getThumbnail(a.id, ref)).toBeUndefined();
    expect(await kv.keys(`profile/${a.id}/`)).toEqual([]);
    expect(await store.getThumbnail(b.id, ref)).toEqual({
      dataUrl: 'data:image/jpeg;base64,BB',
      at: 1,
    });
  });

  it('thumbnails reject non-image data and can be cleared globally', async () => {
    const { store, thumbs } = makeStore();
    const a = await store.add({ name: 'A', ...base });
    await thumbs.set(
      `profile/${a.id}/thumb/c/postgresql/1`,
      JSON.stringify({ dataUrl: 'javascript:x', at: 1 }),
    );
    expect(await store.getThumbnail(a.id, ref)).toBeUndefined();
    await store.setThumbnail(a.id, ref2, { dataUrl: 'data:image/png;base64,AA', at: 2 });
    await store.clearThumbnails();
    expect(await store.getThumbnail(a.id, ref2)).toBeUndefined();
  });

  it('never writes thumbnails to the main store and purges old ones there (AUDIT #12)', async () => {
    const { store, kv, thumbs } = makeStore();
    const a = await store.add({ name: 'A', ...base });
    await kv.set(
      `profile/${a.id}/thumb/c/postgresql/9`,
      '{"dataUrl":"data:image/jpeg;base64,A","at":1}',
    );
    await store.setThumbnail(a.id, ref, { dataUrl: 'data:image/jpeg;base64,AA', at: 1 });
    expect((await kv.keys()).filter((k) => k.includes('/thumb/'))).toHaveLength(1);
    expect(await thumbs.keys(`profile/${a.id}/thumb/`)).toHaveLength(1);
    await store.purgeLegacyThumbnails();
    expect((await kv.keys()).filter((k) => k.includes('/thumb/'))).toEqual([]);
    expect(await store.getThumbnail(a.id, ref)).toBeDefined();
  });

  it('recents keep the display name and protocol', async () => {
    const { store } = makeStore();
    const a = await store.add({ name: 'A', ...base });
    await store.recordRecent(a.id, ref, 5, { name: 'Desktop', protocol: 'rdp' });
    expect(await store.listRecents(a.id)).toEqual([
      { ref, at: 5, name: 'Desktop', protocol: 'rdp' },
    ]);
  });

  it('duplicate() copies favourites, settings and options but not recents or secrets', async () => {
    const { store, secure } = makeStore();
    const a = await store.add({ name: 'A', ...base, rememberPassword: true });
    await store.add({ name: 'Z', ...base });
    await store.setFavourite(a.id, ref, true);
    await store.recordRecent(a.id, ref);
    await store.setConnectionSettings(a.id, ref, { fitMode: 'fit-width' });
    await store.setOptions(a.id, { x: 1 });
    await secure.set(secretKeys.password(a.id), 'pw');
    const copy = await store.duplicate(a.id, 'A (copy)');
    expect((await store.list()).map((p) => p.name)).toEqual(['A', 'A (copy)', 'Z']);
    expect(copy.rememberPassword).toBe(false);
    expect(await store.listFavourites(copy.id)).toEqual([ref]);
    expect(await store.getConnectionSettings(copy.id, ref)).toEqual({ fitMode: 'fit-width' });
    expect(await store.getOptions(copy.id)).toEqual({ x: 1 });
    expect(await store.listRecents(copy.id)).toEqual([]);
    expect(await secure.get(secretKeys.password(copy.id))).toBeNull();
  });

  it('exportAll() and applyRestore() round-trip, with merge and removal', async () => {
    const { store, secure } = makeStore();
    const a = await store.add({ name: 'A', ...base });
    await store.setFavourite(a.id, ref, true);
    await store.setConnectionSettings(a.id, ref, { fitMode: 'fit-width' });
    const exported = await store.exportAll();
    const first = exported[0];
    if (!first) throw new Error('expected one profile');

    // Merge into the same id: favourites union, settings: backup wins per key.
    await store.setFavourite(a.id, ref2, true);
    await store.setConnectionSettings(a.id, ref, { fitMode: 'one-to-one' });
    await store.applyRestore([{ targetId: a.id, data: first, merge: true }]);
    expect(await store.listFavourites(a.id)).toEqual([ref, ref2]);
    expect(await store.getConnectionSettings(a.id, ref)).toEqual({ fitMode: 'fit-width' });

    // Replace: remove the existing profile (and its secrets), restore under a new id.
    await secure.set(secretKeys.password(a.id), 'pw');
    await store.applyRestore([{ targetId: 'new-id', data: first, merge: false }], [a.id]);
    const list = await store.list();
    expect(list.map((p) => [p.id, p.name])).toEqual([['new-id', 'A']]);
    expect(await store.listFavourites('new-id')).toEqual([ref]);
    expect(await secure.get(secretKeys.password(a.id))).toBeNull();
  });

  it('applyRestore() refuses non-http base URLs', async () => {
    const { store } = makeStore();
    const bad = {
      profile: {
        id: 'x',
        name: 'x',
        baseUrl: 'file:///etc',
        username: '',
        rememberPassword: false,
        createdAt: 0,
      },
      favourites: [],
      recents: [],
      connectionSettings: {},
      options: undefined,
    };
    await expect(
      store.applyRestore([{ targetId: 'x', data: bad, merge: false }]),
    ).rejects.toThrow();
    expect(await store.list()).toEqual([]);
  });
});

describe('ephemeral (memory-only) server ids', () => {
  it('never writes per-server data for them', async () => {
    const kv = new MemoryKeyValueStore();
    const store = new ProfileStore(kv, { isEphemeral: (id) => id.startsWith('share-') });
    const ref = { dataSource: 'postgresql', identifier: '1', type: 'c' as const };
    const id = 'share-abc';
    await store.setOptions(id, { totpAutofill: true });
    await store.setFavourite(id, ref, true);
    await store.recordRecent(id, ref, 1);
    await store.setConnectionSettings(id, ref, { scaling: 'fit' });
    await store.setThumbnail(id, ref, { dataUrl: 'data:image/jpeg;base64,AA', at: 1 });
    expect(await kv.keys()).toEqual([]);
    // Other ids are unaffected.
    await store.setFavourite('builtin-dev', ref, true);
    expect(await store.listFavourites('builtin-dev')).toHaveLength(1);
  });
});
