import { describe, expect, it, vi } from 'vitest';
import { TransferManager } from './transfers.ts';

describe('cancelling an upload (AUDIT FIL-1 cancel risk)', () => {
  it('sends no blob after the end once cancelled', () => {
    const blobs: string[] = [];
    const sendEnd = vi.fn();
    const stream = {
      index: 3,
      onack: null as unknown,
      sendBlob: (data: string) => blobs.push(data),
      sendEnd,
    };
    const client = {
      onfile: null,
      onfilesystem: null,
      createFileStream: () => stream,
    };
    const m = new TransferManager({
      deliver: async () => 'saved' as never,
      log: () => undefined,
      notify: () => undefined,
      incomingPolicy: () => 'ask',
    });
    m.install(client as never);
    m.upload([new File(['hello'], 'a.txt', { type: 'text/plain' })], null);
    const id = m.getSnapshot().transfers[0]?.id;
    expect(id).toBeDefined();
    m.cancel(id ?? -1);
    expect(sendEnd).toHaveBeenCalledTimes(1);
    // A FileReader chunk that was already being read lands after the end: dropped.
    stream.sendBlob('late chunk');
    expect(blobs).toEqual([]);
  });
});
