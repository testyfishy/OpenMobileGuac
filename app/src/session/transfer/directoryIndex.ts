/**
 * Filesystem objects (FIL-1): stream names and directory listings.
 *
 * A filesystem the server exposes (`filesystem` instruction → `Guacamole.Object`) is a set
 * of named streams. The root stream is "/" (`Guacamole.Object.ROOT_STREAM`). Requesting a
 * directory's stream returns a JSON object mapping each child's full stream name to its
 * mimetype; directories have the stream-index mimetype
 * `application/vnd.glyptodon.guacamole.stream-index+json`
 * (`Guacamole.Object.STREAM_INDEX_MIMETYPE`). This mirrors the web client's
 * `ManagedFilesystem.refresh` (upstream 1.6.0): names without the expected
 * "<directory>/" prefix are ignored, and the file name is the rest of the stream name.
 * Uploads go to `<directory stream name> + '/' + <file name>` (`ManagedClient.uploadFile`).
 *
 * Pure: no DOM, no library imports.
 */

export const ROOT_STREAM = '/';
export const STREAM_INDEX_MIMETYPE = 'application/vnd.glyptodon.guacamole.stream-index+json';

export interface DirectoryEntry {
  readonly name: string;
  readonly streamName: string;
  readonly mimetype: string;
  readonly isDirectory: boolean;
}

export type ParseResult =
  | { readonly ok: true; readonly entries: readonly DirectoryEntry[] }
  | { readonly ok: false; readonly error: string };

/** The prefix every child of `dir` has: the directory's stream name ending in "/". */
export function childPrefix(dirStreamName: string): string {
  return dirStreamName.endsWith('/') ? dirStreamName : dirStreamName + '/';
}

/**
 * Parse a directory listing (the JSON text of a stream-index stream). Entries are sorted:
 * folders first, then by name (case-insensitive, numeric aware).
 */
export function parseDirectoryIndex(json: string, dirStreamName: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, error: 'The server sent a folder listing that could not be read.' };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, error: 'The server sent a folder listing that could not be read.' };
  }
  const prefix = childPrefix(dirStreamName);
  const entries: DirectoryEntry[] = [];
  for (const [streamName, mimetype] of Object.entries(data as Record<string, unknown>)) {
    if (typeof mimetype !== 'string') continue;
    if (!streamName.startsWith(prefix)) continue;
    const name = streamName.slice(prefix.length);
    // Not a direct child (upstream would list it; guacd never sends one).
    if (name === '' || name === '.' || name === '..' || name.includes('/')) continue;
    entries.push({
      name,
      streamName,
      mimetype,
      isDirectory: mimetype === STREAM_INDEX_MIMETYPE,
    });
  }
  entries.sort(compareEntries);
  return { ok: true, entries };
}

const collator =
  typeof Intl !== 'undefined'
    ? new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
    : null;

function compareEntries(a: DirectoryEntry, b: DirectoryEntry): number {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
  return collator ? collator.compare(a.name, b.name) : a.name < b.name ? -1 : 1;
}

/** Stream name for a file uploaded into `dirStreamName`, as `ManagedClient.uploadFile` does. */
export function uploadStreamName(dirStreamName: string, fileName: string): string {
  // Exactly as upstream: no normalising, so the root "/" gives "//name". guacd resolves the
  // name itself (SFTP: `guac_common_ssh_sftp_normalize_path`; RDP: `guac_rdp_fs_open`).
  return `${dirStreamName}/${fileName}`;
}

/** Parent directory stream name; the root's parent is the root. */
export function parentStreamName(streamName: string): string {
  if (streamName === ROOT_STREAM || streamName === '') return ROOT_STREAM;
  const trimmed = streamName.replace(/\/+$/, '');
  const i = trimmed.lastIndexOf('/');
  return i <= 0 ? ROOT_STREAM : trimmed.slice(0, i);
}

/** Last path segment ("" for the root). Same rule as `ManagedFilesystem.downloadFile`. */
export function baseName(streamName: string): string {
  const m = /(.*[\\/])?(.*)/.exec(streamName);
  return m?.[2] ?? '';
}

/** Breadcrumb segments from the root: [{label, streamName}]. */
export function breadcrumbs(
  streamName: string,
  rootLabel: string,
): { label: string; streamName: string }[] {
  const out = [{ label: rootLabel, streamName: ROOT_STREAM }];
  if (streamName === ROOT_STREAM) return out;
  const parts = streamName.split('/').filter((p) => p !== '');
  let acc = '';
  for (const p of parts) {
    acc += '/' + p;
    out.push({ label: p, streamName: acc });
  }
  return out;
}

/** Whether a file name can be uploaded as is (no path separators, not empty). */
export function isValidUploadName(name: string): boolean {
  return name.trim() !== '' && !/[\\/]/.test(name) && name !== '.' && name !== '..';
}
