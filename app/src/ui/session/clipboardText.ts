/**
 * Clipboard text over Guacamole streams, as exact UTF-8 in both directions.
 *
 * guacamole-common-js 1.6.0 gets characters above U+FFFF (emoji) wrong both ways:
 * `StringWriter` encodes each UTF-16 surrogate half on its own (CESU-8, invalid UTF-8), and
 * `StringReader`'s `UTF8Parser` truncates decoded code points with `String.fromCharCode`.
 * So the raw bytes are moved with `ArrayBufferReader`/`ArrayBufferWriter` and converted
 * here with the platform `TextDecoder`/`TextEncoder`. Reading decodes once at stream end,
 * so a multi-byte sequence split across blobs is joined before decoding.
 */
import Guacamole from '../../vendor/guacamole-common-js';

/** Joins byte chunks and decodes them as UTF-8 (invalid bytes become U+FFFD). */
export function decodeUtf8Chunks(chunks: readonly (ArrayBuffer | Uint8Array)[]): string {
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const all = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    all.set(c instanceof Uint8Array ? c : new Uint8Array(c), pos);
    pos += c.byteLength;
  }
  return new TextDecoder('utf-8').decode(all);
}

/** Encodes text as UTF-8. Lone surrogates become U+FFFD. */
export function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Reads a whole text stream and calls `onText` once, at its end. */
export function readTextStream(
  stream: Guacamole.InputStream,
  onText: (text: string) => void,
): void {
  const reader = new Guacamole.ArrayBufferReader(stream);
  const chunks: ArrayBuffer[] = [];
  reader.ondata = (buffer) => {
    chunks.push(buffer);
  };
  reader.onend = () => {
    onText(decodeUtf8Chunks(chunks));
  };
}

/** Writes `text` to a stream as UTF-8 blobs and ends it. Empty text sends no blob. */
export function writeTextStream(stream: Guacamole.OutputStream, text: string): void {
  const writer = new Guacamole.ArrayBufferWriter(stream);
  const bytes = encodeUtf8(text);
  if (bytes.length > 0) writer.sendData(bytes);
  writer.sendEnd();
}
