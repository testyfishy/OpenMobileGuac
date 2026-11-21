import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Guacamole from '../../vendor/guacamole-common-js/index.js';
import type { NativeSocketEvent, NativeSocketOpen, PinnedTlsPlugin } from '../tls/plugin.ts';
import {
  NativeBridgeTunnel,
  NativeSocketHub,
  type GuacamoleProtocolDeps,
} from './NativeBridgeTunnel.ts';
import { createPinAwareTransport } from './SessionTransport.ts';
import {
  TunnelState,
  type StatusLike,
  type TunnelConstructor,
  type TunnelLike,
} from './TunnelLike.ts';

const deps: GuacamoleProtocolDeps = {
  createParser: () => new Guacamole.Parser(),
  toInstruction: (e) => Guacamole.Parser.toInstruction([...e]),
  fromWebSocketCode: (c) => Guacamole.Status.Code.fromWebSocketCode(c),
  makeStatus: (c, m) => new Guacamole.Status(c, m),
};

const PIN = 'a'.repeat(64);
const URL = 'wss://guac.example.test:8443/guacamole/websocket-tunnel';

/** A fake native bridge: records calls and lets the test emit socket events. */
function fakeBridge() {
  let listener: ((e: NativeSocketEvent) => void) | undefined;
  const opened: NativeSocketOpen[] = [];
  const sent: { id: string; messages: readonly string[] }[] = [];
  const acks: string[] = [];
  const closed: { id: string; code: number }[] = [];
  const plugin: PinnedTlsPlugin = {
    inspect: async () => ({ der: '' }),
    request: async () => ({ status: 200, headers: {}, data: '' }),
    systemRequest: async () => ({ status: 200, headers: {}, data: '' }),
    openSocket: vi.fn(async (o: NativeSocketOpen) => {
      opened.push(o);
    }),
    send: vi.fn(async (o: { id: string; messages: readonly string[] }) => {
      sent.push({ id: o.id, messages: [...o.messages] });
    }),
    ack: vi.fn(async (o: { id: string }) => {
      acks.push(o.id);
    }),
    closeSocket: vi.fn(async (o: { id: string; code: number }) => {
      closed.push({ id: o.id, code: o.code });
    }),
    addListener: vi.fn(async (_name: 'socket', fn: (e: NativeSocketEvent) => void) => {
      listener = fn;
      return { remove: async () => undefined };
    }),
  };
  return {
    plugin,
    opened,
    sent,
    acks,
    closed,
    emit: (e: NativeSocketEvent) => listener?.(e),
    lastId: () => opened[opened.length - 1]?.id ?? '',
  };
}

function record(tunnel: TunnelLike) {
  const states: number[] = [];
  const errors: StatusLike[] = [];
  const instructions: [string, string[]][] = [];
  const uuids: string[] = [];
  tunnel.onstatechange = (s) => states.push(s);
  tunnel.onerror = (s) => errors.push(s);
  tunnel.oninstruction = (o, a) => instructions.push([o, a]);
  tunnel.onuuid = (u) => uuids.push(u);
  return { states, errors, instructions, uuids };
}

/** Opens a tunnel up to the UUID instruction. */
async function openTunnel() {
  const bridge = fakeBridge();
  const hub = new NativeSocketHub(bridge.plugin);
  const tunnel = new NativeBridgeTunnel({ hub, deps, url: URL, pins: [PIN] });
  const rec = record(tunnel);
  tunnel.connect('token=t&GUAC_ID=1');
  await vi.advanceTimersByTimeAsync(0);
  const id = bridge.lastId();
  bridge.emit({ id, type: 'open', protocol: 'guacamole' });
  bridge.emit({ id, type: 'messages', messages: ['0.,36.0a1b2c3d-0000-4000-8000-000000000000;'] });
  return { bridge, hub, tunnel, rec, id };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('NativeBridgeTunnel', () => {
  it('opens the native socket with the connect data, subprotocol and pins', async () => {
    const { bridge, tunnel, rec } = await openTunnel();
    expect(bridge.opened).toEqual([
      {
        id: bridge.lastId(),
        url: `${URL}?token=t&GUAC_ID=1`,
        protocols: ['guacamole'],
        pins: [PIN],
        timeoutMs: 15000,
      },
    ]);
    expect(rec.states).toEqual([TunnelState.CONNECTING, TunnelState.OPEN]);
    expect(tunnel.uuid).toBe('0a1b2c3d-0000-4000-8000-000000000000');
    expect(rec.uuids).toEqual([tunnel.uuid]);
    expect(tunnel.isConnected()).toBe(true);
  });

  it('delivers instructions (not internal ones), across frames, and acks each batch', async () => {
    const { bridge, rec, id } = await openTunnel();
    bridge.emit({ id, type: 'messages', messages: ['4.size,1.0,4.1024,3.768;4.sy', 'nc,1.1;'] });
    bridge.emit({ id, type: 'messages', messages: ['0.,4.ping,3.123;3.nop;'] });
    expect(rec.instructions).toEqual([
      ['size', ['0', '1024', '768']],
      ['sync', ['1']],
      ['nop', []],
    ]);
    expect(bridge.acks).toEqual([id, id, id]);
  });

  it('batches outgoing instructions per tick, one frame each, one bridge call in flight', async () => {
    const { bridge, tunnel, id } = await openTunnel();
    await vi.advanceTimersByTimeAsync(0);
    bridge.sent.length = 0;
    tunnel.sendMessage('mouse', 1, 2, 0);
    tunnel.sendMessage('key', 65, 1);
    tunnel.sendMessage('size', 'ü€');
    await vi.advanceTimersByTimeAsync(0);
    expect(bridge.sent).toEqual([
      { id, messages: ['5.mouse,1.1,1.2,1.0;', '3.key,2.65,1.1;', '4.size,2.ü€;'] },
    ]);
    tunnel.sendMessage();
    await vi.advanceTimersByTimeAsync(0);
    expect(bridge.sent).toHaveLength(1);
  });

  it('drops messages before open, like upstream', async () => {
    const bridge = fakeBridge();
    const tunnel = new NativeBridgeTunnel({
      hub: new NativeSocketHub(bridge.plugin),
      deps,
      url: URL,
      pins: [PIN],
    });
    tunnel.sendMessage('nop');
    tunnel.connect('x');
    tunnel.sendMessage('nop');
    await vi.advanceTimersByTimeAsync(0);
    expect(bridge.sent).toEqual([]);
  });

  it('pings every 500 ms through sendMessage (so wrappers count it)', async () => {
    const { bridge, tunnel, id } = await openTunnel();
    const wrapped = vi.fn();
    const send = tunnel.sendMessage.bind(tunnel);
    tunnel.sendMessage = (...e: unknown[]) => {
      wrapped(e[0], e[1]);
      send(...e);
    };
    bridge.emit({ id, type: 'messages', messages: ['3.nop;'] });
    await vi.advanceTimersByTimeAsync(600);
    expect(wrapped).toHaveBeenCalledWith('', 'ping');
  });

  it('goes UNSTABLE after the threshold and closes with UPSTREAM_TIMEOUT after the timeout', async () => {
    const { bridge, rec, tunnel } = await openTunnel();
    await vi.advanceTimersByTimeAsync(1600);
    expect(tunnel.state).toBe(TunnelState.UNSTABLE);
    await vi.advanceTimersByTimeAsync(15000);
    expect(tunnel.state).toBe(TunnelState.CLOSED);
    expect(rec.errors.map((e) => e.code)).toEqual([0x0202]);
    expect(bridge.closed).toHaveLength(1);
  });

  it.each([
    ['a numeric reason is the Guacamole status', { code: 1000, reason: '519' }, [519]],
    ['admin Kill (1000, "0") is a clean close: no onerror', { code: 1000, reason: '0' }, []],
    ['1000 without reason is a clean close', { code: 1000, reason: '' }, []],
    ['1006 is UPSTREAM_NOT_FOUND', { code: 1006, reason: '' }, [0x0207]],
    ['1001 is UPSTREAM_UNAVAILABLE', { code: 1001, reason: '' }, [0x0208]],
    ['no code is UPSTREAM_NOT_FOUND', { code: 0, reason: '' }, [0x0207]],
  ])('close mapping: %s', async (_name, close, codes) => {
    const { bridge, rec, tunnel, id } = await openTunnel();
    bridge.emit({ id, type: 'close', ...close });
    expect(rec.errors.map((e) => e.code)).toEqual(codes);
    expect(tunnel.state).toBe(TunnelState.CLOSED);
    expect(rec.states.at(-1)).toBe(TunnelState.CLOSED);
  });

  it('a native failure is never a clean close, even with code 1000', async () => {
    const { bridge, rec, tunnel, id } = await openTunnel();
    bridge.emit({ id, type: 'close', code: 1000, reason: '0', error: 'PIN_MISMATCH', der: 'AA==' });
    expect(rec.errors.map((e) => e.code)).toEqual([0x0207]);
    expect(tunnel.failure).toBe('PIN_MISMATCH');
  });

  it('a failure before open (handshake) errors, then closes', async () => {
    const bridge = fakeBridge();
    const tunnel = new NativeBridgeTunnel({
      hub: new NativeSocketHub(bridge.plugin),
      deps,
      url: URL,
      pins: [PIN],
    });
    const rec = record(tunnel);
    tunnel.connect('x');
    await vi.advanceTimersByTimeAsync(0);
    bridge.emit({ id: bridge.lastId(), type: 'close', code: 1015, reason: '', error: 'TLS' });
    expect(rec.errors.map((e) => e.code)).toEqual([0x0207]);
    expect(rec.states).toEqual([TunnelState.CONNECTING, TunnelState.CLOSED]);
  });

  it('openSocket rejecting closes with UPSTREAM_NOT_FOUND', async () => {
    const bridge = fakeBridge();
    vi.mocked(bridge.plugin.openSocket).mockRejectedValueOnce(new Error('BAD_REQUEST'));
    const tunnel = new NativeBridgeTunnel({
      hub: new NativeSocketHub(bridge.plugin),
      deps,
      url: URL,
      pins: [PIN],
    });
    const rec = record(tunnel);
    tunnel.connect('x');
    await vi.advanceTimersByTimeAsync(0);
    expect(rec.errors.map((e) => e.code)).toEqual([0x0207]);
    expect(tunnel.state).toBe(TunnelState.CLOSED);
  });

  it('disconnect closes the native socket without onerror and ignores later events', async () => {
    const { bridge, rec, tunnel, id } = await openTunnel();
    tunnel.disconnect();
    expect(rec.errors).toEqual([]);
    expect(tunnel.state).toBe(TunnelState.CLOSED);
    await vi.advanceTimersByTimeAsync(0);
    expect(bridge.closed).toEqual([{ id, code: 1000 }]);
    bridge.emit({ id, type: 'messages', messages: ['3.nop;'] });
    bridge.emit({ id, type: 'close', code: 1006, reason: '' });
    expect(rec.instructions).toEqual([]);
    expect(rec.errors).toEqual([]);
    expect(bridge.acks.at(-1)).toBe(id); // acked anyway, so native never waits
  });

  it('a malformed instruction closes with SERVER_ERROR', async () => {
    const { bridge, rec, id } = await openTunnel();
    bridge.emit({ id, type: 'messages', messages: ['x.bad;'] });
    expect(rec.errors.map((e) => e.code)).toEqual([0x0200]);
  });

  it('refuses to exist without a pin', () => {
    const bridge = fakeBridge();
    expect(
      () =>
        new NativeBridgeTunnel({
          hub: new NativeSocketHub(bridge.plugin),
          deps,
          url: URL,
          pins: [],
        }),
    ).toThrow();
  });
});

describe('createPinAwareTransport', () => {
  class FakeWebSocketTunnel {
    readonly url: string;
    constructor(url: string) {
      this.url = url;
    }
  }
  const Tunnel = FakeWebSocketTunnel as unknown as TunnelConstructor;

  it('without native support is the plain WebSocket transport', () => {
    const t = createPinAwareTransport(Tunnel, undefined);
    expect(t.kind).toBe('websocket');
    expect(t.createTunnel({ baseUrl: 'https://guac.example.test/guacamole' })).toBeInstanceOf(
      FakeWebSocketTunnel,
    );
  });

  it('uses the native tunnel only for an origin with a pin', () => {
    const bridge = fakeBridge();
    const pinsFor = vi.fn((url: string) =>
      url.startsWith('wss://guac.example.test:8443/') ? [PIN] : [],
    );
    const t = createPinAwareTransport(Tunnel, {
      hub: new NativeSocketHub(bridge.plugin),
      deps,
      pinsFor,
    });
    expect(t.createTunnel({ baseUrl: 'https://guac.example.test:8443/guacamole' })).toBeInstanceOf(
      NativeBridgeTunnel,
    );
    expect(pinsFor).toHaveBeenCalledWith(URL);
    expect(t.createTunnel({ baseUrl: 'https://guac.example.test/guacamole' })).toBeInstanceOf(
      FakeWebSocketTunnel,
    );
    expect(t.createTunnel({ baseUrl: 'http://guac.example.test:8443/guacamole' })).toBeInstanceOf(
      FakeWebSocketTunnel,
    );
  });
});
