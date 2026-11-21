import { describe, expect, it } from 'vitest';
import { parseServerOptions } from '../settings/settingsModel.ts';
import {
  patchServerOptions,
  subscribeServerOptions,
  type ServerOptionsStorage,
} from './serverOptionsStore.ts';

function memoryStore(initial?: unknown) {
  const data = new Map<string, unknown>();
  if (initial !== undefined) data.set('srv-1', initial);
  let writes = 0;
  const store: ServerOptionsStorage = {
    // A tick on each side, so overlapping writers would interleave if not serialised.
    getOptions: async (id) => {
      await Promise.resolve();
      return data.get(id);
    },
    setOptions: async (id, o) => {
      await Promise.resolve();
      writes += 1;
      data.set(id, JSON.parse(JSON.stringify(o)));
    },
  };
  return { store, read: () => parseServerOptions(data.get('srv-1')), writes: () => writes };
}

describe('patchServerOptions', () => {
  it('keeps fields another writer changed (two stale copies)', async () => {
    const m = memoryStore({ confirmLinks: true, ssoMode: 'webview', totpAutofill: false });
    // Section A turns off app-link confirmation; section B, loaded before, saves a TOTP key.
    await Promise.all([
      patchServerOptions(m.store, 'srv-1', { confirmLinks: false }),
      patchServerOptions(m.store, 'srv-1', { totpAutofill: true }),
    ]);
    const stored = m.read();
    expect(stored.confirmLinks).toBe(false);
    expect(stored.totpAutofill).toBe(true);
    // Then a session default from the first copy: neither earlier change is reverted.
    await patchServerOptions(m.store, 'srv-1', { sessionDefaults: { quality: 'low' } });
    expect(m.read()).toMatchObject({
      confirmLinks: false,
      totpAutofill: true,
      sessionDefaults: { quality: 'low' },
    });
  });

  it('tells subscribers the stored result', async () => {
    const m = memoryStore({ ssoMode: 'app-callback' });
    const seen: unknown[] = [];
    const off = subscribeServerOptions((id, o) => seen.push([id, o.ssoMode, o.seenSso]));
    await patchServerOptions(m.store, 'srv-1', { seenSso: true });
    off();
    await patchServerOptions(m.store, 'srv-1', { seenTotp: true });
    expect(seen).toEqual([['srv-1', 'app-callback', true]]);
  });

  it('does not write when the stored options cannot be read', async () => {
    const m = memoryStore({ confirmLinks: false });
    const failing: ServerOptionsStorage = {
      getOptions: () => Promise.reject(new Error('storage')),
      setOptions: m.store.setOptions,
    };
    await expect(patchServerOptions(failing, 'srv-1', { seenSso: true })).rejects.toThrow();
    expect(m.writes()).toBe(0);
    // The next write still runs after a failed one.
    await patchServerOptions(m.store, 'srv-1', { seenSso: true });
    expect(m.read()).toMatchObject({ confirmLinks: false, seenSso: true });
  });
});
