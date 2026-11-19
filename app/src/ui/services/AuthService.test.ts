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
