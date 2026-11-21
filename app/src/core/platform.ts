import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { FetchHttpClient } from './http/FetchHttpClient.ts';
import type { HttpClient } from './http/HttpClient.ts';
import { NativeHttpClient } from './http/NativeHttpClient.ts';
import { PooledNativeHttpClient } from './http/PooledNativeHttpClient.ts';
import {
  MemoryKeyValueStore,
  WebStorageKeyValueStore,
  type KeyValueStore,
} from './storage/KeyValueStore.ts';
import { NativeSecureStore } from './storage/NativeSecureStore.ts';
import { PreferencesKeyValueStore } from './storage/PreferencesKeyValueStore.ts';
import type { PinnedTlsPlugin } from './tls/plugin.ts';
import {
  InsecureDevLocalStorageSecureStore,
  MemorySecureStore,
  type SecureStore,
} from './storage/SecureStore.ts';

/**
 * Platform selection, kept in one place (PLAN T0.3). Everything else in core takes its
 * dependencies as constructor arguments.
 */

export interface PlatformOverrides {
  /** Forces native or web, for tests. Defaults to `Capacitor.isNativePlatform()`. */
  readonly native?: boolean;
  /** Forces dev mode, for tests. Defaults to `import.meta.env.DEV`. */
  readonly dev?: boolean;
  /** Forces the platform name, for tests. Defaults to `Capacitor.getPlatform()`. */
  readonly platform?: string;
}

export function isNativePlatform(overrides: PlatformOverrides = {}): boolean {
  return overrides.native ?? Capacitor.isNativePlatform();
}

/**
 * Native: Capacitor's native HTTP, which is not subject to CORS (SPEC §8.3).
 * Web: `fetch`, which in dev mode is expected to go through the Vite dev proxy.
 */
export function createHttpClient(
  overrides: PlatformOverrides = {},
  pooled?: { readonly plugin: PinnedTlsPlugin; readonly onFallback?: (reason: string) => void },
): HttpClient {
  if (!isNativePlatform(overrides)) return new FetchHttpClient();
  const capacitor = new NativeHttpClient();
  // iOS: CapacitorHttp's no-redirect mode opens a new URLSession (new TCP + TLS) for every
  // request; the app's plugin keeps one per server instead (PooledNativeHttpClient). Android's
  // HttpURLConnection pools connections with redirects off, so it stays on CapacitorHttp.
  const platform = overrides.platform ?? Capacitor.getPlatform();
  if (platform === 'ios' && pooled) {
    return new PooledNativeHttpClient(pooled.plugin, capacitor, pooled.onFallback);
  }
  return capacitor;
}

const pinnedTls = registerPlugin<PinnedTlsPlugin>('PinnedTls');

/**
 * SRV-8: the app's own `PinnedTls` plugin (app/plugins/omg-pinned-tls), or `undefined` on
 * the web and in a native build where it is not registered. `undefined` hides per-server
 * certificate trust and leaves every connection on the system path.
 */
export function getPinnedTlsPlugin(overrides: PlatformOverrides = {}): PinnedTlsPlugin | undefined {
  if (!isNativePlatform(overrides)) return undefined;
  if (overrides.native === undefined && !Capacitor.isPluginAvailable('PinnedTls')) return undefined;
  return pinnedTls;
}

/**
 * - Native: `NativeSecureStore` (iOS Keychain, "this device only", no iCloud sync; Android
 *   Keystore-encrypted storage) via `@aparajita/capacitor-secure-storage` (SRV-3).
 * - Web dev build: an INSECURE localStorage store, for convenience only.
 * - Web production build: memory only.
 *
 * The plugin's own web implementation is plain localStorage, so it is never used on web.
 */
export function createSecureStore(overrides: PlatformOverrides = {}): SecureStore {
  if (isNativePlatform(overrides)) {
    // Until `npx cap sync` registers the plugin in the native project, keep secrets in
    // memory (the UI then says they are not saved) rather than failing every write.
    const available =
      overrides.native !== undefined || Capacitor.isPluginAvailable('SecureStorage');
    if (!available) return new MemorySecureStore();
    return new NativeSecureStore(SecureStorage, {
      keychainAccess: KeychainAccess.whenUnlockedThisDeviceOnly,
    });
  }
  const dev = overrides.dev ?? import.meta.env.DEV;
  if (dev && typeof globalThis.localStorage !== 'undefined') {
    return new InsecureDevLocalStorageSecureStore(globalThis.localStorage);
  }
  return new MemorySecureStore();
}

/**
 * Non-secret app data (profiles, favourites, recents, settings).
 * - Native: Capacitor Preferences, which the OS does not evict the way it may evict WebView
 *   storage.
 * - Web: `localStorage`, or memory when it is unavailable.
 */
export function createKeyValueStore(overrides: PlatformOverrides = {}): KeyValueStore {
  if (isNativePlatform(overrides)) return new PreferencesKeyValueStore(Preferences);
  if (typeof globalThis.localStorage !== 'undefined') {
    return new WebStorageKeyValueStore(globalThis.localStorage);
  }
  return new MemoryKeyValueStore();
}
