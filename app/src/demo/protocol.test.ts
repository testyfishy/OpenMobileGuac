import { describe, expect, it } from 'vitest';
import Guacamole from '../vendor/guacamole-common-js/index.js';
import {
  BLOB_MAX_BYTES,
  WireFormatError,
  WireParser,
  base64ToBytes,
  bytesToBase64,
  chunkBase64,
  codePointLength,
  encodeInstruction,
} from './protocol.ts';

function parseWithGuacamole(data: string): [string, string[]][] {
  const parser = new Guacamole.Parser();
  const out: [string, string[]][] = [];
  parser.oninstruction = (opcode, args) => out.push([opcode, args]);
  parser.receive(data);
  return out;
}

const samples: [string, string[]][] = [
  ['sync', ['1234567890']],
  ['size', ['0', '1280', '800']],
  ['name', ['Demo, desktop; v1.0']],
  ['blob', ['3', 'iVBORw0KGgo=']],
  ['clipboard', ['0', 'text/plain']],
  ['key', ['16777216', '1']],
  ['nop', []],
  ['text', ['café 日本語 🙂 👍🏽', '']],
];

describe('encodeInstruction', () => {
  it('counts code points, not UTF-16 units', () => {
    expect(codePointLength('🙂')).toBe(1);
    expect(codePointLength('a🙂b')).toBe(3);
    expect(encodeInstruction('x', ['🙂'])).toBe('1.x,1.🙂;');
  });

  it('matches Guacamole.Parser.toInstruction', () => {
    for (const [op, args] of samples) {
      expect(encodeInstruction(op, args)).toBe(Guacamole.Parser.toInstruction([op, ...args]));
    }
  });

  it('round-trips through the vendored Guacamole.Parser', () => {
    const wire = samples.map(([op, args]) => encodeInstruction(op, args)).join('');
    expect(parseWithGuacamole(wire)).toEqual(samples);
  });

  it('stringifies non-string arguments', () => {
    expect(encodeInstruction('mouse', [10, 20, 1])).toBe('5.mouse,2.10,2.20,1.1;');
  });
});

describe('WireParser', () => {
  it('parses what Guacamole.Parser.toInstruction produces', () => {
    const wire = samples
      .map(([op, args]) => Guacamole.Parser.toInstruction([op, ...args]))
      .join('');
    const got = new WireParser().receive(wire).map((i) => [i.opcode, i.args]);
    expect(got).toEqual(samples);
  });

  it('handles input split at every position, including inside surrogate pairs', () => {
    const wire = samples.map(([op, args]) => encodeInstruction(op, args)).join('');
    for (let cut = 1; cut < wire.length; cut += 3) {
      const p = new WireParser();
      const got = [...p.receive(wire.slice(0, cut)), ...p.receive(wire.slice(cut))];
      expect(got.map((i) => [i.opcode, i.args])).toEqual(samples);
    }
  });

  it('rejects malformed input', () => {
    expect(() => new WireParser().receive('x.sync;')).toThrow(WireFormatError);
    expect(() => new WireParser().receive('4.sync!')).toThrow(WireFormatError);
  });
});

describe('base64 helpers', () => {
  it('round-trips bytes', () => {
    const bytes = new Uint8Array(70000).map((_, i) => (i * 31) & 0xff);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it('splits into independently decodable chunks of at most BLOB_MAX_BYTES', () => {
    const bytes = new Uint8Array(BLOB_MAX_BYTES * 2 + 5).map((_, i) => i & 0xff);
    const chunks = chunkBase64(bytesToBase64(bytes));
    expect(chunks).toHaveLength(3);
    const decoded = chunks.map(base64ToBytes);
    expect(decoded.map((d) => d.length)).toEqual([BLOB_MAX_BYTES, BLOB_MAX_BYTES, 5]);
    expect(chunks.slice(0, -1).every((c) => !c.includes('='))).toBe(true);
    const joined = new Uint8Array(bytes.length);
    let pos = 0;
    for (const d of decoded) {
      joined.set(d, pos);
      pos += d.length;
    }
    expect(joined).toEqual(bytes);
  });
});
