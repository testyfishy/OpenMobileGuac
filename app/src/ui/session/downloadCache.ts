import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';

/**
 * Received files (downloads, print jobs) are written to `Cache/downloads/` only so the
 * share sheet can hand them to another app. They are removed a while after the share sheet
 * closes (the receiving app may still be reading the file when the sheet resolves) and, in
 * case the app was closed before that, by `sweepDownloadCache()` on the next start.
 *
 * Kept free of other imports so the shell can call the sweep at startup without pulling
 * the session screen into the main bundle.
 */
export const DOWNLOAD_CACHE_DIR = 'downloads';

/** How long a shared file stays in the cache after the share sheet resolves. */
export const SHARED_FILE_TTL_MS = 2 * 60_000;

function available(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Filesystem');
  } catch {
    return false;
  }
}

/**
 * A fresh folder for one delivery (`downloads/<random>`), so two files with the same name
 * never share a path and one's delayed removal cannot delete the other mid-share.
 */
export function newDeliveryDir(): string {
  return `${DOWNLOAD_CACHE_DIR}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Deletes one delivery folder and its file. Never throws. */
export async function removeCachedDelivery(dir: string): Promise<void> {
  if (!available()) return;
  await Filesystem.rmdir({ path: dir, directory: Directory.Cache, recursive: true }).catch(
    () => undefined,
  );
}

/** Removes a delivery folder after `SHARED_FILE_TTL_MS` (best effort; the sweep is the backstop). */
export function scheduleCachedDeliveryRemoval(dir: string, delayMs = SHARED_FILE_TTL_MS): void {
  setTimeout(() => void removeCachedDelivery(dir), delayMs);
}

/** Startup: deletes everything left in `Cache/downloads/` by an earlier run. Never throws. */
export async function sweepDownloadCache(): Promise<void> {
  if (!available()) return;
  await Filesystem.rmdir({
    path: DOWNLOAD_CACHE_DIR,
    directory: Directory.Cache,
    recursive: true,
  }).catch(() => undefined);
}
