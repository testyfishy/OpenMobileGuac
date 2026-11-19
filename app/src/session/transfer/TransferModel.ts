/**
 * File transfers (FIL-1, proposed FIL-2): the per-session list of downloads, uploads and
 * print jobs, as a pure reducer, plus the helpers the transfers panel needs (error text,
 * byte formatting, print-job detection, safe file names).
 *
 * Protocol background (see docs/protocol-notes.md §6): the stream side lives in
 * `src/ui/session/transfers.ts`. Status codes are `Guacamole.Status.Code` values.
 *
 * Pure: no DOM, no library imports, no timers.
 */

export type TransferDirection = 'download' | 'upload';
export type TransferKind = 'file' | 'print';
export type TransferState = 'waiting' | 'active' | 'done' | 'error' | 'cancelled';

export interface Transfer {
  readonly id: number;
  readonly direction: TransferDirection;
  readonly kind: TransferKind;
  readonly name: string;
  readonly mimetype: string;
  /** Total size in bytes when known (uploads; downloads do not announce a size). */
  readonly size: number | null;
  readonly bytes: number;
  readonly state: TransferState;
  /** Readable error, for `state === 'error'`. */
  readonly error: string | null;
  /** Status code of the error, when it came from the server. */
  readonly code: number | null;
  /** Where the upload went, e.g. "Shared drive /Download" or "Remote (no folder)". */
  readonly destination: string | null;
  /** Local result of a finished download (e.g. "Shared", "Saved"), if any. */
  readonly outcome: string | null;
  readonly startedAt: number;
  readonly endedAt: number | null;
}

export type TransferEvent =
  | {
      readonly type: 'start';
      readonly id: number;
      readonly direction: TransferDirection;
      readonly name: string;
      readonly mimetype: string;
      readonly size?: number | null;
      readonly destination?: string | null;
      readonly at: number;
    }
  /** The stream is open on both sides (first ack for uploads, first data for downloads). */
  | { readonly type: 'open'; readonly id: number }
  /** `bytes` = total transferred so far. */
  | { readonly type: 'progress'; readonly id: number; readonly bytes: number }
  | { readonly type: 'done'; readonly id: number; readonly at: number; readonly outcome?: string }
  | {
      readonly type: 'fail';
      readonly id: number;
      readonly at: number;
      readonly code?: number | null;
      readonly message?: string;
    }
  | { readonly type: 'cancel'; readonly id: number; readonly at: number }
  /** Remove finished transfers from the list. */
  | { readonly type: 'clear-finished' };

export function isFinished(t: Transfer): boolean {
  return t.state === 'done' || t.state === 'error' || t.state === 'cancelled';
}

/** At most this many finished transfers are kept; the oldest go first. */
export const MAX_FINISHED_TRANSFERS = 20;

export function reduceTransfers(list: readonly Transfer[], e: TransferEvent): readonly Transfer[] {
  if (e.type === 'start') {
    if (list.some((t) => t.id === e.id)) return list;
    const t: Transfer = {
      id: e.id,
      direction: e.direction,
      kind: e.direction === 'download' && isPrintJob(e.mimetype, e.name) ? 'print' : 'file',
      name: e.name,
      mimetype: e.mimetype,
      size: typeof e.size === 'number' && Number.isFinite(e.size) && e.size >= 0 ? e.size : null,
      bytes: 0,
      state: 'waiting',
      error: null,
      code: null,
      destination: e.destination ?? null,
      outcome: null,
      startedAt: e.at,
      endedAt: null,
    };
    return trimFinished([...list, t]);
  }
  if (e.type === 'clear-finished') {
    const next = list.filter((t) => !isFinished(t));
    return next.length === list.length ? list : next;
  }
  const i = list.findIndex((t) => t.id === e.id);
  const cur = list[i];
  if (!cur || isFinished(cur)) return list;
  let next: Transfer;
  switch (e.type) {
    case 'open':
      if (cur.state !== 'waiting') return list;
      next = { ...cur, state: 'active' };
      break;
    case 'progress': {
      const bytes = Math.max(cur.bytes, Math.floor(e.bytes));
      if (bytes === cur.bytes && cur.state === 'active') return list;
      next = { ...cur, bytes, state: 'active' };
      break;
    }
    case 'done':
      next = {
        ...cur,
        state: 'done',
        bytes: cur.size !== null && cur.direction === 'upload' ? cur.size : cur.bytes,
        endedAt: e.at,
        outcome: e.outcome ?? null,
      };
      break;
    case 'fail':
      next = {
        ...cur,
        state: 'error',
        code: e.code ?? null,
        error: transferErrorMessage(e.code ?? null, cur.direction, e.message),
        endedAt: e.at,
      };
      break;
    case 'cancel':
      next = { ...cur, state: 'cancelled', endedAt: e.at };
      break;
  }
  const out = list.slice();
  out[i] = next;
  return out;
}

function trimFinished(list: Transfer[]): Transfer[] {
  const finished = list.filter(isFinished);
  if (finished.length <= MAX_FINISHED_TRANSFERS) return list;
  const drop = new Set(
    finished.slice(0, finished.length - MAX_FINISHED_TRANSFERS).map((t) => t.id),
  );
  return list.filter((t) => !drop.has(t.id));
}

/** 0..1, or null when the total is unknown. */
export function progressFraction(t: Transfer): number | null {
  if (t.state === 'done') return 1;
  if (t.size === null || t.size <= 0) return null;
  return Math.min(1, Math.max(0, t.bytes / t.size));
}

/**
 * Readable text for a transfer failure. Codes follow the upstream web client's
 * `ERROR_UPLOAD_*` translations (`translations/en.json`, 1.6.0) and the acks guacd sends:
 * an upload to an RDP drive or SFTP with uploads disabled is refused with
 * CLIENT_FORBIDDEN "FAIL (UPLOAD DISABLED)" / "SFTP: Upload disabled"
 * (guacamole-server `rdp/upload.c`, `common-ssh/sftp.c`).
 */
export function transferErrorMessage(
  code: number | null,
  direction: TransferDirection,
  serverMessage?: string,
): string {
  const msg = serverMessage?.trim() ?? '';
  const what = direction === 'upload' ? 'upload' : 'download';
  if (code === null) return msg || `The ${what} failed.`;
  switch (code) {
    case 0x0100:
      return 'File transfer is not supported or not enabled for this connection.';
    case 0x0201:
    case 0x031d:
      return 'Too many files are being transferred. Wait for the others to finish.';
    case 0x0202:
      return 'The remote computer took too long to respond.';
    case 0x0203:
      return 'The remote computer reported an error during the transfer.';
    case 0x0204:
      return 'The destination folder does not exist.';
    case 0x0205:
      return 'The destination is locked by another task. Try again later.';
    case 0x0301:
      return `You are not signed in, so the ${what} was refused.`;
    case 0x0303:
      if (/disabled/i.test(msg)) {
        return direction === 'upload'
          ? 'Uploads are disabled by the administrator for this connection.'
          : 'Downloads are disabled by the administrator for this connection.';
      }
      if (/cannot open|open failed/i.test(msg)) {
        return 'The remote computer could not create the file (check permissions and the name).';
      }
      return `You do not have permission to ${what} this file.`;
    case 0x0308:
      return 'The transfer stalled (network too slow or interrupted).';
    case 0x0200:
      return msg && !/^FAIL/i.test(msg)
        ? `The server failed: ${msg}`
        : 'The server hit an internal error during the transfer.';
    default:
      return msg || `The ${what} failed (code 0x${code.toString(16).padStart(4, '0')}).`;
  }
}

/**
 * Whether a pushed download is an RDP print job. guacd streams print jobs as
 * `application/pdf` with a name from the PostScript `%%Title:` header plus ".pdf", or the
 * default "guacamole-print.pdf" (guacamole-server `rdp/print-job.c`).
 */
export function isPrintJob(mimetype: string, filename: string): boolean {
  const pdf = /^application\/pdf\b/i.test(mimetype.trim());
  return pdf && (/\.pdf$/i.test(filename) || filename === '');
}

/** "1.5 MB". Binary multiples, one decimal under 10. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '–';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  if (u === 0) return `${Math.round(v)} B`;
  return `${v < 10 ? v.toFixed(1) : Math.round(v).toString()} ${units[u]}`;
}

/** Characters not allowed in file names on Android, iOS or Windows. */
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f<>:"/\\|?*]+/g;

/**
 * A safe local file name from a server-supplied one: no path parts, no control or
 * reserved characters, no leading dots, bounded length (extension kept), never empty.
 */
export function safeFilename(name: string, fallback = 'download'): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  let s = base.replace(UNSAFE, '_').replace(/\s+/g, ' ').trim();
  s = s.replace(/^\.+/, '').replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(s)) s = `_${s}`;
  if (s === '' || s === '_') s = fallback;
  const MAX = 120;
  if (s.length > MAX) {
    const dot = s.lastIndexOf('.');
    const ext = dot > 0 && s.length - dot <= 10 ? s.slice(dot) : '';
    s = s.slice(0, MAX - ext.length) + ext;
  }
  return s;
}
