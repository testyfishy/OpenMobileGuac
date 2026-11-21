import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileReceiver, FileSink, HttpReceive } from './fileSave.ts';
import { TransferManager } from './transfers.ts';

/**
 * FIL-1 large downloads: the stream endpoint path (web client `tunnelService.downloadStream`
 * with the server's `OutputStreamInterceptingFilter`) and the in-band path with
 * write-before-ack backpressure.
 */

function fakeStream(index = 5) {
  return {
    index,
    onblob: null as ((data: string) => void) | null,
    onend: null as (() => void) | null,
    sendAck: vi.fn(),
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function setup(receiver: FileReceiver) {
  const notify = vi.fn();
  const m = new TransferManager({
    receiver,
    log: () => undefined,
    notify,
    incomingPolicy: () => 'accept',
  });
  const client = { onfile: null, onfilesystem: null } as unknown as Parameters<
    TransferManager['install']
  >[0];
  m.install(client);
  const push = (name = 'big.iso') => {
    const s = fakeStream();
    (client as unknown as { onfile: (s: unknown, m: string, n: string) => void }).onfile(
      s,
      'application/octet-stream',
      name,
    );
    return s;
  };
  return { m, push, notify };
}

function httpReceiver() {
  const done = deferred<{ ok: boolean; bytes: number }>();
  const commit = vi.fn(async () => ({
    ok: true as const,
    outcome: 'Saved to Downloads',
    savedUri: 'file:///Downloads/big.iso',
    savedName: 'big.iso',
  }));
  const discard = vi.fn(async () => undefined);
  const http: HttpReceive = { done: done.promise, commit, discard };
  const sinkWrite = vi.fn(async () => undefined);
  const sink: FileSink = {
    write: sinkWrite,
    commit: vi.fn(async () => ({ ok: true as const, outcome: 'in band' })),
    discard: vi.fn(async () => undefined),
  };
  let progress: ((b: number) => void) | null = null;
  const receiver: FileReceiver = {
    http: (_req, onProgress) => {
      progress = onProgress;
      return http;
    },
    sink: () => sink,
  };
  return { receiver, done, commit, discard, sink, progress: (b: number) => progress?.(b) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('stream endpoint downloads', () => {
  it('sends no first ack (the server does), acks forced blobs, completes on end + response', async () => {
    const r = httpReceiver();
    const { m, push, notify } = setup(r.receiver);
    const s = push();
    expect(s.sendAck).not.toHaveBeenCalled();
    s.onblob?.('');
    expect(s.sendAck).toHaveBeenCalledWith('OK', 0);
    r.progress(4096);
    s.onend?.();
    r.done.resolve({ ok: true, bytes: 8192 });
    await flush();
    expect(r.commit).toHaveBeenCalled();
    const t = m.getSnapshot().transfers[0];
    expect(t?.state).toBe('done');
    expect(t?.savedUri).toBe('file:///Downloads/big.iso');
    expect(t?.bytes).toBe(8192);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('big.iso'));
  });

  it('a response that ends without the in-band end is incomplete and deleted', async () => {
    vi.useFakeTimers();
    const r = httpReceiver();
    const { m, push } = setup(r.receiver);
    push();
    r.done.resolve({ ok: true, bytes: 100 });
    await flush();
    expect(m.getSnapshot().transfers[0]?.state).toBe('active');
    vi.advanceTimersByTime(5000);
    expect(r.commit).not.toHaveBeenCalled();
    expect(r.discard).toHaveBeenCalled();
    expect(m.getSnapshot().transfers[0]?.state).toBe('error');
  });

  it('a request that fails before any data falls back to in band', async () => {
    const r = httpReceiver();
    const { push } = setup(r.receiver);
    const s = push();
    r.done.resolve({ ok: false, bytes: 0 });
    await flush();
    expect(r.discard).toHaveBeenCalled();
    // In band: the client sends the first ack itself now.
    expect(s.sendAck).toHaveBeenCalledWith('OK', 0);
    s.onblob?.(btoa('hello'));
    await flush();
    expect(r.sink.write).toHaveBeenCalled();
  });

  it('cancel stops acking forced blobs; once the request settles, deletes and acks once', async () => {
    const r = httpReceiver();
    const { m, push } = setup(r.receiver);
    const s = push();
    const id = m.getSnapshot().transfers[0]?.id ?? -1;
    m.cancel(id);
    expect(m.getSnapshot().transfers[0]?.state).toBe('cancelled');
    s.onblob?.('');
    expect(s.sendAck).not.toHaveBeenCalled();
    r.done.resolve({ ok: false, bytes: 1234 });
    await flush();
    expect(r.discard).toHaveBeenCalled();
    expect(s.sendAck).toHaveBeenCalledTimes(1);
    expect(s.sendAck).toHaveBeenCalledWith('OK', 0);
    // Never an error ack: guacd would free the stream index while the server still
    // intercepts it.
    expect(s.sendAck.mock.calls.some(([, code]) => code !== 0)).toBe(false);
    // A forced blob after the request ended is acked again (the server then fails its write).
    s.onblob?.('');
    expect(s.sendAck).toHaveBeenCalledTimes(2);
  });

  it('the connection closing drops the partial file', async () => {
    const r = httpReceiver();
    const { m, push } = setup(r.receiver);
    push();
    m.detachClient();
    expect(m.getSnapshot().transfers[0]?.state).toBe('error');
    r.done.resolve({ ok: true, bytes: 10 });
    await flush();
    expect(r.discard).toHaveBeenCalled();
    expect(r.commit).not.toHaveBeenCalled();
  });
});

describe('in-band downloads', () => {
  function inBand() {
    const writes: Uint8Array[] = [];
    let release: (() => void) | null = null;
    const sink: FileSink = {
      write: vi.fn(
        (b: Uint8Array) =>
          new Promise<void>((resolve) => {
            writes.push(b);
            release = resolve;
          }),
      ),
      commit: vi.fn(async () => ({ ok: true as const, outcome: 'Saved' })),
      discard: vi.fn(async () => undefined),
    };
    const receiver: FileReceiver = { http: () => null, sink: () => sink };
    return { receiver, sink, writes, release: () => release?.() };
  }

  it('acks each blob only after it is written (backpressure)', async () => {
    const b = inBand();
    const { m, push } = setup(b.receiver);
    const s = push();
    expect(s.sendAck).toHaveBeenCalledTimes(1); // first ack
    s.onblob?.(btoa('abc'));
    await flush();
    expect(b.writes[0]).toEqual(new Uint8Array([97, 98, 99]));
    expect(s.sendAck).toHaveBeenCalledTimes(1);
    b.release();
    await flush();
    expect(s.sendAck).toHaveBeenCalledTimes(2);
    s.onend?.();
    await flush();
    expect(b.sink.commit).toHaveBeenCalled();
    expect(m.getSnapshot().transfers[0]?.state).toBe('done');
  });

  it('a failed write aborts the stream and deletes the partial file', async () => {
    const sink: FileSink = {
      write: vi.fn(async () => {
        throw new Error('ENOSPC');
      }),
      commit: vi.fn(),
      discard: vi.fn(async () => undefined),
    };
    const { m, push } = setup({ http: () => null, sink: () => sink });
    const s = push();
    s.onblob?.(btoa('x'));
    await flush();
    expect(s.sendAck).toHaveBeenLastCalledWith('Write failed', 0x0300);
    expect(sink.discard).toHaveBeenCalled();
    expect(m.getSnapshot().transfers[0]?.state).toBe('error');
  });
});
