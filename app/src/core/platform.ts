import { Capacitor } from '@capacitor/core';
import { FetchHttpClient } from './http/FetchHttpClient.ts';
import type { HttpClient } from './http/HttpClient.ts';
import { NativeHttpClient } from './http/NativeHttpClient.ts';
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
}

export function isNativePlatform(overrides: PlatformOverrides = {}): boolean {
  return overrides.native ?? Capacitor.isNativePlatform();
}

/**
 * Native: Capacitor's native HTTP, which is not subject to CORS (SPEC §8.3).
 * Web: `fetch`, which in dev mode is expected to go through the Vite dev proxy.
 */
export function createHttpClient(overrides: PlatformOverrides = {}): HttpClient {
  return isNativePlatform(overrides) ? new NativeHttpClient() : new FetchHttpClient();
}

/**
 * - Native: TODO(native-secure-store). Keychain/Keystore are not wired up yet, so this
 *   returns a memory-only store. Secrets are not persisted and never touch plain storage
 *   (SRV-3).
 * - Web dev build: an INSECURE localStorage store, for convenience only.
 * - Web production build: memory only.
 */
export function createSecureStore(overrides: PlatformOverrides = {}): SecureStore {
  if (isNativePlatform(overrides)) return new MemorySecureStore();
  const dev = overrides.dev ?? import.meta.env.DEV;
  if (dev && typeof globalThis.localStorage !== 'undefined') {
    return new InsecureDevLocalStorageSecureStore(globalThis.localStorage);
  }
  return new MemorySecureStore();
}
