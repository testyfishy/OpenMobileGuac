import { describe, expect, it } from 'vitest';
import { Logger } from '../../core/diagnostics/log.ts';
import { GuacApi } from '../../core/api/GuacApi.ts';
import { MemoryKeyValueStore } from '../../core/storage/KeyValueStore.ts';
import { ProfileStore } from '../../core/storage/ProfileStore.ts';
import { MemorySecureStore, secretKeys } from '../../core/storage/SecureStore.ts';
import { FakeHttpClient, jsonResponse } from '../../core/testing/FakeHttpClient.ts';
import { DEFAULT_APP_SETTINGS } from '../settings/settingsModel.ts';
import { signOutIfAwayTooLong } from './AppServices.ts';
import { AuthService } from './AuthService.ts';
import { BackgroundClock } from './backgroundClock.ts';
import { SettingsStore } from './SettingsStore.ts';

const BASE = 'https://guac.example/guacamole';

/** The app was ended while in the background, then started again (cold start). */
async function coldStart(afterSeconds: number | null, awayMs: number) {
  const kv = new MemoryKeyValueStore();
  const secure = new MemorySecureStore();
  const profiles = new ProfileStore(new MemoryKeyValueStore(), { secureStore: secure });
  const profile = await profiles.add({ name: 'Lab', baseUrl: BASE, rememberPassword: true });
  await secure.set(secretKeys.authToken(profile.id), 'tok');
  await secure.set(secretKeys.password(profile.id), 'pw');
  const settings = new SettingsStore(kv);
  await settings.save({ ...DEFAULT_APP_SETTINGS, serverSignOutAfterSeconds: afterSeconds });
  await kv.set('app/backgroundedAt', String(Date.now() - awayMs));
  const http = new FakeHttpClient().on('DELETE', `${BASE}/api/session`, () =>
    jsonResponse(204, null),
  );
  const auth = new AuthService(new GuacApi(http), secure, profiles, undefined, kv);
  const clock = new BackgroundClock(kv);
  auth.setEntryCheck(signOutIfAwayTooLong(clock, settings, auth, new Logger()));
  return { auth, profile, kv };
}

describe('start-up check for "Sign out of servers after …"', () => {
  it('signs out before the stored token can be used when the time has passed', async () => {
    const { auth, profile, kv } = await coldStart(60, 120_000);
    expect(await auth.loadToken(profile.id)).toBeNull();
    expect(await auth.loadSecrets(profile)).toMatchObject({
      password: null,
      signedOutInBackground: true,
    });
    expect(await kv.get('app/backgroundedAt')).toBeNull();
  });

  it('keeps the sign-in with "Never" or before the time, and clears the timestamp', async () => {
    for (const [after, away] of [
      [null, 10 * 24 * 3600_000],
      [300, 60_000],
    ] as const) {
      const { auth, profile, kv } = await coldStart(after, away);
      expect(await auth.loadToken(profile.id)).toBe('tok');
      expect((await auth.loadSecrets(profile)).password).toBe('pw');
      expect(await kv.get('app/backgroundedAt')).toBeNull();
    }
  });
});
