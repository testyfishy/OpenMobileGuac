import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Guacamole from '../../vendor/guacamole-common-js';
import { decodeUtf8Chunks, encodeUtf8, readTextStream, writeTextStream } from './clipboardText.ts';

const toB64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const fromB64 = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

describe('decodeUtf8Chunks', () => {
  it('decodes an empty stream to an empty string', () => {
    expect(decodeUtf8Chunks([])).toBe('');
    expect(decodeUtf8Chunks([new ArrayBuffer(0), new Uint8Array(0)])).toBe('');
  });

  it('decodes emoji and other astral characters', () => {
    const text = 'Hi 🙂 𝄞 😀!';
    expect(decodeUtf8Chunks([encodeUtf8(text)])).toBe(text);
  });

  it('joins multi-byte sequences split across chunk boundaries', () => {
    const text = 'aé☕🙂z';
    const bytes = encodeUtf8(text);
    // Every possible split into three chunks, including inside each sequence.
    for (let i = 0; i <= bytes.length; i++) {
      for (let j = i; j <= bytes.length; j++) {
        const parts = [bytes.slice(0, i), bytes.slice(i, j), bytes.slice(j)];
        expect(decodeUtf8Chunks(parts.map((p) => p.buffer))).toBe(text);
      }
    }
  });

  it('replaces invalid bytes instead of throwing', () => {
    expect(decodeUtf8Chunks([new Uint8Array([0x61, 0xff, 0x62])])).toBe('a�b');
  });
});

describe('encodeUtf8', () => {
  it('encodes astral characters as 4-byte UTF-8, not surrogate halves', () => {
    expect([...encodeUtf8('🙂')]).toEqual([0xf0, 0x9f, 0x99, 0x82]);
    expect(encodeUtf8('')).toHaveLength(0);
  });
});

describe('clipboard streams', () => {
  // The vendored stream helpers use window.atob/btoa.
  beforeEach(() => {
    vi.stubGlobal('window', globalThis);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function outputStream() {
    const blobs: string[] = [];
    let ended = 0;
    const client = {
      sendBlob: (_i: number, data: string) => blobs.push(data),
      endStream: () => ended++,
    } as unknown as Guacamole.Client;
    return { stream: new Guacamole.OutputStream(client, 0), blobs, ended: () => ended };
  }

  function inputStream() {
    const client = { sendAck: () => {} } as unknown as Guacamole.Client;
    return new Guacamole.InputStream(client, 0);
  }

  it('reads a stream whose emoji is split across blobs, once at the end', () => {
    const stream = inputStream();
    const got: string[] = [];
    readTextStream(stream, (t) => got.push(t));
    const bytes = encodeUtf8('Copied: ☕ naïve 🙂');
    const cut = bytes.length - 2; // inside the 4-byte emoji
    stream.onblob?.(toB64(bytes.slice(0, cut)));
    expect(got).toEqual([]);
    stream.onblob?.(toB64(bytes.slice(cut)));
    stream.onend?.();
    expect(got).toEqual(['Copied: ☕ naïve 🙂']);
  });

  it('reads an empty stream as empty text', () => {
    const stream = inputStream();
    const got: string[] = [];
    readTextStream(stream, (t) => got.push(t));
    stream.onend?.();
    expect(got).toEqual(['']);
  });

  it('writes exact UTF-8 for astral characters and ends the stream', () => {
    const { stream, blobs, ended } = outputStream();
    writeTextStream(stream, 'ok 🙂');
    expect(ended()).toBe(1);
    const bytes = blobs.flatMap((b) => [...fromB64(b)]);
    expect(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes))).toBe('ok 🙂');
  });

  it('splits long text into blobs that rejoin exactly', () => {
    const { stream, blobs } = outputStream();
    const text = '🙂'.repeat(4000) + ' end';
    writeTextStream(stream, text);
    expect(blobs.length).toBeGreaterThan(1);
    expect(decodeUtf8Chunks(blobs.map(fromB64))).toBe(text);
  });

  it('sends no blob for empty text, only the end', () => {
    const { stream, blobs, ended } = outputStream();
    writeTextStream(stream, '');
    expect(blobs).toEqual([]);
    expect(ended()).toBe(1);
  });

  it('documents the upstream StringWriter bug this replaces', () => {
    const { stream, blobs } = outputStream();
    const writer = new Guacamole.StringWriter(stream);
    writer.sendText('🙂');
    writer.sendEnd();
    const bytes = new Uint8Array(blobs.flatMap((b) => [...fromB64(b)]));
    // Two 3-byte surrogate encodings (CESU-8) instead of one 4-byte sequence.
    expect(bytes).toHaveLength(6);
    expect(new TextDecoder().decode(bytes)).not.toBe('🙂');
  });
});
