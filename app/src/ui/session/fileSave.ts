/**
 * Hands a received file (download or print job) to the user.
 *
 * - Native: written to the app cache with @capacitor/filesystem in base64 chunks
 *   (`writeFile` then `appendFile`, no `encoding` = base64 data, per the plugin's
 *   `WriteFileOptions` / `AppendFileOptions` docs), so a large file never becomes one giant
 *   string, then offered with the @capacitor/share sheet (`files: [uri]`). The cached copy
 *   is deleted a while after the sheet resolves, and any leftovers on the next app start
 *   (`downloadCache.ts`).
 * - Web: an object URL on a temporary `<a download>`.
 *
 * Never throws: failures resolve to an outcome the transfers panel can show.
 */

import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { safeFilename } from '../../session/transfer/TransferModel.ts';
import {
  newDeliveryDir,
  removeCachedDelivery,
  scheduleCachedDeliveryRemoval,
} from './downloadCache.ts';
import { isPluginAvailable } from './platform.ts';
import { sessionStrings } from './sessionStrings.ts';

export type DeliverResult =
  { readonly ok: true; readonly outcome: string } | { readonly ok: false; readonly error: string };

/** Bytes per append: a multiple of 3, so every chunk is standalone base64. */
const CHUNK_BYTES = 3 * 256 * 1024;

function base64OfBytes(bytes: Uint8Array): string {
  let bin = '';
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) {
    bin += String.fromCharCode(...bytes.subarray(i, i + STEP));
  }
  return btoa(bin);
}

async function writeNative(blob: Blob, path: string): Promise<string> {
  let first = true;
  for (let offset = 0; offset < blob.size || first; offset += CHUNK_BYTES) {
    const part = new Uint8Array(await blob.slice(offset, offset + CHUNK_BYTES).arrayBuffer());
    const data = base64OfBytes(part);
    if (first) {
      await Filesystem.writeFile({ path, data, directory: Directory.Cache, recursive: true });
      first = false;
    } else {
      await Filesystem.appendFile({ path, data, directory: Directory.Cache });
    }
    if (blob.size === 0) break;
  }
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  return uri;
}

/** Deliver `blob` as `filename`. `print` changes the share sheet title. */
export async function deliverFile(
  blob: Blob,
  filename: string,
  options: { print?: boolean } = {},
): Promise<DeliverResult> {
  const name = safeFilename(filename, options.print ? 'print.pdf' : 'download');
  const t = sessionStrings.files;
  if (isPluginAvailable('Filesystem')) {
    const dir = newDeliveryDir();
    const path = `${dir}/${name}`;
    let uri: string;
    try {
      uri = await writeNative(blob, path);
    } catch {
      await removeCachedDelivery(dir);
      return { ok: false, error: t.saveFailed };
    }
    if (!isPluginAvailable('Share')) {
      // Nothing can pick the file up from the private cache: do not leave it there.
      await removeCachedDelivery(dir);
      return { ok: false, error: t.cannotShare };
    }
    try {
      await Share.share({
        title: name,
        files: [uri],
        dialogTitle: options.print ? t.shareTitlePrint : t.shareTitle,
      });
      return { ok: true, outcome: t.shared };
    } catch {
      // The user closed the share sheet (the plugin rejects on cancel).
      return { ok: true, outcome: t.shareClosed };
    } finally {
      // The receiving app may still be reading it when the sheet resolves (Android).
      scheduleCachedDeliveryRemoval(dir);
    }
  }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return { ok: true, outcome: t.savedByBrowser };
  } catch {
    return { ok: false, error: t.browserBlocked };
  }
}
