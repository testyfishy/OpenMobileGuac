/**
 * Guacamole wire format helpers for the demo server.
 *
 * An instruction is a list of elements, each written as `<length>.<value>`, separated by
 * `,` and terminated by `;`. `<length>` counts Unicode code points, not UTF-16 units
 * (`Guacamole.Parser.codePointCount` in the vendored `Parser.js`).
 */

/** One instruction: an opcode and its string arguments. */
export interface Instruction {
  readonly opcode: string;
  readonly args: readonly string[];
}

/** Number of Unicode code points in `s` (a lone surrogate counts as one). */
export function codePointLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
    }
    n++;
  }
  return n;
}

/** Encodes one instruction in wire format. */
export function encodeInstruction(opcode: string, args: readonly unknown[] = []): string {
  const element = (v: unknown): string => {
    const s = String(v);
    return `${codePointLength(s)}.${s}`;
  };
  let out = element(opcode);
  for (const a of args) out += ',' + element(a);
  return out + ';';
}

/** Thrown by `WireParser` on malformed input. */
export class WireFormatError extends Error {
  override name = 'WireFormatError';
}

/**
 * An incremental parser for the wire format. Feed it arbitrary fragments with `receive`;
 * complete instructions are returned in order. It is the counterpart of `Guacamole.Parser`
 * and exists so the demo can be tested without the vendored library in both directions.
 */
export class WireParser {
  private buffer = '';

  receive(data: string): Instruction[] {
    this.buffer += data;
    const out: Instruction[] = [];
    const elements: string[] = [];
    let pos = 0;
    let instrStart = 0;
    for (;;) {
      const dot = this.buffer.indexOf('.', pos);
      if (dot < 0) break;
      const lenText = this.buffer.slice(pos, dot);
      if (!/^\d+$/.test(lenText)) throw new WireFormatError(`bad element length "${lenText}"`);
      const len = Number(lenText);
      // Walk `len` code points forward.
      let end = dot + 1;
      let count = 0;
      while (count < len && end < this.buffer.length) {
        const c = this.buffer.charCodeAt(end);
        end += c >= 0xd800 && c <= 0xdbff && end + 1 < this.buffer.length ? 2 : 1;
        count++;
      }
      if (count < len || end >= this.buffer.length) break; // need more data
      elements.push(this.buffer.slice(dot + 1, end));
      const term = this.buffer[end];
      pos = end + 1;
      if (term === ';') {
        const [opcode = '', ...args] = elements.splice(0);
        out.push({ opcode, args });
        instrStart = pos;
      } else if (term !== ',') {
        throw new WireFormatError(`bad terminator "${term ?? ''}"`);
      }
    }
    this.buffer = this.buffer.slice(instrStart);
    return out;
  }
}

/** Converts bytes to base64. */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(bin);
}

/** Converts base64 to bytes. Throws on invalid input. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Largest blob payload in bytes, as guacd (`GUAC_PROTOCOL_BLOB_MAX_LENGTH`) and
 * `Guacamole.ArrayBufferWriter.DEFAULT_BLOB_LENGTH` use. It is a multiple of 3, so every
 * chunk except the last is unpadded base64 and decodes on its own, which
 * `Guacamole.ArrayBufferReader` (used by the `ImageDecoder` path) requires.
 */
export const BLOB_MAX_BYTES = 6048;

/** Splits base64 text into chunks that each decode independently. */
export function chunkBase64(b64: string, maxBytes = BLOB_MAX_BYTES): string[] {
  const chars = Math.max(4, Math.floor(maxBytes / 3) * 4);
  const out: string[] = [];
  for (let i = 0; i < b64.length; i += chars) out.push(b64.slice(i, i + chars));
  return out.length > 0 ? out : [''];
}
