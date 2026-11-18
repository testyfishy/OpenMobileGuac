import { GuacApi } from '../../core/api/GuacApi.ts';
import type { HttpClient } from '../../core/http/HttpClient.ts';
import {
  createHttpClient,
  createKeyValueStore,
  createSecureStore,
  isNativePlatform,
} from '../../core/platform.ts';
import type { KeyValueStore } from '../../core/storage/KeyValueStore.ts';
import { ProfileStore } from '../../core/storage/ProfileStore.ts';
import type { SecureStore } from '../../core/storage/SecureStore.ts';
import { AuthService } from './AuthService.ts';
import { getDevServer, type DevServer } from './devServer.ts';
import { SettingsStore } from './SettingsStore.ts';

/** How secrets are kept on this platform, for the UI to say so honestly (SRV-3). */
export type SecretStorageKind = 'secure' | 'insecure-dev' | 'memory';

export interface AppServices {
  readonly native: boolean;
  readonly http: HttpClient;
  readonly kv: KeyValueStore;
  readonly secure: SecureStore;
  readonly secretStorage: SecretStorageKind;
  readonly profiles: ProfileStore;
  /** For REST calls after sign-in. */
  readonly api: GuacApi;
  /** For probing URLs: a short timeout, because up to four candidates are tried in turn. */
  readonly probeApi: GuacApi;
  readonly auth: AuthService;
  readonly settings: SettingsStore;
  readonly devServer: DevServer | undefined;
}

export function createAppServices(): AppServices {
  const native = isNativePlatform();
  const http = createHttpClient();
  const kv = createKeyValueStore();
  const secure = createSecureStore();
  const secretStorage: SecretStorageKind = secure.protectedAtRest
    ? 'secure'
    : secure.persistent
      ? 'insecure-dev'
      : 'memory';
  const profiles = new ProfileStore(kv, { secureStore: secure });
  const api = new GuacApi(http, { timeoutMs: 20_000 });
  const probeApi = new GuacApi(http, { timeoutMs: 6_000 });
  const auth = new AuthService(api, secure, profiles);
  const devServer = getDevServer();
  if (devServer) auth.setVirtualPassword(devServer.profile.id, devServer.password);
  return {
    native,
    http,
    kv,
    secure,
    secretStorage,
    profiles,
    api,
    probeApi,
    auth,
    settings: new SettingsStore(kv),
    devServer,
  };
}
