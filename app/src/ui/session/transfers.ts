/**
 * File transfer glue (FIL-1): downloads the server pushes, filesystem objects (browse,
 * download, upload) and uploads without a filesystem, over the Guacamole tunnel itself.
 *
 * Downloads, two paths (`fileSave.ts` decides which):
 *
 * - **Stream endpoint** (native, as the web client: `tunnelService.js` `downloadStream`).
 *   The file is fetched from `api/session/tunnels/{uuid}/streams/{index}/{name}`; the web
 *   application intercepts the stream, sends guacd the first ack and acks every blob itself
 *   (`OutputStreamInterceptingFilter.java`). After each `sync` it forwards one blob with
 *   empty data and leaves that ack to the client, so the client keeps acking every blob it
 *   sees ("Acknowledge (and ignore) any received blobs"). The `end` instruction passes
 *   through. The HTTP response also ends normally when the tunnel closes or when the
 *   tunnel was not open (`StreamInterceptingFilter.interceptStream` returns at once), so a
 *   file counts as complete only when the in-band `end` arrived as well.
 *   Cancel: the native request has no abort, and an error ack makes guacd free the stream
 *   without `end` (`rdp/download.c`), leaving the server's intercepted stream open under
 *   an index guacd may reuse. So Cancel only stops acking the forced blobs: guacd stalls
 *   at the next `sync` (a frame; on a remote screen that is not changing that may not come
 *   soon, and the file may finish downloading first), the native request then times out
 *   (60 s without data), and the part file is deleted either way. Acks resume once the
 *   request has ended, so guacd writes again, the server's write to the closed response
 *   fails and it closes the stream properly (error ack to guacd).
 *   If the request fails before any data (old server, refused), the stream was never
 *   intercepted: the download falls back to in band.
 * - **In band** (web, Demo, fallback): guacd sends each blob only after a SUCCESS ack
 *   (guacamole-server `rdp/download.c` `guac_rdp_download_ack_handler`; the print job waits
 *   the same way, `rdp/print-job.c`). The client sends `ack <stream> OK 0` itself, then acks
 *   every blob after it is written (backpressure for the disk). A non-success ack aborts the
 *   stream (used for Cancel and write errors).
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
  isPrintJob,
  reduceTransfers,
  type Transfer,
  type TransferEvent,
} from '../../session/transfer/TransferModel.ts';
import { decodeUtf8Chunks } from './clipboardText.ts';
import { base64ToBytes } from '../../session/transfer/savedFiles.ts';
import type {
  DeliverResult,
  FileReceiver,
  FileSink,
  HttpReceive,
  ReceiveRequest,
} from './fileSave.ts';
import { decideIncoming } from './incomingFiles.ts';
import { sessionStrings } from './sessionStrings.ts';
import type { RemoteFilesPolicy } from './settings.ts';

type GuacClient = InstanceType<typeof Guacamole.Client>;
type GuacObject = InstanceType<typeof Guacamole.Object>;
type InputStream = InstanceType<typeof Guacamole.InputStream>;
type OutputStream = InstanceType<typeof Guacamole.OutputStream>;

const SUCCESS = 0x0000;
const UNSUPPORTED = 0x0100;
/** Status sent to abort a download the user cancelled (any non-success code aborts). */
const ABORT = 0x0300;
/**
 * Status sent when the user declines a pushed file (CLIENT_FORBIDDEN). guacd's download and
 * print-job ack handlers end the stream on any non-success status (guacamole-server 1.6.0
 * `rdp/download.c` `guac_rdp_download_ack_handler`, `rdp/print-job.c`).
 */
export const DECLINED = 0x0303;
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

/** A file the remote pushed, waiting for the user's Accept / Decline. */
export interface IncomingPrompt {
  readonly id: number;
  readonly filename: string;
  readonly mimetype: string;
  readonly print: boolean;
}

export interface TransfersSnapshot {
  readonly transfers: readonly Transfer[];
  readonly filesystems: readonly FilesystemView[];
  /** Pushed files waiting for consent, oldest first. */
  readonly prompts: readonly IncomingPrompt[];
}

export interface TransferManagerOptions {
  /** Where received data goes (native files, stream endpoint); default: in memory + `deliver`. */
  readonly receiver?: FileReceiver;
  /** Without `receiver`: hand over a complete download (tests, simple hosts). */
  readonly deliver?: (blob: Blob, filename: string, print: boolean) => Promise<DeliverResult>;
  readonly log: (level: 'info' | 'warn' | 'error', message: string) => void;
  /** A pushed download or print job finished or failed (for a toast). */
  readonly notify?: (text: string) => void;
  /** "Files from the remote" for pushed files and print jobs (default: accept). */
  readonly incomingPolicy?: () => RemoteFilesPolicy;
}

interface PendingIncoming {
  readonly prompt: IncomingPrompt;
  readonly stream: InputStream;
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
  /** The connection is gone: drop partial data (the transfer is marked failed). */
  abandon?: () => void;
}

/** After the HTTP response ends, how long to wait for the in-band `end`. */
const END_GRACE_MS = 5000;

export class TransferManager {
  private readonly opts: TransferManagerOptions;
  private client: GuacClient | null = null;
  private transfers: readonly Transfer[] = [];
  private readonly fs = new Map<number, FsState>();
  private readonly active = new Map<number, Active>();
  private nextId = 1;
  private nextFsId = 1;
  private snapshot: TransfersSnapshot = { transfers: [], filesystems: [], prompts: [] };
  private pending: PendingIncoming[] = [];
  private nextPromptId = 1;
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
      prompts: this.pending.map((p) => p.prompt),
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
      this.incoming(stream, mimetype, filename);
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
    // Unanswered prompts: the stream is gone with the client.
    this.pending = [];
    for (const [id, a] of this.active) {
      if (a.timer) clearTimeout(a.timer);
      a.abandon?.();
      this.transfers = reduceTransfers(this.transfers, {
        type: 'fail',
        id,
        at: Date.now(),
        message: sessionStrings.files.connectionClosed,
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

  // ---- Incoming files (consent)

  /**
   * A file the server pushed (`file` instruction): accepted, declined or held for the
   * user's answer according to "Files from the remote". Nothing is acked before the
   * decision, so the server sends no data. Files the user requested from the file browser
   * do not come here.
   */
  private incoming(stream: InputStream, mimetype: string, filename: string): void {
    const print = isPrintJob(mimetype, filename);
    const decision = decideIncoming(this.opts.incomingPolicy?.() ?? 'accept');
    if (decision === 'accept') {
      this.download(stream, mimetype, filename);
      return;
    }
    if (decision === 'decline') {
      this.opts.log('info', `Declined a pushed ${print ? 'print job' : 'file'} (setting)`);
      stream.sendAck(sessionStrings.files.declinedMessage, DECLINED);
      this.opts.notify?.(sessionStrings.files.autoDeclined(filename));
      return;
    }
    const prompt: IncomingPrompt = { id: this.nextPromptId++, filename, mimetype, print };
    this.pending = [...this.pending, { prompt, stream }];
    this.publish(true);
  }

  /** The user's answer to a prompt. */
  answerIncoming(id: number, accept: boolean): void {
    const p = this.pending.find((x) => x.prompt.id === id);
    if (!p) return;
    this.pending = this.pending.filter((x) => x !== p);
    if (accept && this.client) {
      this.opts.log('info', `Accepted a pushed ${p.prompt.print ? 'print job' : 'file'}`);
      this.download(p.stream, p.prompt.mimetype, p.prompt.filename);
    } else {
      this.opts.log('info', `Declined a pushed ${p.prompt.print ? 'print job' : 'file'}`);
      if (this.client) p.stream.sendAck(sessionStrings.files.declinedMessage, DECLINED);
    }
    this.publish(true);
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
    const req: ReceiveRequest = {
      filename,
      mimetype: mimetype || 'application/octet-stream',
      print: transfer?.kind === 'print',
      streamIndex: stream.index,
    };
    const http = this.opts.receiver?.http(req, (bytes) => {
      if (this.active.has(id)) this.apply({ type: 'progress', id, bytes }, false);
    });
    if (http) this.downloadHttp(id, stream, req, http);
    else this.downloadInBand(id, stream, req);
  }

  /** The transfer finished: record the outcome and tell the user. */
  private delivered(id: number, req: ReceiveRequest, r: DeliverResult): void {
    if (!r.ok) {
      this.apply({ type: 'fail', id, at: Date.now(), message: r.error });
      this.opts.notify?.(r.error);
      return;
    }
    this.apply({
      type: 'done',
      id,
      at: Date.now(),
      outcome: r.outcome,
      ...(r.savedUri ? { savedUri: r.savedUri } : {}),
    });
    const name = r.savedName ?? req.filename;
    const t = sessionStrings.files;
    this.opts.notify?.(
      req.print
        ? t.printReady(name)
        : r.savedUri
          ? t.savedToDownloadsNamed(name)
          : t.downloadReady(name),
    );
  }

  private failDownload(id: number, message: string): void {
    this.active.delete(id);
    this.apply({ type: 'fail', id, at: Date.now(), message });
    this.opts.notify?.(message);
  }

  /** Stream endpoint download (see the header). */
  private downloadHttp(
    id: number,
    stream: InputStream,
    req: ReceiveRequest,
    http: HttpReceive,
  ): void {
    let cancelled = false;
    let abandoned = false;
    let ended = false;
    let forcedPending = false;
    let settled: { ok: boolean; bytes: number } | null = null;
    let finished = false;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    const t = sessionStrings.files;

    const finish = (): void => {
      if (finished || settled === null) return;
      if (cancelled || abandoned) {
        finished = true;
        void http.discard();
        // Let the server notice the closed response (see the header).
        if (forcedPending && !abandoned) {
          forcedPending = false;
          stream.sendAck('OK', SUCCESS);
        }
        return;
      }
      if (!settled.ok) {
        finished = true;
        void http.discard();
        if (settled.bytes === 0 && !ended && this.client) {
          // Never intercepted (old server, refused request): receive it in band instead.
          this.active.delete(id);
          this.opts.log('info', 'Stream download unavailable; receiving in band');
          this.downloadInBand(id, stream, req);
          return;
        }
        this.failDownload(id, t.incomplete);
        return;
      }
      if (!ended) {
        // The response may end just before the `end` instruction arrives.
        graceTimer ??= setTimeout(() => {
          graceTimer = null;
          if (finished) return;
          finished = true;
          void http.discard();
          this.failDownload(id, t.incomplete);
        }, END_GRACE_MS);
        return;
      }
      finished = true;
      if (graceTimer) clearTimeout(graceTimer);
      this.active.delete(id);
      this.apply({ type: 'progress', id, bytes: settled.bytes });
      void http.commit().then((r) => this.delivered(id, req, r));
    };

    // The server forwards a blob (with empty data) after each `sync` and waits for our ack.
    stream.onblob = () => {
      if (cancelled && !finished) {
        // Hold it: guacd stalls until the native request has ended (see the header).
        forcedPending = true;
        return;
      }
      // Normal flow, or the cancelled request has already ended: the ack lets the server's
      // next write fail on the closed response, so it closes the stream itself.
      stream.sendAck('OK', SUCCESS);
    };
    stream.onend = () => {
      ended = true;
      finish();
    };
    void http.done.then((r) => {
      settled = r;
      finish();
    });
    this.active.set(id, {
      timer: null,
      cancel: () => {
        cancelled = true;
        this.active.delete(id);
        this.apply({ type: 'cancel', id, at: Date.now() });
        finish();
      },
      abandon: () => {
        abandoned = true;
        if (graceTimer) clearTimeout(graceTimer);
        finish();
      },
    });
    this.apply({ type: 'open', id });
    this.opts.log('info', 'Download started (stream endpoint)');
  }

  /** In-band download: blobs written to a sink, each acked once written. */
  private downloadInBand(id: number, stream: InputStream, req: ReceiveRequest): void {
    let cancelled = false;
    let bytes = 0;
    let sink: FileSink | null = null;
    let chain: Promise<void> = Promise.resolve();
    const t = sessionStrings.files;
    const stop = (message: string) => {
      stream.onblob = null;
      stream.onend = null;
      stream.sendAck(message, ABORT);
    };
    const start = (s: FileSink) => {
      if (cancelled) {
        void s.discard();
        return;
      }
      sink = s;
      stream.onblob = (data) => {
        if (cancelled) return;
        let chunk: Uint8Array;
        try {
          chunk = base64ToBytes(data);
        } catch {
          chunk = new Uint8Array(0);
        }
        bytes += chunk.length;
        this.apply({ type: 'progress', id, bytes }, false);
        chain = chain
          .then(() => s.write(chunk))
          .then(
            () => {
              if (!cancelled) stream.sendAck('OK', SUCCESS);
            },
            () => {
              if (cancelled) return;
              cancelled = true;
              stop('Write failed');
              void s.discard();
              this.failDownload(id, t.noSpace);
            },
          );
      };
      stream.onend = () => {
        if (cancelled) return;
        void chain.then(() => {
          if (cancelled) return;
          this.active.delete(id);
          this.apply({ type: 'progress', id, bytes });
          void s.commit().then((r) => this.delivered(id, req, r));
        });
      };
      // The server sends the first blob only after this ack (see the header).
      stream.sendAck('OK', SUCCESS);
    };
    this.active.set(id, {
      timer: null,
      cancel: () => {
        cancelled = true;
        this.active.delete(id);
        // Stop acking further blobs, then abort the stream on the server.
        stop('Cancelled');
        void chain.then(() => sink?.discard());
        this.apply({ type: 'cancel', id, at: Date.now() });
      },
      abandon: () => {
        cancelled = true;
        void chain.then(() => sink?.discard());
      },
    });
    this.apply({ type: 'open', id });
    const made = this.receiverOrMemory().sink(req);
    if (made instanceof Promise) {
      made.then(start, () => {
        if (cancelled) return;
        cancelled = true;
        stop('Cannot save');
        this.failDownload(id, t.saveFailed);
      });
    } else {
      start(made);
    }
  }

  private memoryReceiver: FileReceiver | null = null;

  /** `receiver`, or an in-memory one that hands the finished blob to `deliver`. */
  private receiverOrMemory(): FileReceiver {
    if (this.opts.receiver) return this.opts.receiver;
    const deliver = this.opts.deliver;
    this.memoryReceiver ??= {
      http: () => null,
      sink: (req) => {
        const parts: Uint8Array<ArrayBuffer>[] = [];
        return {
          write: (b) => {
            parts.push(b as Uint8Array<ArrayBuffer>);
            return Promise.resolve();
          },
          commit: () =>
            deliver
              ? deliver(new Blob(parts, { type: req.mimetype }), req.filename, req.print)
              : Promise.resolve({ ok: false as const, error: sessionStrings.files.saveFailed }),
          discard: () => Promise.resolve(),
        };
      },
    };
    return this.memoryReceiver;
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
        name: name || sessionStrings.files.remoteFiles,
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
      this.updateFs(fsId, { loading: false, error: sessionStrings.files.listingTimedOut });
    }, REQUEST_TIMEOUT_MS);
    this.updateFs(fsId, { cwd: target, loading: true, error: null });
    f.object.requestInputStream(target, (stream, mimetype) => {
      if (mimetype !== STREAM_INDEX_MIMETYPE) {
        stream.sendAck('Unexpected mimetype', UNSUPPORTED);
        if (f.listGen === gen) {
          if (f.timer) clearTimeout(f.timer);
          this.updateFs(fsId, { loading: false, error: sessionStrings.files.notAFolder });
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
        message: sessionStrings.files.notSent,
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
        destination:
          f && folder !== null ? `${f.view.name} ${folder}` : sessionStrings.files.remoteComputer,
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
        // A FileReader chunk already in flight would still call `sendBlob` after the end
        // (BlobWriter reads asynchronously): drop it, so no blob follows `end` (AUDIT FIL-1).
        (stream as { sendBlob: (data: string) => void }).sendBlob = () => undefined;
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
      writer.onerror = () => fail(null, sessionStrings.files.unreadable);
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
