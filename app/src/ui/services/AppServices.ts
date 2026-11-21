import { GuacAdminApi } from '../../core/api/GuacAdminApi.ts';
import { GuacApi } from '../../core/api/GuacApi.ts';
import { Logger } from '../../core/diagnostics/log.ts';
import { LoggingHttpClient } from '../../core/diagnostics/LoggingHttpClient.ts';
import { LockService } from '../lock/LockService.ts';
import type { HttpClient } from '../../core/http/HttpClient.ts';
import {
  createHttpClient,
  createKeyValueStore,
  createSecureStore,
  getPinnedTlsPlugin,
  isNativePlatform,
} from '../../core/platform.ts';
import { TlsTrustService } from '../../core/tls/TlsTrustService.ts';
import { CacheFileKeyValueStore } from '../../core/storage/CacheFileKeyValueStore.ts';
import { MemoryKeyValueStore, type KeyValueStore } from '../../core/storage/KeyValueStore.ts';
import { ProfileStore } from '../../core/storage/ProfileStore.ts';
import type { SecureStore } from '../../core/storage/SecureStore.ts';
import { AuthService } from './AuthService.ts';
import { getDevServer, type DevServer } from './devServer.ts';
import { SettingsStore } from './SettingsStore.ts';
import { isShareServerId, ShareProfiles } from './shareSessions.ts';
import { strings } from '../strings.ts';

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
  /** Connection management (docs/protocol-notes.md §8). */
  readonly admin: GuacAdminApi;
  readonly auth: AuthService;
  readonly settings: SettingsStore;
  readonly devServer: DevServer | undefined;
  /** Share-link sessions opened in this run: memory-only virtual servers (CON-6). */
  readonly shares: ShareProfiles;
  /** Local-only diagnostics log (DIAG-1). */
  readonly log: Logger;
  /** Biometric / device-credential app lock (SRV-6). */
  readonly lock: LockService;
  /** Per-server certificate trust (SRV-8); `available` is false on the web build. */
  readonly tls: TlsTrustService;
}

/** Dev harnesses only (`?harness=admin`): swap the HTTP stack and the dev-server entry. */
export interface AppServiceOverrides {
  readonly http?: HttpClient;
  readonly devServer?: DevServer;
}

export function createAppServices(overrides: AppServiceOverrides = {}): AppServices {
  const native = isNativePlatform();
  const log = new Logger();
  const kv = createKeyValueStore();
  const secure = createSecureStore();
  const secretStorage: SecretStorageKind = secure.protectedAtRest
    ? 'secure'
    : secure.persistent
      ? 'insecure-dev'
      : 'memory';
  // AUDIT #12: thumbnails of remote screens go to the cache directory (never backed up) on
  // native, and stay in memory on the web, never in Preferences/localStorage.
  const profiles = new ProfileStore(kv, {
    secureStore: secure,
    isEphemeral: isShareServerId,
    thumbnails: native ? new CacheFileKeyValueStore() : new MemoryKeyValueStore(),
  });
  void profiles.purgeLegacyThumbnails();
  // SRV-8: a server with a trusted (pinned) certificate uses the native TLS path; every
  // other request goes to the system client unchanged (docs/tls.md).
  const tls = new TlsTrustService({ plugin: getPinnedTlsPlugin(), store: profiles });
  void tls.refresh().catch(() => undefined);
  const http = new LoggingHttpClient(overrides.http ?? tls.wrapHttpClient(createHttpClient()), log);
  const api = new GuacApi(http, { timeoutMs: 20_000 });
  const probeApi = new GuacApi(http, { timeoutMs: 6_000 });
  const admin = new GuacAdminApi(http, { timeoutMs: 20_000 });
  const auth = new AuthService(api, secure, profiles, log);
  const devServer = overrides.devServer ?? getDevServer();
  if (devServer) auth.setVirtualPassword(devServer.profile.id, devServer.password);
  const lock = new LockService();
  // SRV-6(b): the one gate before any saved credential is used to sign in. The prompt text
  // is read at call time so it follows the current language.
  auth.setCredentialGate(() =>
    lock.ensureUnlocked(strings.lock.credentialReason, strings.lock.cancel),
  );
  auth.setUnlockWaiter(() => lock.whenUnlocked());
  log.info('app', `started (${native ? 'native' : 'web'}, secrets: ${secretStorage})`);
  return {
    native,
    http,
    kv,
    secure,
    secretStorage,
    profiles,
    api,
    probeApi,
    admin,
    auth,
    settings: new SettingsStore(kv),
    devServer,
    shares: new ShareProfiles(),
    log,
    lock,
    tls,
  };
}
