import { describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  bytesToBase64,
  candidateNames,
  isPartFileName,
  partFileName,
  streamDownloadUrl,
  unwrapByteCounter,
} from './savedFiles.ts';

describe('received files: names', () => {
  it('tries the name, then numbered copies before the extension', () => {
    expect(candidateNames('report.pdf', 4)).toEqual([
      'report.pdf',
      'report (2).pdf',
      'report (3).pdf',
      'report (4).pdf',
    ]);
    expect(candidateNames('README', 2)).toEqual(['README', 'README (2)']);
    expect(candidateNames('.bashrc', 2)).toEqual(['.bashrc', '.bashrc (2)']);
  });

  it('marks incomplete files so the sweep finds only those', () => {
    const p = partFileName('movie.mkv', 'abc123');
    expect(p).toBe('.omg-abc123-movie.mkv.part');
    expect(isPartFileName(p)).toBe(true);
    expect(isPartFileName('movie.mkv')).toBe(false);
    expect(isPartFileName('movie.part')).toBe(false);
  });
});

describe('stream download endpoint (tunnelService.js downloadStream)', () => {
  it('builds api/session/tunnels/{uuid}/streams/{index}/{name} without the token', () => {
    expect(streamDownloadUrl('https://guac.example/guacamole/', 'u-1', 7, 'a b/c#.txt')).toBe(
      'https://guac.example/guacamole/api/session/tunnels/u-1/streams/7/a%20b_c%23.txt',
    );
    expect(streamDownloadUrl('https://guac.example', 'u', 0, '')).toBe(
      'https://guac.example/api/session/tunnels/u/streams/0/download',
    );
  });
});

describe('progress counter', () => {
  it('unwraps Android’s 32-bit byte count past 2 GiB and stays monotonic', () => {
    const G = 2 ** 30;
    let total = 0;
    for (const raw of [G, 2 * G - 1, -(2 * G) + G, -1, 0.5 * G, 3 * G - 2 ** 32]) {
      total = unwrapByteCounter(total, raw);
    }
    // 1 GiB, 2 GiB, 3 GiB, 4 GiB - 1, 4.5 GiB, then a stale lower value is ignored.
    expect(total).toBe(4.5 * G);
    expect(unwrapByteCounter(10, Number.NaN)).toBe(10);
  });
});

describe('base64', () => {
  it('round-trips bytes', () => {
    const bytes = new Uint8Array(70_000).map((_, i) => i % 251);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    expect(base64ToBytes('')).toEqual(new Uint8Array(0));
  });
});
