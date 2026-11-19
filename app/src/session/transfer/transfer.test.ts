import { describe, expect, it } from 'vitest';
import Guacamole from '../../vendor/guacamole-common-js/index.js';
import {
  ROOT_STREAM,
  STREAM_INDEX_MIMETYPE,
  baseName,
  breadcrumbs,
  childPrefix,
  isValidUploadName,
  parentStreamName,
  parseDirectoryIndex,
  uploadStreamName,
} from './directoryIndex.ts';
import {
  MAX_FINISHED_TRANSFERS,
  formatBytes,
  isPrintJob,
  progressFraction,
  reduceTransfers,
  safeFilename,
  transferErrorMessage,
  type Transfer,
  type TransferEvent,
} from './TransferModel.ts';

describe('library constants', () => {
  it('match the vendored Guacamole.Object', () => {
    expect(ROOT_STREAM).toBe(Guacamole.Object.ROOT_STREAM);
    expect(STREAM_INDEX_MIMETYPE).toBe(Guacamole.Object.STREAM_INDEX_MIMETYPE);
  });
});

/** Decodes the blobs of one stream from a guacd-style instruction stream. */
function streamText(wire: string, index: string): string {
  const parser = new Guacamole.Parser();
  const parts: Uint8Array[] = [];
  parser.oninstruction = (opcode, args) => {
    if (opcode === 'blob' && args[0] === index) {
      const bin = atob(args[1] ?? '');
      parts.push(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    }
  };
  parser.receive(wire);
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.length;
  }
  return new TextDecoder().decode(all);
}

function b64(text: string): string {
  let bin = '';
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
}

describe('parseDirectoryIndex', () => {
  const listing = {
    '/Download': STREAM_INDEX_MIMETYPE,
    '/notes 10.txt': 'application/octet-stream',
    '/notes 9.txt': 'application/octet-stream',
    '/Projekt ü': STREAM_INDEX_MIMETYPE,
    '/other/escape.txt': 'application/octet-stream',
    '/bad': 42,
  };

  it('parses a listing split across blobs, as guacd streams it', () => {
    const json = JSON.stringify(listing);
    const a = json.slice(0, 30);
    const c = json.slice(30);
    const wire = Guacamole.Parser.toInstruction(['body', '0', '5', STREAM_INDEX_MIMETYPE, '/'])
      .concat(Guacamole.Parser.toInstruction(['blob', '5', b64(a)]))
      .concat(Guacamole.Parser.toInstruction(['blob', '5', b64(c)]))
      .concat(Guacamole.Parser.toInstruction(['end', '5']));
    const r = parseDirectoryIndex(streamText(wire, '5'), ROOT_STREAM);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries.map((e) => e.name)).toEqual([
      'Download',
      'Projekt ü',
      'notes 9.txt',
      'notes 10.txt',
    ]);
    expect(r.entries[0]).toEqual({
      name: 'Download',
      streamName: '/Download',
      mimetype: STREAM_INDEX_MIMETYPE,
      isDirectory: true,
    });
  });

  it('keeps only direct children of a sub-directory', () => {
    const r = parseDirectoryIndex(
      JSON.stringify({ '/a/b.txt': 'text/plain', '/a/c': STREAM_INDEX_MIMETYPE, '/ab': 'x' }),
      '/a',
    );
    expect(r.ok && r.entries.map((e) => e.streamName)).toEqual(['/a/c', '/a/b.txt']);
  });

  it('rejects malformed JSON', () => {
    expect(parseDirectoryIndex('{', '/').ok).toBe(false);
    expect(parseDirectoryIndex('[1]', '/').ok).toBe(false);
  });
});

describe('stream names', () => {
  it('builds upload names as the web client does', () => {
    expect(uploadStreamName('/Download', 'a.txt')).toBe('/Download/a.txt');
    expect(uploadStreamName('/', 'a.txt')).toBe('//a.txt');
  });
  it('navigates up and splits paths', () => {
    expect(parentStreamName('/a/b')).toBe('/a');
    expect(parentStreamName('/a')).toBe('/');
    expect(parentStreamName('/')).toBe('/');
    expect(baseName('/a/b.txt')).toBe('b.txt');
    expect(baseName('C:\\x\\y.doc')).toBe('y.doc');
    expect(childPrefix('/a')).toBe('/a/');
    expect(breadcrumbs('/a/b', 'Drive')).toEqual([
      { label: 'Drive', streamName: '/' },
      { label: 'a', streamName: '/a' },
      { label: 'b', streamName: '/a/b' },
    ]);
  });
  it('validates upload names', () => {
    expect(isValidUploadName('ok.txt')).toBe(true);
    expect(isValidUploadName('a/b')).toBe(false);
    expect(isValidUploadName(' ')).toBe(false);
  });
});

describe('transfer reducer', () => {
  const run = (events: TransferEvent[], list: readonly Transfer[] = []) =>
    events.reduce((l, e) => reduceTransfers(l, e), list);

  it('tracks an upload to completion', () => {
    const l = run([
      { type: 'start', id: 1, direction: 'upload', name: 'a.bin', mimetype: '', size: 1000, at: 5 },
      { type: 'open', id: 1 },
      { type: 'progress', id: 1, bytes: 400 },
    ]);
    expect(l[0]).toMatchObject({ state: 'active', bytes: 400, kind: 'file' });
    expect(progressFraction(l[0] as Transfer)).toBeCloseTo(0.4);
    const done = run([{ type: 'done', id: 1, at: 9 }], l);
    expect(done[0]).toMatchObject({ state: 'done', bytes: 1000, endedAt: 9 });
  });

  it('labels print jobs and maps upload errors', () => {
    const l = run([
      {
        type: 'start',
        id: 2,
        direction: 'download',
        name: 'Report.pdf',
        mimetype: 'application/pdf',
        at: 0,
      },
      { type: 'start', id: 3, direction: 'upload', name: 'x', mimetype: '', size: 1, at: 0 },
      { type: 'fail', id: 3, at: 1, code: 0x0303, message: 'FAIL (UPLOAD DISABLED)' },
    ]);
    expect(l[0]?.kind).toBe('print');
    expect(l[1]).toMatchObject({ state: 'error', code: 0x0303 });
    expect(l[1]?.error).toMatch(/disabled by the administrator/);
  });

  it('ignores events after a transfer finished, and unknown ids', () => {
    const l = run([
      { type: 'start', id: 1, direction: 'download', name: 'a', mimetype: '', at: 0 },
      { type: 'cancel', id: 1, at: 1 },
    ]);
    expect(run([{ type: 'progress', id: 1, bytes: 10 }], l)).toBe(l);
    expect(run([{ type: 'done', id: 99, at: 1 }], l)).toBe(l);
  });

  it('keeps a bounded number of finished transfers and can clear them', () => {
    let l: readonly Transfer[] = [];
    for (let i = 0; i < MAX_FINISHED_TRANSFERS + 5; i++) {
      l = run(
        [
          { type: 'start', id: i, direction: 'download', name: `f${i}`, mimetype: '', at: i },
          { type: 'done', id: i, at: i },
        ],
        l,
      );
    }
    l = run([{ type: 'start', id: 999, direction: 'download', name: 'x', mimetype: '', at: 0 }], l);
    expect(l.filter((t) => t.state === 'done').length).toBeLessThanOrEqual(MAX_FINISHED_TRANSFERS);
    expect(run([{ type: 'clear-finished' }], l).map((t) => t.id)).toEqual([999]);
  });
});

describe('transfer helpers', () => {
  it('detects print jobs', () => {
    expect(isPrintJob('application/pdf', 'guacamole-print.pdf')).toBe(true);
    expect(isPrintJob('application/octet-stream', 'x.pdf')).toBe(false);
  });
  it('formats bytes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(50 * 1024 * 1024)).toBe('50 MB');
  });
  it('explains errors', () => {
    expect(transferErrorMessage(0x0100, 'upload')).toMatch(/not supported or not enabled/);
    expect(transferErrorMessage(0x0303, 'upload', 'SFTP: Upload disabled')).toMatch(
      /Uploads are disabled/,
    );
    expect(transferErrorMessage(null, 'download')).toBe('The download failed.');
    expect(transferErrorMessage(0x0999, 'download')).toMatch(/0x0999/);
  });
  it('makes safe file names', () => {
    expect(safeFilename('../../etc/passwd')).toBe('passwd');
    expect(safeFilename('a<b>:c?.txt')).toBe('a_b_c_.txt');
    expect(safeFilename('...')).toBe('download');
    expect(safeFilename('CON.txt')).toBe('_CON.txt');
    const long = safeFilename('x'.repeat(300) + '.pdf');
    expect(long.length).toBe(120);
    expect(long.endsWith('.pdf')).toBe(true);
  });
});
