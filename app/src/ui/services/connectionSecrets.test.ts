import { describe, expect, it } from 'vitest';
import { GuacApi } from '../../core/api/GuacApi.ts';
import { MemoryKeyValueStore } from '../../core/storage/KeyValueStore.ts';
import { ProfileStore } from '../../core/storage/ProfileStore.ts';
import { MemorySecureStore, secretKeys } from '../../core/storage/SecureStore.ts';
import { FakeHttpClient, jsonResponse } from '../../core/testing/FakeHttpClient.ts';
import { authResultJson } from '../../core/testing/fixtures.ts';
import type { RememberTarget } from '../../session/credentials/rememberedParams.ts';
import { AuthService } from './AuthService.ts';
import { ConnectionSecrets } from './connectionSecrets.ts';

const BASE = 'https://guac.example/guacamole';
const CONN: RememberTarget = { server: BASE, dataSource: 'postgresql', type: 'c', identifier: '7' };
const NAMES = ['username', 'password'];
const VALUES = { username: 'tester', password: 'not-a-real-secret' };
const MIN = 60_000;

function setup(opts: { gate?: () => Promise<boolean> } = {}) {
  const secure = new MemorySecureStore();
  let now = 1_000_000;
  let gateCalls = 0;
  const store = new ConnectionSecrets({
    secure,
    mayUseStored: async () => {
      gateCalls++;
      return opts.gate ? opts.gate() : true;
    },
    now: () => now,
  });
  return {
    store,
    secure,
    advance: (ms: number) => {
      now += ms;
    },
    gateCalls: () => gateCalls,
  };
}

describe('ConnectionSecrets (memory policies)', () => {
  it('answers a later request of the same connection until the app closes', async () => {
    const { store, secure, advance } = setup();
    await store.remember('app', 'p1', CONN, NAMES, VALUES);
    advance(24 * 60 * MIN);
    expect(await store.recall('app', 'p1', CONN, ['password', 'username'])).toEqual(VALUES);
    // Memory only: nothing was written to the secure store.
    expect(await secure.get(secretKeys.connectionPasswords('p1'))).toBeNull();
  });

  it('expires after the time limit, counted from the last use', async () => {
    const { store, advance } = setup();
    await store.remember('5m', 'p1', CONN, NAMES, VALUES);
    advance(4 * MIN);
    expect(await store.recall('5m', 'p1', CONN, NAMES)).toEqual(VALUES);
    advance(4 * MIN); // 8 min after typing, 4 after the last use
    expect(await store.recall('5m', 'p1', CONN, NAMES)).toEqual(VALUES);
    advance(5 * MIN);
    expect(await store.recall('5m', 'p1', CONN, NAMES)).toBeNull();
    expect(store.memoryCount()).toBe(0);
  });

  it('never offers values to another connection, server, profile or set of fields', async () => {
    const { store } = setup();
    await store.remember('app', 'p1', CONN, NAMES, VALUES);
    expect(await store.recall('app', 'p1', { ...CONN, identifier: '8' }, NAMES)).toBeNull();
    expect(await store.recall('app', 'p1', { ...CONN, type: 'g' }, NAMES)).toBeNull();
    expect(await store.recall('app', 'p1', { ...CONN, dataSource: 'mysql' }, NAMES)).toBeNull();
    expect(
      await store.recall('app', 'p1', { ...CONN, server: 'https://other.example/guac' }, NAMES),
    ).toBeNull();
    expect(await store.recall('app', 'p2', CONN, NAMES)).toBeNull();
    expect(await store.recall('app', 'p1', CONN, ['password', 'domain'])).toBeNull();
  });

  it('keeps nothing with "never", and switching to it forgets everything', async () => {
    const { store } = setup();
    await store.remember('never', 'p1', CONN, NAMES, VALUES);
    expect(await store.recall('app', 'p1', CONN, NAMES)).toBeNull();
    await store.remember('app', 'p1', CONN, NAMES, VALUES);
    expect(await store.recall('never', 'p1', CONN, NAMES)).toBeNull();
    expect(store.memoryCount()).toBe(0);
  });

  it('forgets one connection, a server (sign-out) or everything', async () => {
    const { store } = setup();
    const other = { ...CONN, identifier: '8' };
    await store.remember('app', 'p1', CONN, NAMES, VALUES);
    await store.remember('app', 'p1', other, NAMES, VALUES);
    await store.remember('app', 'p2', CONN, NAMES, VALUES);
    await store.forget('p1', CONN, NAMES);
    expect(await store.recall('app', 'p1', CONN, NAMES)).toBeNull();
    expect(await store.recall('app', 'p1', other, NAMES)).toEqual(VALUES);
    store.forgetMemory('p1');
    expect(await store.recall('app', 'p1', other, NAMES)).toBeNull();
    expect(await store.recall('app', 'p2', CONN, NAMES)).toEqual(VALUES);
    await store.forgetAll(['p1', 'p2']);
    expect(store.memoryCount()).toBe(0);
  });
});

describe('ConnectionSecrets (saved on this device)', () => {
  it('saves in the secure store and answers after the gate', async () => {
    const { store, secure, gateCalls } = setup();
    await store.remember('device', 'p1', CONN, NAMES, VALUES);
    expect(store.memoryCount()).toBe(0);
    const raw = await secure.get(secretKeys.connectionPasswords('p1'));
    expect(raw).not.toBeNull();
    expect(await store.recall('device', 'p1', CONN, NAMES)).toEqual(VALUES);
    expect(gateCalls()).toBe(1);
    // Nothing saved for this one: no gate (no Face ID prompt for nothing).
    expect(await store.recall('device', 'p1', { ...CONN, identifier: '9' }, NAMES)).toBeNull();
    expect(gateCalls()).toBe(1);
  });

  it('does not answer when the lock gate refuses', async () => {
    const { store } = setup({ gate: async () => false });
    await store.remember('device', 'p1', CONN, NAMES, VALUES);
    expect(await store.recall('device', 'p1', CONN, NAMES)).toBeNull();
  });

  it('is not read under a memory policy, and leaving "device" deletes it', async () => {
    const { store, secure } = setup();
    await store.remember('device', 'p1', CONN, NAMES, VALUES);
    expect(await store.recall('app', 'p1', CONN, NAMES)).toBeNull();
    await store.applyPolicy('15m', ['p1']);
    expect(await secure.get(secretKeys.connectionPasswords('p1'))).toBeNull();
  });

  it('forgets a rejected value and removes an empty record', async () => {
    const { store, secure } = setup();
    const other = { ...CONN, identifier: '8' };
    await store.remember('device', 'p1', CONN, NAMES, VALUES);
    await store.remember('device', 'p1', other, NAMES, VALUES);
    await store.forget('p1', CONN, NAMES);
    expect(await store.recall('device', 'p1', CONN, NAMES)).toBeNull();
    expect(await store.recall('device', 'p1', other, NAMES)).toEqual(VALUES);
    await store.forget('p1', other, NAMES);
    expect(await secure.get(secretKeys.connectionPasswords('p1'))).toBeNull();
  });

  it('serialises concurrent writes (no lost update)', async () => {
    const { store } = setup();
    await Promise.all(
      ['1', '2', '3', '4'].map((id) =>
        store.remember('device', 'p1', { ...CONN, identifier: id }, NAMES, VALUES),
      ),
    );
    for (const id of ['1', '2', '3', '4']) {
      expect(await store.recall('device', 'p1', { ...CONN, identifier: id }, NAMES)).toEqual(
        VALUES,
      );
    }
  });

  it('"Forget remembered connection passwords" removes device records too', async () => {
    const { store, secure } = setup();
    await store.remember('device', 'p1', CONN, NAMES, VALUES);
    await store.remember('device', 'p2', CONN, NAMES, VALUES);
    await store.forgetAll(['p1', 'p2']);
    expect(await secure.get(secretKeys.connectionPasswords('p1'))).toBeNull();
    expect(await secure.get(secretKeys.connectionPasswords('p2'))).toBeNull();
  });
});

describe('ConnectionSecrets.bind', () => {
  it('binds to one connection and reads the address at each use', async () => {
    const { store } = setup();
    let server: string | undefined = BASE;
    const bound = store.bind({
      profileId: 'p1',
      policy: 'app',
      server: () => server,
      connection: { dataSource: 'postgresql', type: 'c', identifier: '7' },
    });
    expect(bound.policy).toBe('app');
    bound.remember(NAMES, VALUES);
    await Promise.resolve();
    expect(await bound.recall(NAMES)).toEqual(VALUES);
    expect(await store.recall('app', 'p1', CONN, NAMES)).toEqual(VALUES);
    // Signed out (no address): nothing is offered.
    server = undefined;
    expect(await bound.recall(NAMES)).toBeNull();
    // Forget still reaches the last known address.
    bound.forget(NAMES);
    await Promise.resolve();
    expect(await store.recall('app', 'p1', CONN, NAMES)).toBeNull();
  });
});

describe('AuthService and remembered connection passwords', () => {
  async function withAuth() {
    const http = new FakeHttpClient()
      .on('POST', `${BASE}/api/tokens`, () => jsonResponse(200, authResultJson))
      .on('DELETE', `${BASE}/api/session`, () => jsonResponse(204, null));
    const secure = new MemorySecureStore();
    const profiles = new ProfileStore(new MemoryKeyValueStore(), { secureStore: secure });
    const profile = await profiles.add({ name: 'Lab', baseUrl: BASE, rememberPassword: true });
    const auth = new AuthService(new GuacApi(http), secure, profiles);
    const store = new ConnectionSecrets({ secure, mayUseStored: () => auth.mayUseStoredSecret() });
    auth.onSignedOut((id) => store.forgetMemory(id));
    await auth.login(profile, { username: 'tester', password: 'pw', remember: true, extra: {} });
    return { auth, profiles, profile, secure, store };
  }

  it('a sign-out forgets what is in memory; the device record stays, like the saved password', async () => {
    const { auth, profile, secure, store } = await withAuth();
    await store.remember('app', profile.id, CONN, NAMES, VALUES);
    await store.remember('device', profile.id, { ...CONN, identifier: '8' }, NAMES, VALUES);
    await auth.logout(profile.id);
    expect(await store.recall('app', profile.id, CONN, NAMES)).toBeNull();
    expect(await secure.get(secretKeys.connectionPasswords(profile.id))).not.toBeNull();
    expect(await secure.get(secretKeys.password(profile.id))).toBe('pw');
  });

  it('clear credentials, an address change and sign-out everywhere delete the device record', async () => {
    for (const run of ['clear', 'reset', 'everywhere'] as const) {
      const { auth, profile, profiles, secure, store } = await withAuth();
      await store.remember('device', profile.id, CONN, NAMES, VALUES);
      await store.remember('app', profile.id, { ...CONN, identifier: '8' }, NAMES, VALUES);
      if (run === 'clear') await auth.clearCredentials(profile.id);
      if (run === 'reset') await auth.reset(profile.id);
      if (run === 'everywhere') await auth.signOutEverywhere(await profiles.list());
      expect(await secure.get(secretKeys.connectionPasswords(profile.id))).toBeNull();
      expect(store.memoryCount()).toBe(0);
    }
  });

  it('deleting the server profile deletes the device record', async () => {
    const { profile, profiles, secure, store } = await withAuth();
    await store.remember('device', profile.id, CONN, NAMES, VALUES);
    await profiles.remove(profile.id);
    expect(await secure.get(secretKeys.connectionPasswords(profile.id))).toBeNull();
  });

  it('device records go through the credential gate', async () => {
    const { auth, profile, store } = await withAuth();
    let asked = 0;
    auth.setCredentialGate(async () => {
      asked++;
      return false;
    });
    await store.remember('device', profile.id, CONN, NAMES, VALUES);
    expect(await store.recall('device', profile.id, CONN, NAMES)).toBeNull();
    expect(asked).toBe(1);
  });
});
