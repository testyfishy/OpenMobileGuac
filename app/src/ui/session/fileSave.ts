/**
 * Where received files (downloads, print jobs) go, written as they arrive so a multi-GB file
 * never sits in memory (FIL-1, docs/protocol-notes.md §6.2).
 *
 * Native (iOS, Android), two ways in:
 * - **Stream endpoint (preferred).** As the web client does (`tunnelService.js`
 *   `downloadStream`), the file is fetched from `GET api/session/tunnels/{uuid}/streams/
 *   {index}/{name}`; the web application intercepts that stream and acks guacd itself
 *   (`OutputStreamInterceptingFilter.java`), so the data does not wait one round trip per
 *   4 KB blob. The request runs in native code (`Filesystem.downloadFile`: Android
 *   `HttpURLConnection` with the bridge's SSL socket factory, iOS `URLSession` download task),
 *   so CORS does not apply and the body goes straight to disk.
 * - **In band (fallback).** When the endpoint cannot be used (no tunnel id, the Demo, the
 *   request failed before any data), the `blob` instructions are appended to the file in
 *   ~768 KB base64 chunks (`writeFile`, then `appendFile`).
 *
 * Either way the data lands in a hidden `.omg-…part` file next to its destination, renamed
 * to a free name only once complete; a failed or cancelled transfer deletes it, and
 * `sweepDownloadCache()` removes leftovers at the next start.
 *
 * Destinations ("Received files" setting):
 * - `downloads` (default): kept. iOS: `Documents/Downloads`, shown in the Files app under
 *   On My iPhone › OpenMobileGuac (Info.plist `UIFileSharingEnabled`,
 *   `LSSupportsOpeningDocumentsInPlace`). Android 11+: the shared `Documents/OpenMobileGuac`
 *   folder, which apps may write without a storage permission (scoped storage). Android 8–10
 *   would need `WRITE_EXTERNAL_STORAGE` there, which the app does not request: it uses the
 *   app's own external folder (`Android/data/<app id>/files/Downloads`), which the Files app
 *   shows on those versions.
 * - `share`: the app cache, then the share sheet; the copy is deleted a while later
 *   (`downloadCache.ts`). Print jobs always open the share sheet (to print).
 *
 * Web: chunks are collected in memory and saved with a temporary `<a download>`.
 *
 * Never throws: failures resolve to an outcome the transfers panel can show.
 */

import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { safeFilename } from '../../session/transfer/TransferModel.ts';
import {
  bytesToBase64,
  candidateNames,
  partFileName,
  unwrapByteCounter,
} from '../../session/transfer/savedFiles.ts';
import {
  DOWNLOADS_FOLDER,
  ANDROID_DOCUMENTS_FOLDER,
  newDeliveryDir,
  removeCachedDelivery,
  scheduleCachedDeliveryRemoval,
} from './downloadCache.ts';
import { isPluginAvailable } from './platform.ts';
import { sessionStrings } from './sessionStrings.ts';
import type { ReceivedFilesMode } from './settings.ts';

export type DeliverResult =
  | {
      readonly ok: true;
      readonly outcome: string;
      /** A copy kept on the device (Downloads), which the transfers panel can share. */
      readonly savedUri?: string;
      readonly savedName?: string;
    }
  | { readonly ok: false; readonly error: string };

/** What a download stream is (from the `file` / `body` instruction). */
export interface ReceiveRequest {
  readonly filename: string;
  readonly mimetype: string;
  readonly print: boolean;
  readonly streamIndex: number;
}

/** In-band writing. */
export interface FileSink {
  /** Append bytes. Resolves when more may be sent (after a disk write, when one was due). */
  write(bytes: Uint8Array): Promise<void>;
  /** Everything arrived: finish the file and hand it over. */
  commit(): Promise<DeliverResult>;
  /** Drop what was written. Never throws. */
  discard(): Promise<void>;
}

/** A download through the stream endpoint, already started. */
export interface HttpReceive {
  /** Settles when the HTTP response has ended (`ok`: 2xx and fully read). Never rejects. */
  readonly done: Promise<{ readonly ok: boolean; readonly bytes: number }>;
  commit(): Promise<DeliverResult>;
  discard(): Promise<void>;
}

export interface FileReceiver {
  /** Start a stream-endpoint download, or `null` to receive in band. */
  http(req: ReceiveRequest, onProgress: (bytes: number) => void): HttpReceive | null;
  /** A sink for in-band data (synchronous on the web). */
  sink(req: ReceiveRequest): FileSink | Promise<FileSink>;
}

export interface StreamRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface FileReceiverOptions {
  /** "Received files" at the time the file arrives. */
  readonly mode: () => ReceivedFilesMode;
  /** The stream endpoint for a stream of the current tunnel, or null (no tunnel id, Demo). */
  readonly streamRequest?: (streamIndex: number, filename: string) => StreamRequest | null;
  readonly log?: (level: 'info' | 'warn', message: string) => void;
}

/** Bytes per append: a multiple of 3, so every chunk is standalone base64. */
const CHUNK_BYTES = 3 * 256 * 1024;
/** No data for this long ends a stream download (the server stalls if acks stop). */
const HTTP_IDLE_TIMEOUT_MS = 60_000;

function randomId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function native(): boolean {
  return isPluginAvailable('Filesystem');
}

// ---- Where a file goes ----------------------------------------------------------------

interface Place {
  readonly directory: Directory;
  readonly folder: string;
  /** Kept for the user (Downloads) or a temporary copy for the share sheet. */
  readonly keep: boolean;
}

let androidPublicDocuments: Promise<boolean> | null = null;

/**
 * Android: whether the shared Documents folder is writable without asking (API 30+: the
 * plugin reports the public storage permission as granted there, and it is never declared
 * for older versions, so `checkPermissions` is not granted on Android 8–10).
 */
function canUsePublicDocuments(): Promise<boolean> {
  androidPublicDocuments ??= Filesystem.checkPermissions()
    .then((p) => p.publicStorage === 'granted')
    .catch(() => false);
  return androidPublicDocuments;
}

async function placeFor(mode: ReceivedFilesMode): Promise<Place> {
  if (mode === 'share') {
    return { directory: Directory.Cache, folder: newDeliveryDir(), keep: false };
  }
  if (Capacitor.getPlatform() === 'android') {
    return (await canUsePublicDocuments())
      ? { directory: Directory.Documents, folder: ANDROID_DOCUMENTS_FOLDER, keep: true }
      : { directory: Directory.External, folder: DOWNLOADS_FOLDER, keep: true };
  }
  return { directory: Directory.Documents, folder: DOWNLOADS_FOLDER, keep: true };
}

async function ensureFolder(place: Place): Promise<void> {
  // Android's downloadFile does not create missing folders.
  await Filesystem.mkdir({
    path: place.folder,
    directory: place.directory,
    recursive: true,
  }).catch(() => undefined);
}

async function exists(path: string, directory: Directory): Promise<boolean> {
  try {
    await Filesystem.stat({ path, directory });
    return true;
  } catch {
    return false;
  }
}

/** Rename the finished part file to the first free name; returns that name and its URI. */
async function finalise(
  place: Place,
  partPath: string,
  name: string,
): Promise<{ name: string; uri: string }> {
  let lastError: unknown = new Error('no free name');
  for (const candidate of candidateNames(name)) {
    const to = `${place.folder}/${candidate}`;
    if (await exists(to, place.directory)) continue;
    try {
      await Filesystem.rename({
        from: partPath,
        to,
        directory: place.directory,
        toDirectory: place.directory,
      });
      const { uri } = await Filesystem.getUri({ path: to, directory: place.directory });
      return { name: candidate, uri };
    } catch (err) {
      // Android 11+: a file left by an earlier install is invisible to stat but taken.
      lastError = err;
    }
  }
  throw lastError;
}

async function removeQuietly(path: string, directory: Directory): Promise<void> {
  await Filesystem.deleteFile({ path, directory }).catch(() => undefined);
}

/** Share sheet for a file on the device. */
export async function shareSavedFile(uri: string, name: string, print = false): Promise<boolean> {
  if (!isPluginAvailable('Share')) return false;
  const t = sessionStrings.files;
  try {
    await Share.share({
      title: name,
      files: [uri],
      dialogTitle: print ? t.shareTitlePrint : t.shareTitle,
    });
    return true;
  } catch {
    // Closed by the user (the plugin rejects on cancel).
    return false;
  }
}

/** The finished file is in place: keep it, share it, or both. */
async function handOver(
  place: Place,
  saved: { name: string; uri: string },
  print: boolean,
): Promise<DeliverResult> {
  const t = sessionStrings.files;
  if (place.keep) {
    // A print job also opens the share sheet (to print); the PDF stays in Downloads.
    if (print) void shareSavedFile(saved.uri, saved.name, true);
    return { ok: true, outcome: t.savedToDownloads, savedUri: saved.uri, savedName: saved.name };
  }
  if (!isPluginAvailable('Share')) {
    await removeCachedDelivery(place.folder);
    return { ok: false, error: t.cannotShare };
  }
  const shared = await shareSavedFile(saved.uri, saved.name, print);
  // The receiving app may still be reading it when the sheet resolves (Android).
  scheduleCachedDeliveryRemoval(place.folder);
  return { ok: true, outcome: shared ? t.shared : t.shareClosed };
}

async function dropPlace(place: Place, partPath: string): Promise<void> {
  if (place.keep) await removeQuietly(partPath, place.directory);
  else await removeCachedDelivery(place.folder);
}

// ---- Native, in band ------------------------------------------------------------------

async function nativeSink(req: ReceiveRequest, mode: ReceivedFilesMode): Promise<FileSink> {
  const name = safeFilename(req.filename, req.print ? 'print.pdf' : 'download');
  const place = await placeFor(mode);
  await ensureFolder(place);
  const partPath = `${place.folder}/${partFileName(name, randomId())}`;
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let created = false;
  let chain: Promise<void> = Promise.resolve();
  let failed: unknown = null;

  const flush = (): Promise<void> => {
    const parts = pending;
    const size = pendingBytes;
    pending = [];
    pendingBytes = 0;
    chain = chain.then(async () => {
      if (failed) return;
      const joined = new Uint8Array(size);
      let off = 0;
      for (const p of parts) {
        joined.set(p, off);
        off += p.length;
      }
      try {
        // Each append is its own base64 string, decoded separately by the plugin.
        for (let i = 0; i < joined.length || !created; i += CHUNK_BYTES) {
          const data = bytesToBase64(joined.subarray(i, i + CHUNK_BYTES));
          if (!created) {
            await Filesystem.writeFile({ path: partPath, data, directory: place.directory });
            created = true;
          } else {
            await Filesystem.appendFile({ path: partPath, data, directory: place.directory });
          }
          if (joined.length === 0) break;
        }
      } catch (err) {
        failed = err;
      }
    });
    return chain;
  };

  return {
    async write(bytes) {
      if (failed) throw failed;
      pending.push(bytes);
      pendingBytes += bytes.length;
      if (pendingBytes >= CHUNK_BYTES) {
        // Backpressure: the caller acks the blob (and the server sends the next) only after
        // this write, so at most about one chunk is held in memory.
        await flush();
        if (failed) throw failed;
      }
    },
    async commit() {
      await flush();
      if (failed) {
        await dropPlace(place, partPath);
        return { ok: false, error: sessionStrings.files.noSpace };
      }
      try {
        const saved = await finalise(place, partPath, name);
        return await handOver(place, saved, req.print);
      } catch {
        await dropPlace(place, partPath);
        return { ok: false, error: sessionStrings.files.saveFailed };
      }
    },
    async discard() {
      failed ??= new Error('discarded');
      await chain.catch(() => undefined);
      await dropPlace(place, partPath);
    },
  };
}

// ---- Native, stream endpoint ----------------------------------------------------------

function nativeHttp(
  req: ReceiveRequest,
  stream: StreamRequest,
  mode: ReceivedFilesMode,
  onProgress: (bytes: number) => void,
  log: FileReceiverOptions['log'],
): HttpReceive {
  const name = safeFilename(req.filename, req.print ? 'print.pdf' : 'download');
  const placeP = placeFor(mode);
  const partP = placeP.then(async (place) => {
    await ensureFolder(place);
    return { place, partPath: `${place.folder}/${partFileName(name, randomId())}` };
  });
  let bytes = 0;
  const done = partP.then(
    async ({ place, partPath }) => {
      const listener = await Filesystem.addListener('progress', (p) => {
        if (p.url !== stream.url) return;
        bytes = unwrapByteCounter(bytes, p.bytes);
        onProgress(bytes);
      }).catch(() => null);
      try {
        await Filesystem.downloadFile({
          url: stream.url,
          headers: { ...stream.headers },
          path: partPath,
          directory: place.directory,
          progress: true,
          recursive: true,
          connectTimeout: HTTP_IDLE_TIMEOUT_MS,
          readTimeout: HTTP_IDLE_TIMEOUT_MS,
        });
        try {
          const st = await Filesystem.stat({ path: partPath, directory: place.directory });
          if (Number.isFinite(st.size)) bytes = Math.max(bytes, st.size);
        } catch {
          // keep the progress count
        }
        return { ok: true, bytes };
      } catch {
        log?.('warn', 'Stream download request failed');
        return { ok: false, bytes };
      } finally {
        void listener?.remove();
      }
    },
    () => ({ ok: false, bytes: 0 }),
  );
  return {
    done,
    async commit() {
      const { place, partPath } = await partP;
      try {
        const saved = await finalise(place, partPath, name);
        return await handOver(place, saved, req.print);
      } catch {
        await dropPlace(place, partPath);
        return { ok: false, error: sessionStrings.files.saveFailed };
      }
    },
    async discard() {
      try {
        const { place, partPath } = await partP;
        await dropPlace(place, partPath);
      } catch {
        // nothing was created
      }
    },
  };
}

// ---- Web ------------------------------------------------------------------------------

function memorySink(req: ReceiveRequest): FileSink {
  let parts: BlobPart[] = [];
  return {
    write(bytes) {
      parts.push(bytes as Uint8Array<ArrayBuffer>);
      return Promise.resolve();
    },
    commit() {
      const blob = new Blob(parts, { type: req.mimetype || 'application/octet-stream' });
      parts = [];
      return deliverBlob(blob, req.filename, { print: req.print });
    },
    discard() {
      parts = [];
      return Promise.resolve();
    },
  };
}

/** Web: hand a finished blob to the browser (`<a download>`). */
export function deliverBlob(
  blob: Blob,
  filename: string,
  options: { print?: boolean } = {},
): Promise<DeliverResult> {
  const name = safeFilename(filename, options.print ? 'print.pdf' : 'download');
  const t = sessionStrings.files;
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
    return Promise.resolve({ ok: true, outcome: t.savedByBrowser });
  } catch {
    return Promise.resolve({ ok: false, error: t.browserBlocked });
  }
}

/** The receiver for this platform. */
export function createFileReceiver(opts: FileReceiverOptions): FileReceiver {
  return {
    http(req, onProgress) {
      if (!native()) return null;
      const stream = opts.streamRequest?.(req.streamIndex, req.filename) ?? null;
      if (!stream) return null;
      return nativeHttp(req, stream, opts.mode(), onProgress, opts.log);
    },
    sink(req) {
      return native() ? nativeSink(req, opts.mode()) : memorySink(req);
    },
  };
}
