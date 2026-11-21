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
import { shouldSignOutAfterBackground } from '../sessions/sessionModel.ts';
import { AuthService } from './AuthService.ts';
import { BackgroundClock } from './backgroundClock.ts';
import { ConnectionSecrets } from './connectionSecrets.ts';
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
  /** When the app went to the background ("Sign out of servers after …"). */
  readonly backgroundClock: BackgroundClock;
  /** SRV-11: remembered answers to the remote computer's sign-in prompt. */
  readonly connectionSecrets: ConnectionSecrets;
}

/**
 * "Sign out of servers after …" for time spent while the app was not running: the system
 * may end a backgrounded app, so the persisted background time is checked at start-up,
 * before anything can sign in (`AuthService.setEntryCheck`).
 */
export async function signOutIfAwayTooLong(
  clock: BackgroundClock,
  settings: SettingsStore,
  auth: AuthService,
  log: Logger,
): Promise<void> {
  const at = await clock.take();
  if (at === null) return;
  const { serverSignOutAfterSeconds } = await settings.load();
  if (
    shouldSignOutAfterBackground({
      afterSeconds: serverSignOutAfterSeconds,
      backgroundedAt: at,
      now: Date.now(),
    })
  ) {
    log.info('auth', 'start-up after a long time in the background: signing out of servers');
    await auth.signOutAfterBackground();
  }
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
  const auth = new AuthService(api, secure, profiles, log, kv);
  // SRV-8 (review R2): a sign-in counts as "seen with system trust" only without a pin.
  auth.setPinnedCheck((url) => tls.pinFor(url) !== undefined);
  const settings = new SettingsStore(kv);
  const backgroundClock = new BackgroundClock(kv);
  auth.setEntryCheck(signOutIfAwayTooLong(backgroundClock, settings, auth, log));
  const devServer = overrides.devServer ?? getDevServer();
  if (devServer) auth.setVirtualPassword(devServer.profile.id, devServer.password);
  const lock = new LockService();
  // SRV-6(b): the one gate before any saved credential is used to sign in. The prompt text
  // is read at call time so it follows the current language.
  auth.setCredentialGate(() =>
    lock.ensureUnlocked(strings.lock.credentialReason, strings.lock.cancel),
  );
  auth.setUnlockWaiter(() => lock.whenUnlocked());
  // SRV-11: device-saved connection passwords pass the same gate as saved passwords; what is
  // kept in memory for a server is dropped when the app signs out of it. With "Ask for Face
  // ID / fingerprint …" on, every remembered value first passes the lock's presence check
  // (prompt text read at call time, naming the connection).
  const connectionSecrets = new ConnectionSecrets({
    secure,
    mayUseStored: () => auth.mayUseStoredSecret(),
    storedReady: () => auth.storedSecretsReady(),
    confirm: (label) =>
      lock.confirmPresence(strings.lock.connectionReason(label), strings.lock.cancel),
  });
  auth.onSignedOut((id) => connectionSecrets.forgetMemory(id));
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
    settings,
    devServer,
    shares: new ShareProfiles(),
    log,
    lock,
    tls,
    backgroundClock,
    connectionSecrets,
  };
}
