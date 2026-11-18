import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReplayTransport, parseRecording, type RecordedInstruction } from './ReplayTransport.ts';
import { createReplaySessionTransport, createWebSocketTransport } from './SessionTransport.ts';
import { TunnelState, makeStatus, type TunnelLike } from './TunnelLike.ts';

const recording: RecordedInstruction[] = [
  { opcode: 'size', args: ['0', '1024', '768'], delayMs: 0 },
  { opcode: 'sync', args: ['1000'], delayMs: 100 },
  { opcode: 'name', args: ['Desktop'], delayMs: 250 },
];

function attach(t: ReplayTransport): { log: string[] } {
  const log: string[] = [];
  t.onstatechange = (s) => log.push(`state:${s}`);
  t.onuuid = (u) => log.push(`uuid:${u}`);
  t.oninstruction = (op, args) => log.push(`${op}(${args.join(',')})`);
  t.onerror = (st) => log.push(`error:${st.code}`);
  return { log };
}

describe('ReplayTransport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts closed and goes CONNECTING synchronously, OPEN with uuid on the next tick', () => {
    const t = new ReplayTransport(recording, { uuid: 'u-1' });
    const { log } = attach(t);
    expect(t.state).toBe(TunnelState.CLOSED);
    expect(t.isConnected()).toBe(false);

    t.connect('token=x');
    expect(t.state).toBe(TunnelState.CONNECTING);
    expect(t.connectData).toEqual(['token=x']);
    expect(log).toEqual(['state:0']);

    vi.advanceTimersByTime(0);
    expect(t.uuid).toBe('u-1');
    expect(t.isConnected()).toBe(true);
    expect(log).toEqual(['state:0', 'uuid:u-1', 'state:1', 'size(0,1024,768)']);
  });

  it('delivers instructions with relative delays', () => {
    const t = new ReplayTransport(recording);
    const { log } = attach(t);
    t.connect();
    vi.advanceTimersByTime(0);
    expect(t.delivered).toBe(1);

    vi.advanceTimersByTime(99);
    expect(t.delivered).toBe(1);
    vi.advanceTimersByTime(1);
    expect(t.delivered).toBe(2);
    expect(log.at(-1)).toBe('sync(1000)');

    vi.advanceTimersByTime(249);
    expect(t.delivered).toBe(2);
    vi.advanceTimersByTime(1);
    expect(log.at(-1)).toBe('name(Desktop)');
    // The default behaviour at the end is to stay open.
    vi.advanceTimersByTime(10_000);
    expect(t.state).toBe(TunnelState.OPEN);
  });

  it('honours the speed multiplier', () => {
    const t = new ReplayTransport(recording, { speed: 2 });
    attach(t);
    t.connect();
    vi.advanceTimersByTime(50);
    expect(t.delivered).toBe(2);
    vi.advanceTimersByTime(125);
    expect(t.delivered).toBe(3);
  });

  it('records outgoing messages only while connected and stringifies them', () => {
    const t = new ReplayTransport(recording);
    t.sendMessage('key', 65, 1);
    expect(t.sent).toEqual([]);
    t.connect();
    t.sendMessage('mouse', 10, 20, 1);
    expect(t.sent).toEqual([]); // still CONNECTING
    vi.advanceTimersByTime(0);
    t.sendMessage('mouse', 10, 20, 1);
    t.sendMessage('size', 800, 600);
    t.sendMessage();
    expect(t.sent).toEqual([
      { opcode: 'mouse', args: ['10', '20', '1'] },
      { opcode: 'size', args: ['800', '600'] },
    ]);
  });

  it('stops delivering after disconnect, including from inside a handler', () => {
    const t = new ReplayTransport(recording);
    const { log } = attach(t);
    t.oninstruction = (op) => {
      log.push(op);
      if (op === 'sync') t.disconnect();
    };
    t.connect();
    vi.advanceTimersByTime(10_000);
    expect(log.filter((l) => !l.startsWith('state') && !l.startsWith('uuid'))).toEqual([
      'size',
      'sync',
    ]);
    expect(t.state).toBe(TunnelState.CLOSED);
  });

  it('can close, or error then close, at the end', () => {
    const closing = new ReplayTransport(recording, { onEnd: 'close' });
    const a = attach(closing);
    closing.connect();
    vi.advanceTimersByTime(350);
    expect(closing.state).toBe(TunnelState.CLOSED);
    expect(a.log.at(-1)).toBe('state:2');

    const status = makeStatus(0x0203, 'Upstream error');
    expect(status.isError()).toBe(true);
    expect(makeStatus(0).isError()).toBe(false);
    const failing = new ReplayTransport([], { onEnd: status });
    const b = attach(failing);
    failing.connect();
    vi.advanceTimersByTime(0);
    expect(b.log).toEqual(['state:0', 'uuid:replay', 'state:1', 'error:515', 'state:2']);
  });

  it('restarts from the beginning on reconnect', () => {
    const t = new ReplayTransport(recording);
    attach(t);
    t.connect();
    vi.advanceTimersByTime(100);
    expect(t.delivered).toBe(2);
    t.disconnect();
    t.connect('again');
    vi.advanceTimersByTime(0);
    expect(t.delivered).toBe(1);
    expect(t.connectData).toEqual([undefined, 'again']);
  });

  it('rejects invalid timing', () => {
    expect(() => new ReplayTransport([{ opcode: 'x', args: [], delayMs: -1 }])).toThrow(RangeError);
    expect(() => new ReplayTransport([], { speed: 0 })).toThrow(RangeError);
  });
});

describe('parseRecording', () => {
  it('validates and defaults delayMs', () => {
    expect(
      parseRecording([
        { opcode: 'sync', args: ['1'] },
        { opcode: 'nop', args: [], delayMs: 5 },
      ]),
    ).toEqual([
      { opcode: 'sync', args: ['1'], delayMs: 0 },
      { opcode: 'nop', args: [], delayMs: 5 },
    ]);
    expect(() => parseRecording({})).toThrow(/array/);
    expect(() => parseRecording([{ opcode: 'x', args: [1] }])).toThrow('[0].args[0]');
    expect(() => parseRecording([{ opcode: 'x', delayMs: -2 }])).toThrow(/>= 0/);
  });
});

describe('SessionTransport factories', () => {
  it('createWebSocketTransport passes the absolute websocket URL to the injected constructor', () => {
    const urls: string[] = [];
    class FakeTunnel extends ReplayTransport {
      constructor(url: string) {
        super([]);
        urls.push(url);
      }
    }
    const transport = createWebSocketTransport(FakeTunnel);
    const tunnel: TunnelLike = transport.createTunnel({
      baseUrl: 'https://guac.example/guacamole',
    });
    expect(transport.kind).toBe('websocket');
    expect(tunnel).toBeInstanceOf(FakeTunnel);
    expect(urls).toEqual(['wss://guac.example/guacamole/websocket-tunnel']);
  });

  it('createReplaySessionTransport yields a fresh replay tunnel each time', () => {
    const transport = createReplaySessionTransport(recording);
    const a = transport.createTunnel({ baseUrl: 'https://guac.example' });
    const b = transport.createTunnel({ baseUrl: 'https://guac.example' });
    expect(a).not.toBe(b);
    expect(transport.created).toHaveLength(2);
  });
});
