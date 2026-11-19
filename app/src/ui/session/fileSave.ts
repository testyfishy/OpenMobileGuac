/**
 * Hands a received file (download or print job) to the user.
 *
 * - Native: written to the app cache with @capacitor/filesystem in base64 chunks
 *   (`writeFile` then `appendFile`, no `encoding` = base64 data, per the plugin's
 *   `WriteFileOptions` / `AppendFileOptions` docs), so a large file never becomes one giant
 *   string, then offered with the @capacitor/share sheet (`files: [uri]`).
 * - Web: an object URL on a temporary `<a download>`.
 *
 * Never throws: failures resolve to an outcome the transfers panel can show.
 */

import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { safeFilename } from '../../session/transfer/TransferModel.ts';
import { isPluginAvailable } from './platform.ts';

export type DeliverResult =
  { readonly ok: true; readonly outcome: string } | { readonly ok: false; readonly error: string };

/** Bytes per append: a multiple of 3, so every chunk is standalone base64. */
const CHUNK_BYTES = 3 * 256 * 1024;
const CACHE_DIR = 'downloads';

function base64OfBytes(bytes: Uint8Array): string {
  let bin = '';
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) {
    bin += String.fromCharCode(...bytes.subarray(i, i + STEP));
  }
  return btoa(bin);
}

async function writeNative(blob: Blob, name: string): Promise<string> {
  const path = `${CACHE_DIR}/${name}`;
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
  if (isPluginAvailable('Filesystem')) {
    let uri: string;
    try {
      uri = await writeNative(blob, name);
    } catch {
      return { ok: false, error: 'The file could not be saved on this device.' };
    }
    if (!isPluginAvailable('Share')) return { ok: true, outcome: 'Saved in the app cache' };
    try {
      await Share.share({
        title: name,
        files: [uri],
        dialogTitle: options.print ? 'Print or save the document' : 'Save or open the file',
      });
      return { ok: true, outcome: 'Shared' };
    } catch {
      // The user closed the share sheet (the plugin rejects on cancel).
      return { ok: true, outcome: 'Kept in the app cache (share sheet closed)' };
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
    return { ok: true, outcome: 'Saved by the browser' };
  } catch {
    return { ok: false, error: 'The browser did not allow the download.' };
  }
}
