import { describe, expect, it } from 'vitest';
import { GuacApi } from '../../core/api/GuacApi.ts';
import { HttpTransportError } from '../../core/http/HttpClient.ts';
import { MemoryKeyValueStore } from '../../core/storage/KeyValueStore.ts';
import { ProfileStore } from '../../core/storage/ProfileStore.ts';
import { MemorySecureStore, secretKeys, type SecureStore } from '../../core/storage/SecureStore.ts';
import { FakeHttpClient, jsonResponse } from '../../core/testing/FakeHttpClient.ts';
import { authResultJson, permissionDeniedJson } from '../../core/testing/fixtures.ts';
import { makeConnectDataBuilder } from '../launch/connectData.ts';
import { AuthService } from './AuthService.ts';
import { isShareServerId, makeShareProfile, ShareProfiles } from './shareSessions.ts';

const BASE = 'https://guac.example/guacamole';
const TOKENS = `${BASE}/api/tokens`;

async function setup(http: FakeHttpClient, secure: SecureStore = new MemorySecureStore()) {
  const profiles = new ProfileStore(new MemoryKeyValueStore(), { secureStore: secure });
  const profile = await profiles.add({ name: 'Lab', baseUrl: BASE, rememberPassword: true });
  const auth = new AuthService(new GuacApi(http), secure, profiles);
  return { auth, profile, profiles, secure };
}

describe('AuthService', () => {
  it('stores the token and the remembered password on login', async () => {
    const http = new FakeHttpClient().on('POST', TOKENS, () => jsonResponse(200, authResultJson));
    const { auth, profile, secure, profiles } = await setup(http);
    await auth.login(profile, { username: 'testuser', password: 'pw', remember: true, extra: {} });
    expect(await secure.get(secretKeys.authToken(profile.id))).toBe(authResultJson.authToken);
    expect(await secure.get(secretKeys.password(profile.id))).toBe('pw');
    expect((await profiles.get(profile.id))?.username).toBe('testuser');
    expect(auth.current(profile.id)?.token).toBe(authResultJson.authToken);
  });

  it('reset after an address change signs out on the old host and drops every secret (AUDIT #2)', async () => {
    const http = new FakeHttpClient()
      .on('POST', TOKENS, () => jsonResponse(200, authResultJson))
      .on('DELETE', `${BASE}/api/session`, () => jsonResponse(204, null));
    const { auth, profile, secure, profiles } = await setup(http);
    await auth.login(profile, { username: 'testuser', password: 'pw', remember: true, extra: {} });
    await auth.saveTotpSeed(profile.id, 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP');
    auth.markHttpConfirmed(profile.id);
    await auth.reset(profile.id);
    const moved = await profiles.update(profile.id, { baseUrl: 'https://new.example/guacamole' });
    for (const k of secretKeys.all(profile.id)) expect(await secure.get(k)).toBeNull();
    expect(auth.isHttpConfirmed(profile.id)).toBe(false);
    expect((await auth.loadSecrets(moved)).password).toBeNull();
    expect(await auth.loadToken(profile.id)).toBeNull();
    // The only request after sign-in was the DELETE to the *old* host.
    expect(http.requests.map((r) => `${r.method} ${r.url}`).slice(1)).toEqual([
      `DELETE ${BASE}/api/session`,
    ]);
  });

  it('does not read a stored token or password while the app lock is up (AUDIT #3)', async () => {
    const http = new FakeHttpClient();
    const { auth, profile, secure } = await setup(http);
    await secure.set(secretKeys.authToken(profile.id), 'tok');
    await secure.set(secretKeys.password(profile.id), 'pw');
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    auth.setUnlockWaiter(() => gate);
    let got: unknown = 'pending';
    void auth.loadSecrets(profile).then((v) => (got = v));
    const revalidated = auth
      .revalidate(profile, { httpAllowed: true, totpAutofill: false })
      .catch(() => 'rejected');
    await new Promise((r) => setTimeout(r, 10));
    expect(got).toBe('pending');
    expect(http.requests).toHaveLength(0);
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(got).toEqual({ token: 'tok', password: 'pw' });
    await revalidated;
  });

  it('keeps the token when resuming fails because the server is unreachable', async () => {
    const http = new FakeHttpClient().on('POST', TOKENS, (req) => {
      throw new HttpTransportError('unreachable', req.url, 'offline');
    });
    const { auth, profile, secure } = await setup(http);
    await secure.set(secretKeys.authToken(profile.id), 'tok');
    await expect(auth.resume(profile, 'tok')).rejects.toMatchObject({
      info: { kind: 'unreachable' },
    });
    expect(await secure.get(secretKeys.authToken(profile.id))).toBe('tok');
  });

  it('drops the token when the server rejects it', async () => {
    const http = new FakeHttpClient().on('POST', TOKENS, () =>
      jsonResponse(403, permissionDeniedJson),
    );
    const { auth, profile, secure } = await setup(http);
    await secure.set(secretKeys.authToken(profile.id), 'tok');
    await expect(auth.resume(profile, 'tok')).rejects.toMatchObject({
      info: { kind: 'session-expired' },
    });
    expect(await secure.get(secretKeys.authToken(profile.id))).toBeNull();
  });

  it('treats secure-storage failures after a successful login as non-fatal', async () => {
    const http = new FakeHttpClient().on('POST', TOKENS, () => jsonResponse(200, authResultJson));
    const failing: SecureStore = {
      protectedAtRest: true,
      persistent: true,
      get: async () => null,
      set: async () => {
        throw new Error('plugin missing');
      },
      remove: async () => {
        throw new Error('plugin missing');
      },
    };
    const { auth, profile } = await setup(http, failing);
    await expect(
      auth.login(profile, { username: 'u', password: 'pw', remember: true, extra: {} }),
    ).resolves.toMatchObject({ token: authResultJson.authToken });
  });

  it('asks the credential gate before using a saved password', async () => {
    const { auth, profile, secure } = await setup(new FakeHttpClient());
    await secure.set(secretKeys.password(profile.id), 'pw');
    let allow = false;
    let asked = 0;
    auth.setCredentialGate(async () => {
      asked++;
      return allow;
    });
    expect(await auth.hasSavedPassword(profile)).toBe(true);
    expect(asked).toBe(0);
    expect(await auth.loadSecrets(profile)).toMatchObject({ password: null, lockedOut: true });
    allow = true;
    expect((await auth.loadSecrets(profile)).password).toBe('pw');
    expect(asked).toBe(2);
  });

  it('re-signs in silently with the password and a TOTP code from the stored seed', async () => {
    const sent: Record<string, string>[] = [];
    const http = new FakeHttpClient()
      .on('HEAD', `${BASE}/api/session`, () => jsonResponse(403, permissionDeniedJson))
      .on('POST', TOKENS, (req) => {
        const fields = req.body?.kind === 'form' ? (req.body.fields as Record<string, string>) : {};
        sent.push(fields);
        if (!fields['guac-totp']) {
          return jsonResponse(403, {
            message: 'code',
            type: 'INSUFFICIENT_CREDENTIALS',
            expected: [{ name: 'guac-totp', type: 'GUAC_TOTP_CODE' }],
          });
        }
        return jsonResponse(200, authResultJson);
      });
    const { auth, profile, secure } = await setup(http);
    await secure.set(secretKeys.password(profile.id), 'pw');
    await auth.saveTotpSeed(profile.id, 'otpauth://totp/x?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    const result = await auth.revalidate(profile, { httpAllowed: true, totpAutofill: true });
    expect(result).toBe('relogged');
    expect(sent[1]?.['guac-totp']).toMatch(/^\d{6}$/);
    expect(sent[1]?.['password']).toBe('pw');
  });

  it('needs a sign-in when http is not allowed or no password is saved', async () => {
    const http = new FakeHttpClient().on('POST', TOKENS, () =>
      jsonResponse(403, permissionDeniedJson),
    );
    const { auth, profile, secure } = await setup(http);
    expect(await auth.revalidate(profile, { httpAllowed: true, totpAutofill: false })).toBe(
      'needs-sign-in',
    );
    await secure.set(secretKeys.password(profile.id), 'pw');
    expect(await auth.revalidate(profile, { httpAllowed: false, totpAutofill: false })).toBe(
      'needs-sign-in',
    );
  });

  it('clears password, token and TOTP seed', async () => {
    const { auth, profile, secure } = await setup(new FakeHttpClient());
    for (const k of secretKeys.all(profile.id)) await secure.set(k, 'x');
    await auth.clearCredentials(profile.id);
    for (const k of secretKeys.all(profile.id)) expect(await secure.get(k)).toBeNull();
  });

  it('hands a not-remembered password to the first sign-in only', async () => {
    const { auth, profile } = await setup(new FakeHttpClient());
    auth.setTransientPassword(profile.id, 'once');
    expect((await auth.loadSecrets(profile)).password).toBe('once');
    expect((await auth.loadSecrets(profile)).password).toBeNull();
  });
});

describe('makeConnectDataBuilder', () => {
  it('reads the token and media lazily at connect time', () => {
    let token = 'first';
    let calls = 0;
    const build = makeConnectDataBuilder({
      getToken: () => token,
      dataSource: 'postgresql',
      id: '7',
      type: 'c',
      timezone: 'Europe/London',
      media: () => {
        calls++;
        return { audio: ['audio/L16'], video: [], image: ['image/png'] };
      },
    });
    expect(calls).toBe(0);
    expect(build({ width: 1080.7, height: 1920, dpi: 288 })).toBe(
      'token=first&GUAC_DATA_SOURCE=postgresql&GUAC_ID=7&GUAC_TYPE=c&GUAC_WIDTH=1080' +
        '&GUAC_HEIGHT=1920&GUAC_DPI=288&GUAC_TIMEZONE=Europe%2FLondon' +
        '&GUAC_AUDIO=audio%2FL16&GUAC_IMAGE=image%2Fpng',
    );
    token = 'second';
    expect(build({ width: 1, height: 1, dpi: 96 })).toContain('token=second');
    expect(calls).toBe(2);
  });
});

describe('share-link sessions (CON-6)', () => {
  it('stay separate from a saved server and are never persisted', async () => {
    const SHARE_TOKEN = '5HA4E0000000000000000000000000000000000000000000000000000000000';
    let calls = 0;
    const http = new FakeHttpClient().on('POST', TOKENS, () => {
      calls++;
      return jsonResponse(
        200,
        calls === 1
          ? authResultJson
          : { ...authResultJson, authToken: SHARE_TOKEN, username: 'share-user' },
      );
    });
    const { auth, profile, secure, profiles } = await setup(http);
    await auth.login(profile, { username: 'testuser', password: 'pw', remember: true, extra: {} });

    const link = { baseUrl: BASE, key: 'k3y' };
    const share = makeShareProfile(link, BASE, 'guac.example', 1000, 'abc');
    expect(isShareServerId(share.id)).toBe(true);
    expect(isShareServerId(profile.id)).toBe(false);
    await auth.loginWithParameters(share, { key: link.key });

    // The saved server keeps its own sign-in, in memory and in storage.
    expect(auth.current(profile.id)?.token).toBe(authResultJson.authToken);
    expect(await secure.get(secretKeys.authToken(profile.id))).toBe(authResultJson.authToken);
    expect(await secure.get(secretKeys.password(profile.id))).toBe('pw');
    // The share session is memory only and nothing is stored under its id.
    expect(auth.current(share.id)?.token).toBe(SHARE_TOKEN);
    for (const key of secretKeys.all(share.id)) expect(await secure.get(key)).toBeNull();
    // The sign-in flow still finds it (from memory), so it does not ask for a password.
    expect(await auth.loadToken(share.id)).toBe(SHARE_TOKEN);
    await expect(auth.resume(share, SHARE_TOKEN)).resolves.toMatchObject({ token: SHARE_TOKEN });
    expect(await profiles.list()).toHaveLength(1);
  });

  it('never tries a password when a share session expires', async () => {
    const { auth } = await setup(new FakeHttpClient());
    const share = makeShareProfile({ baseUrl: BASE, key: 'k' }, BASE, 'x', 1, 'r');
    await expect(auth.revalidate(share, { httpAllowed: true, totpAutofill: true })).resolves.toBe(
      'needs-sign-in',
    );
  });

  it('keeps share profiles in memory only', () => {
    const shares = new ShareProfiles();
    const p = makeShareProfile({ baseUrl: BASE, key: 'k' }, BASE, 'x', 1, 'r');
    let changes = 0;
    shares.onChange(() => changes++);
    shares.add(p);
    expect(shares.get(p.id)).toEqual(p);
    expect(() => shares.add({ ...p, id: 'not-a-share' })).toThrow();
    shares.remove(p.id);
    expect(shares.list()).toEqual([]);
    expect(changes).toBe(2);
  });
});

describe('sign out of all servers', () => {
  const SESSION = `${BASE}/api/session`;

  it('removes passwords, tokens and TOTP seeds of every server and revokes stored tokens', async () => {
    const http = new FakeHttpClient()
      .on('POST', TOKENS, () => jsonResponse(200, authResultJson))
      .on('DELETE', SESSION, () => jsonResponse(204, null));
    const { auth, profile, profiles, secure } = await setup(http);
    const other = await profiles.add({
      name: 'Other',
      baseUrl: 'https://other.example/guacamole/',
      rememberPassword: true,
    });
    // A live session on the first server; only a stored token on the second (app restarted).
    await auth.login(profile, { username: 'testuser', password: 'pw', remember: true, extra: {} });
    await secure.set(secretKeys.totpSeed(profile.id), 'otpauth://totp/x?secret=ABC');
    await secure.set(secretKeys.authToken(other.id), 'stored-token');
    await secure.set(secretKeys.password(other.id), 'pw2');
    http.on('DELETE', 'https://other.example/guacamole/api/session', () => jsonResponse(204, null));
    const changed: string[] = [];
    auth.onSessionChange((id) => changed.push(id));

    const r = await auth.signOutEverywhere(await profiles.list());

    for (const id of [profile.id, other.id]) {
      for (const key of secretKeys.all(id)) expect(await secure.get(key), key).toBeNull();
      expect(auth.current(id)).toBeUndefined();
    }
    expect(changed.sort()).toEqual([profile.id, other.id].sort());
    const deletes = http.requests.filter((q) => q.method === 'DELETE');
    expect(deletes.map((q) => q.headers?.['Guacamole-Token']).sort()).toEqual(
      [authResultJson.authToken, 'stored-token'].sort(),
    );
    expect(r.serverSignOuts).toBe(2);
    // Server entries are kept (removing them is the caller's separate choice).
    expect((await profiles.list()).length).toBe(2);
  });

  it('still removes local secrets when a server cannot be reached', async () => {
    const http = new FakeHttpClient().on('DELETE', SESSION, (req) => {
      throw new HttpTransportError('unreachable', req.url, 'offline');
    });
    const { auth, profile, secure } = await setup(http);
    await secure.set(secretKeys.authToken(profile.id), 'tok');
    await secure.set(secretKeys.password(profile.id), 'pw');
    const r = await auth.signOutEverywhere([profile]);
    expect(await secure.get(secretKeys.authToken(profile.id))).toBeNull();
    expect(await secure.get(secretKeys.password(profile.id))).toBeNull();
    expect(r.serverSignOuts).toBe(0);
  });

  it('makes no server call for a server without a token', async () => {
    const http = new FakeHttpClient();
    const { auth, profile, secure } = await setup(http);
    await secure.set(secretKeys.password(profile.id), 'pw');
    await auth.signOutEverywhere([profile]);
    expect(http.requests).toEqual([]);
    expect(await secure.get(secretKeys.password(profile.id))).toBeNull();
  });
});

describe('signOutLocally', () => {
  it('returns once local data is gone, without waiting for the server', async () => {
    let release: () => void = () => undefined;
    const http = new FakeHttpClient()
      .on('POST', TOKENS, () => jsonResponse(200, authResultJson))
      .on(
        'DELETE',
        `${BASE}/api/session`,
        () => new Promise((r) => (release = () => r(jsonResponse(204, null)))),
      );
    const { auth, profile, secure } = await setup(http);
    await auth.login(profile, { username: 'testuser', password: 'pw', remember: true, extra: {} });
    await auth.signOutLocally([profile]);
    for (const k of secretKeys.all(profile.id)) expect(await secure.get(k)).toBeNull();
    expect(auth.current(profile.id)).toBeUndefined();
    release();
    await auth.signOutLocally([]);
  });
});

describe('AuthService: forced password change and Change password', () => {
  const expiredTotp = {
    message: 'TOTP enrollment must be completed before authentication can continue',
    translatableMessage: { key: 'TOTP.INFO_ENROLL_REQUIRED', variables: null },
    statusCode: null,
    expected: [{ name: 'guac-totp', type: 'GUAC_TOTP_CODE', secret: 'ABC' }],
    type: 'INSUFFICIENT_CREDENTIALS',
  };
  const reset = { 'new-password': 'New-pw-12345', 'confirm-new-password': 'New-pw-12345' };

  it('remembers the new password after a forced reset', async () => {
    const http = new FakeHttpClient().on('POST', TOKENS, () => jsonResponse(200, authResultJson));
    const { auth, profile, secure } = await setup(http);
    await auth.login(profile, { username: 'u', password: 'old', remember: true, extra: reset });
    expect(await secure.get(secretKeys.password(profile.id))).toBe('New-pw-12345');
  });

  it('remembers it as soon as the server moves on to TOTP (the reset is already stored)', async () => {
    const http = new FakeHttpClient().on('POST', TOKENS, () => jsonResponse(403, expiredTotp));
    const { auth, profile, secure } = await setup(http);
    await secure.set(secretKeys.password(profile.id), 'old');
    await expect(
      auth.login(profile, { username: 'u', password: 'old', remember: true, extra: reset }),
    ).rejects.toMatchObject({ info: { kind: 'additional-credentials-required' } });
    expect(await secure.get(secretKeys.password(profile.id))).toBe('New-pw-12345');
  });

  const PW_URL = `${BASE}/api/session/data/postgresql/users/testuser/password`;

  it('changes the password and replaces the saved one', async () => {
    const http = new FakeHttpClient()
      .on('POST', TOKENS, () => jsonResponse(200, authResultJson))
      .on('PUT', PW_URL, () => jsonResponse(204, null));
    const { auth, profile, secure } = await setup(http);
    await auth.login(profile, { username: 'testuser', password: 'pw', remember: true, extra: {} });
    const seen: string[] = [];
    auth.onPasswordChange((_id, pw) => seen.push(pw));
    expect(await auth.changePassword(profile, 'pw', 'pw2')).toEqual({ savedUpdated: true });
    expect(await secure.get(secretKeys.password(profile.id))).toBe('pw2');
    expect(seen).toEqual(['pw2']);
  });

  it('does not save a password that was not saved before', async () => {
    const http = new FakeHttpClient()
      .on('POST', TOKENS, () => jsonResponse(200, authResultJson))
      .on('PUT', PW_URL, () => jsonResponse(204, null));
    const { auth, profile, secure } = await setup(http);
    await auth.login(profile, { username: 'testuser', password: 'pw', remember: false, extra: {} });
    const p = { ...profile, rememberPassword: false };
    expect(await auth.changePassword(p, 'pw', 'pw2')).toEqual({ savedUpdated: false });
    expect(await secure.get(secretKeys.password(profile.id))).toBeNull();
  });

  it('keeps the saved password when the server refuses the change', async () => {
    const http = new FakeHttpClient()
      .on('POST', TOKENS, () => jsonResponse(200, authResultJson))
      .on('PUT', PW_URL, () => jsonResponse(403, permissionDeniedJson))
      .on('HEAD', `${BASE}/api/session`, () => jsonResponse(204, null));
    const { auth, profile, secure } = await setup(http);
    await auth.login(profile, { username: 'testuser', password: 'pw', remember: true, extra: {} });
    await expect(auth.changePassword(profile, 'wrong', 'pw2')).rejects.toMatchObject({
      info: { kind: 'invalid-credentials' },
    });
    expect(await secure.get(secretKeys.password(profile.id))).toBe('pw');
  });

  it('needs a live session', async () => {
    const { auth, profile } = await setup(new FakeHttpClient());
    await expect(auth.changePassword(profile, 'a', 'b')).rejects.toMatchObject({
      info: { kind: 'session-expired' },
    });
    expect(await auth.canChangePassword(profile.id)).toBe(false);
  });
});
