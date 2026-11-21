/**
 * Pure helpers for files received from the remote and written to the device (FIL-1): free
 * names in the Downloads folder, the marker for incomplete files, the stream download URL
 * and progress counters. No Capacitor or DOM imports.
 */

/** Incomplete files: hidden (leading dot) and marked `.part`, removed on failure and at start. */
const PART_PREFIX = '.omg-';
const PART_SUFFIX = '.part';

export function partFileName(finalName: string, random: string): string {
  return `${PART_PREFIX}${random}-${finalName}${PART_SUFFIX}`;
}

export function isPartFileName(name: string): boolean {
  return name.startsWith(PART_PREFIX) && name.endsWith(PART_SUFFIX);
}

/**
 * Names to try for `name` in a folder that may already have it: `name`, then
 * `base (2).ext`, `base (3).ext`, … up to `max` candidates.
 */
export function candidateNames(name: string, max = 50): string[] {
  const dot = name.lastIndexOf('.');
  const hasExt = dot > 0 && name.length - dot <= 10;
  const base = hasExt ? name.slice(0, dot) : name;
  const ext = hasExt ? name.slice(dot) : '';
  const out = [name];
  for (let i = 2; out.length < max; i++) out.push(`${base} (${i})${ext}`);
  return out;
}

/**
 * The web application's stream download endpoint (guacamole-client 1.6.0
 * `rest/tunnel/TunnelResource.java` `@Path("streams/{index}/{filename}")`, used by
 * `tunnelService.js` `downloadStream`). The filename only names the response; upstream
 * replaces path separators (`sanitizeFilename`). The token goes in the `Guacamole-Token`
 * header, which the REST API reads before the `token` query parameter
 * (docs/protocol-notes.md §1.2), so it stays out of URLs and native logs.
 */
export function streamDownloadUrl(
  baseUrl: string,
  tunnelUuid: string,
  streamIndex: number,
  filename: string,
): string {
  const base = baseUrl.replace(/\/+$/, '');
  const name = filename.replace(/[\\/]/g, '_') || 'download';
  return (
    `${base}/api/session/tunnels/${encodeURIComponent(tunnelUuid)}` +
    `/streams/${encodeURIComponent(String(streamIndex))}/${encodeURIComponent(name)}`
  );
}

const TWO_32 = 2 ** 32;

/**
 * Android's plugin counts downloaded bytes in a 32-bit `Int`, which wraps past 2 GiB (to
 * negative, then back up). Turns the raw value into a monotonic total, given the previous
 * total, assuming progress events come at least every 4 GiB (they come every 100 ms).
 */
export function unwrapByteCounter(previous: number, raw: number): number {
  if (!Number.isFinite(raw)) return previous;
  let v = raw < 0 ? raw + TWO_32 : raw;
  while (v + TWO_32 / 2 < previous) v += TWO_32;
  return Math.max(previous, v);
}

/** Base64 (a `blob` instruction's payload) to bytes. */
export function base64ToBytes(data: string): Uint8Array {
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Bytes to base64, in slices so a large chunk never builds a huge argument list. */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) {
    bin += String.fromCharCode(...bytes.subarray(i, i + STEP));
  }
  return btoa(bin);
}
