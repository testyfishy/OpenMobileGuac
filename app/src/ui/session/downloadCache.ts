import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { isPartFileName } from '../../session/transfer/savedFiles.ts';

/**
 * Housekeeping for received files (`fileSave.ts`).
 *
 * - "Share, keep no copy": the file is written to `Cache/downloads/<random>/` only so the
 *   share sheet can hand it to another app. It is removed a while after the share sheet
 *   closes (the receiving app may still be reading the file when the sheet resolves) and, in
 *   case the app was closed before that, by `sweepDownloadCache()` on the next start.
 * - "Save to Downloads": kept files are never touched here. Only incomplete `.omg-…part`
 *   files that an earlier run left behind (the app was killed mid-download) are deleted.
 *
 * Kept free of session imports so the shell can call the sweep at startup without pulling
 * the session screen into the main bundle.
 */
export const DOWNLOAD_CACHE_DIR = 'downloads';

/** Kept downloads: `Documents/Downloads` (iOS), `Android/data/<app>/files/Downloads` (Android 8–10). */
export const DOWNLOADS_FOLDER = 'Downloads';
/** Kept downloads on Android 11+: the shared `Documents/OpenMobileGuac` folder. */
export const ANDROID_DOCUMENTS_FOLDER = 'OpenMobileGuac';

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

/** Deletes `.omg-…part` files in one kept-downloads folder. Never throws. */
async function sweepPartFiles(path: string, directory: Directory): Promise<void> {
  try {
    const r = await Filesystem.readdir({ path, directory });
    for (const f of r.files) {
      if (f.type === 'file' && isPartFileName(f.name)) {
        await Filesystem.deleteFile({ path: `${path}/${f.name}`, directory }).catch(
          () => undefined,
        );
      }
    }
  } catch {
    // no such folder yet
  }
}

/**
 * Startup: deletes everything left in `Cache/downloads/` by an earlier run, and incomplete
 * part files in the Downloads folders (never finished files). Never throws.
 */
export async function sweepDownloadCache(): Promise<void> {
  if (!available()) return;
  await Filesystem.rmdir({
    path: DOWNLOAD_CACHE_DIR,
    directory: Directory.Cache,
    recursive: true,
  }).catch(() => undefined);
  if (Capacitor.getPlatform() === 'android') {
    // The shared Documents folder only where it needs no permission (Android 11+), so the
    // sweep never asks for storage access.
    const publicOk = await Filesystem.checkPermissions()
      .then((p) => p.publicStorage === 'granted')
      .catch(() => false);
    if (publicOk) await sweepPartFiles(ANDROID_DOCUMENTS_FOLDER, Directory.Documents);
    await sweepPartFiles(DOWNLOADS_FOLDER, Directory.External);
  } else {
    await sweepPartFiles(DOWNLOADS_FOLDER, Directory.Documents);
  }
}
