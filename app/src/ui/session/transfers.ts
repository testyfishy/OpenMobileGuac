/**
 * File transfer glue (FIL-1): downloads the server pushes, filesystem objects (browse,
 * download, upload) and uploads without a filesystem, over the Guacamole tunnel itself.
 *
 * Deliberate deviation from the web client: upstream 1.6.0 moves file data over REST
 * (`rest/services/tunnelService.js` `downloadStream` / `uploadToStream`, which the web
 * application intercepts server side, `OutputStreamInterceptingFilter.java`). The app has
 * no same-origin REST channel for streams, so data goes in band as `blob` instructions,
 * which is the library's native path. Wire behaviour, read from the sources:
 *
 * - Download (`file` from the server, or the `body` of a requested file): guacd sends
 *   each blob only after a SUCCESS ack (guacamole-server `rdp/download.c`
 *   `guac_rdp_download_ack_handler`; the print job waits the same way, `rdp/print-job.c`).
 *   The interceptor normally sends the first ack ("OK"); here the client sends
 *   `ack <stream> OK 0` itself, then `BlobReader` acks every blob ("OK", 0x0000). A non-
 *   success ack aborts the stream (used for Cancel).
 * - Listing: `object.requestInputStream(dir, cb)` (`get`); the `body` must have the
 *   stream-index mimetype, else `ack "Unexpected mimetype" UNSUPPORTED`; then
 *   `ack "Ready" SUCCESS` and `ack "Received" SUCCESS` per blob, exactly as
 *   `ManagedFilesystem.refresh`. guacd writes the next JSON part on each ack
 *   (`rdp/ls.c`). Read as raw bytes (UTF-8 decoded once at the end) because the library's
 *   StringReader mangles characters above U+FFFF.
 * - Upload: `object.createOutputStream(type, dir + '/' + name)` (`put`) or
 *   `client.createFileStream(type, name)` (`file`), as `ManagedFileUpload`. The data starts
 *   only after the first ack ("OK (STREAM BEGIN)", `rdp/upload.c`), then `BlobWriter`
 *   sends one blob per ack; `sendEnd` after completion. An error ack (e.g. CLIENT_FORBIDDEN
 *   "FAIL (UPLOAD DISABLED)") fails the transfer.
 * - A disabled download sends no `body` at all (`rdp/download.c` only logs), so requests
 *   time out.
 */

import Guacamole from '../../vendor/guacamole-common-js';
import {
  ROOT_STREAM,
  STREAM_INDEX_MIMETYPE,
  baseName,
  parseDirectoryIndex,
  uploadStreamName,
  type DirectoryEntry,
} from '../../session/transfer/directoryIndex.ts';
import {
  isFinished,
  reduceTransfers,
  type Transfer,
  type TransferEvent,
} from '../../session/transfer/TransferModel.ts';
import { decodeUtf8Chunks } from './clipboardText.ts';
import type { DeliverResult } from './fileSave.ts';

type GuacClient = InstanceType<typeof Guacamole.Client>;
type GuacObject = InstanceType<typeof Guacamole.Object>;
type InputStream = InstanceType<typeof Guacamole.InputStream>;
type OutputStream = InstanceType<typeof Guacamole.OutputStream>;

const SUCCESS = 0x0000;
const UNSUPPORTED = 0x0100;
/** Status sent to abort a download the user cancelled (any non-success code aborts). */
const ABORT = 0x0300;
const REQUEST_TIMEOUT_MS = 20_000;
const PUBLISH_MS = 150;

export interface FilesystemView {
  readonly id: number;
  readonly name: string;
  readonly cwd: string;
  readonly entries: readonly DirectoryEntry[];
  readonly loading: boolean;
  readonly error: string | null;
}

export interface TransfersSnapshot {
  readonly transfers: readonly Transfer[];
  readonly filesystems: readonly FilesystemView[];
}

export interface TransferManagerOptions {
  readonly deliver: (blob: Blob, filename: string, print: boolean) => Promise<DeliverResult>;
  readonly log: (level: 'info' | 'warn' | 'error', message: string) => void;
  /** A pushed download or print job finished or failed (for a toast). */
  readonly notify?: (text: string) => void;
}

interface FsState {
  view: FilesystemView;
  object: GuacObject;
  /** Generation of the latest listing request, to drop stale answers. */
  listGen: number;
  timer: ReturnType<typeof setTimeout> | null;
}

interface Active {
  cancel: () => void;
  timer: ReturnType<typeof setTimeout> | null;
}

export class TransferManager {
  private readonly opts: TransferManagerOptions;
  private client: GuacClient | null = null;
  private transfers: readonly Transfer[] = [];
  private readonly fs = new Map<number, FsState>();
  private readonly active = new Map<number, Active>();
  private nextId = 1;
  private nextFsId = 1;
  private snapshot: TransfersSnapshot = { transfers: [], filesystems: [] };
  private readonly listeners = new Set<() => void>();
  private publishTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: TransferManagerOptions) {
    this.opts = opts;
  }

  // ---- Store

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getSnapshot = (): TransfersSnapshot => this.snapshot;

  private publish(now = false): void {
    if (now) {
      if (this.publishTimer) clearTimeout(this.publishTimer);
      this.publishTimer = null;
      this.flushSnapshot();
      return;
    }
    if (this.publishTimer) return;
    this.publishTimer = setTimeout(() => {
      this.publishTimer = null;
      this.flushSnapshot();
    }, PUBLISH_MS);
  }

  private flushSnapshot(): void {
    this.snapshot = {
      transfers: this.transfers,
      filesystems: [...this.fs.values()].map((f) => f.view),
    };
    for (const l of this.listeners) l();
  }

  private apply(e: TransferEvent, now = true): void {
    this.transfers = reduceTransfers(this.transfers, e);
    this.publish(now);
  }

  hasFilesystem(): boolean {
    return this.fs.size > 0;
  }

  activeCount(): number {
    return this.transfers.filter((t) => !isFinished(t)).length;
  }

  // ---- Client lifecycle

  /** Install the handlers on a new client. */
  install(client: GuacClient): void {
    this.client = client;
    client.onfile = (stream, mimetype, filename) => {
      this.opts.log('info', `Server started a download (${mimetype})`);
      this.download(stream, mimetype, filename);
    };
    client.onfilesystem = (object, name) => this.addFilesystem(object, name);
  }

  /** The client is gone (disconnect, reconnect, unmount): fail what is in flight. */
  detachClient(): void {
    const c = this.client;
    if (c) {
      c.onfile = null;
      c.onfilesystem = null;
    }
    this.client = null;
    for (const [id, a] of this.active) {
      if (a.timer) clearTimeout(a.timer);
      this.transfers = reduceTransfers(this.transfers, {
        type: 'fail',
        id,
        at: Date.now(),
        message: 'The connection closed during the transfer.',
      });
    }
    this.active.clear();
    for (const f of this.fs.values()) if (f.timer) clearTimeout(f.timer);
    this.fs.clear();
    this.publish(true);
  }

  dispose(): void {
    this.detachClient();
    if (this.publishTimer) clearTimeout(this.publishTimer);
    this.publishTimer = null;
    this.listeners.clear();
  }

  clearFinished(): void {
    this.apply({ type: 'clear-finished' });
  }

  cancel(id: number): void {
    const a = this.active.get(id);
    if (!a) return;
    a.cancel();
  }

  // ---- Downloads

  /** Receive a download stream (server push, or the body of a requested file). */
  private download(stream: InputStream, mimetype: string, filename: string, existingId?: number) {
    const id = existingId ?? this.nextId++;
    if (existingId === undefined) {
      this.apply({
        type: 'start',
        id,
        direction: 'download',
        name: filename,
        mimetype,
        at: Date.now(),
      });
    }
    const transfer = this.transfers.find((t) => t.id === id);
    const print = transfer?.kind === 'print';
    const reader = new Guacamole.BlobReader(stream, mimetype || 'application/octet-stream');
    let cancelled = false;
    reader.onprogress = () => {
      if (!cancelled) this.apply({ type: 'progress', id, bytes: reader.getLength() }, false);
    };
    reader.onend = () => {
      if (cancelled) return;
      this.active.delete(id);
      const blob = reader.getBlob();
      this.apply({ type: 'progress', id, bytes: blob.size });
      void this.opts.deliver(blob, filename, print).then((r) => {
        if (r.ok) {
          this.apply({ type: 'done', id, at: Date.now(), outcome: r.outcome });
          this.opts.notify?.(`${print ? 'Print job' : 'Download'} ready: ${filename}`);
        } else {
          this.apply({ type: 'fail', id, at: Date.now(), message: r.error });
          this.opts.notify?.(r.error);
        }
      });
    };
    this.active.set(id, {
      timer: null,
      cancel: () => {
        cancelled = true;
        this.active.delete(id);
        // Stop the reader from acking further blobs, then abort the stream on the server.
        stream.onblob = null;
        stream.onend = null;
        stream.sendAck('Cancelled', ABORT);
        this.apply({ type: 'cancel', id, at: Date.now() });
      },
    });
    this.apply({ type: 'open', id });
    // The server sends the first blob only after this ack (see the header).
    stream.sendAck('OK', SUCCESS);
  }

  // ---- Filesystems

  private addFilesystem(object: GuacObject, name: string): void {
    const id = this.nextFsId++;
    const state: FsState = {
      object,
      listGen: 0,
      timer: null,
      view: {
        id,
        name: name || 'Remote files',
        cwd: ROOT_STREAM,
        entries: [],
        loading: false,
        error: null,
      },
    };
    this.fs.set(id, state);
    object.onundefine = () => {
      if (state.timer) clearTimeout(state.timer);
      this.fs.delete(id);
      this.opts.log('info', 'A filesystem was removed by the server');
      this.publish(true);
    };
    this.opts.log('info', 'Server exposed a filesystem');
    this.publish(true);
  }

  private updateFs(id: number, patch: Partial<FilesystemView>): void {
    const f = this.fs.get(id);
    if (!f) return;
    f.view = { ...f.view, ...patch };
    this.publish(true);
  }

  /** List `dir` (default: the current folder) and make it current. */
  list(fsId: number, dir?: string): void {
    const f = this.fs.get(fsId);
    if (!f || !this.client) return;
    const target = dir ?? f.view.cwd;
    const gen = ++f.listGen;
    if (f.timer) clearTimeout(f.timer);
    f.timer = setTimeout(() => {
      if (f.listGen !== gen) return;
      f.listGen++;
      this.updateFs(fsId, { loading: false, error: 'The folder listing timed out.' });
    }, REQUEST_TIMEOUT_MS);
    this.updateFs(fsId, { cwd: target, loading: true, error: null });
    f.object.requestInputStream(target, (stream, mimetype) => {
      if (mimetype !== STREAM_INDEX_MIMETYPE) {
        stream.sendAck('Unexpected mimetype', UNSUPPORTED);
        if (f.listGen === gen) {
          if (f.timer) clearTimeout(f.timer);
          this.updateFs(fsId, { loading: false, error: 'This item is not a folder.' });
        }
        return;
      }
      const stale = () => f.listGen !== gen || this.fs.get(fsId) !== f;
      const chunks: ArrayBuffer[] = [];
      const reader = new Guacamole.ArrayBufferReader(stream);
      reader.ondata = (buf) => {
        chunks.push(buf);
        stream.sendAck('Received', SUCCESS);
      };
      reader.onend = () => {
        if (stale()) return;
        if (f.timer) clearTimeout(f.timer);
        const r = parseDirectoryIndex(decodeUtf8Chunks(chunks), target);
        if (r.ok) this.updateFs(fsId, { loading: false, entries: r.entries, error: null });
        else this.updateFs(fsId, { loading: false, error: r.error });
      };
      stream.sendAck('Ready', SUCCESS);
    });
  }

  /** Download a file from a filesystem (like `ManagedFilesystem.downloadFile`). */
  downloadFromFilesystem(fsId: number, entry: DirectoryEntry): void {
    const f = this.fs.get(fsId);
    if (!f || !this.client || entry.isDirectory) return;
    const id = this.nextId++;
    const name = baseName(entry.streamName) || entry.name;
    this.apply({
      type: 'start',
      id,
      direction: 'download',
      name,
      mimetype: entry.mimetype,
      at: Date.now(),
    });
    let answered = false;
    const timer = setTimeout(() => {
      if (answered) return;
      this.active.delete(id);
      this.apply({
        type: 'fail',
        id,
        at: Date.now(),
        message: 'The server did not send the file. Downloads may be disabled for this connection.',
      });
    }, REQUEST_TIMEOUT_MS);
    this.active.set(id, {
      timer,
      cancel: () => {
        answered = true;
        clearTimeout(timer);
        this.active.delete(id);
        this.apply({ type: 'cancel', id, at: Date.now() });
      },
    });
    f.object.requestInputStream(entry.streamName, (stream, mimetype) => {
      const t = this.transfers.find((x) => x.id === id);
      if (answered || !t || isFinished(t)) {
        // Timed out or cancelled meanwhile: refuse the late body.
        stream.sendAck('Cancelled', ABORT);
        return;
      }
      answered = true;
      clearTimeout(timer);
      this.download(stream, mimetype, name, id);
    });
  }

  // ---- Uploads

  /**
   * Upload files into a filesystem folder (`fsId` + `dir`), or, when `fsId` is null, as
   * plain file streams the server handles itself (e.g. RDP drive upload folder).
   */
  upload(files: readonly File[], fsId: number | null, dir?: string): void {
    const client = this.client;
    if (!client) return;
    const f = fsId !== null ? this.fs.get(fsId) : undefined;
    if (fsId !== null && !f) return;
    for (const file of files) {
      const id = this.nextId++;
      const folder = f ? (dir ?? f.view.cwd) : null;
      let stream: OutputStream;
      try {
        stream =
          f && folder !== null
            ? f.object.createOutputStream(file.type, uploadStreamName(folder, file.name))
            : client.createFileStream(file.type, file.name);
      } catch {
        continue;
      }
      this.apply({
        type: 'start',
        id,
        direction: 'upload',
        name: file.name,
        mimetype: file.type,
        size: file.size,
        destination: f && folder !== null ? `${f.view.name} ${folder}` : 'Remote computer',
        at: Date.now(),
      });
      this.opts.log('info', `Upload started (${file.size} bytes)`);
      this.startUpload(id, stream, file, fsId, folder);
    }
  }

  private startUpload(
    id: number,
    stream: OutputStream,
    file: File,
    fsId: number | null,
    folder: string | null,
  ): void {
    let done = false;
    const fail = (status: { code: number; message?: string } | null, message?: string) => {
      if (done) return;
      done = true;
      this.active.delete(id);
      stream.onack = null;
      this.apply({
        type: 'fail',
        id,
        at: Date.now(),
        code: status?.code ?? null,
        message: status?.message ?? message,
      });
      this.opts.log(
        'warn',
        `Upload failed (code ${status ? '0x' + status.code.toString(16) : 'none'})`,
      );
    };
    this.active.set(id, {
      timer: null,
      cancel: () => {
        if (done) return;
        done = true;
        this.active.delete(id);
        // BlobWriter has no abort: detach it from the stream's acks so it stops reading,
        // then end the stream (the server keeps what it received so far).
        stream.onack = () => undefined;
        try {
          stream.sendEnd();
        } catch {
          // client gone
        }
        this.apply({ type: 'cancel', id, at: Date.now() });
      },
    });
    // First ack = the server accepted the stream. Only then start the writer, so the
    // "STREAM BEGIN" ack is not taken for a chunk ack.
    stream.onack = (status) => {
      if (done) return;
      if (status.isError()) {
        fail(status);
        return;
      }
      this.apply({ type: 'open', id });
      const writer = new Guacamole.BlobWriter(stream);
      writer.onack = (s) => {
        if (s.isError()) fail(s);
      };
      writer.onprogress = (_blob, offset) => {
        if (!done) this.apply({ type: 'progress', id, bytes: Math.min(file.size, offset) }, false);
      };
      writer.onerror = () => fail(null, 'The file could not be read on this device.');
      writer.oncomplete = () => {
        if (done) return;
        done = true;
        this.active.delete(id);
        writer.sendEnd();
        this.apply({ type: 'done', id, at: Date.now() });
        this.opts.log('info', 'Upload finished');
        if (fsId !== null && folder !== null) {
          const fsState = this.fs.get(fsId);
          if (fsState && fsState.view.cwd === folder) this.list(fsId, folder);
        }
      };
      writer.sendBlob(file);
    };
  }
}
