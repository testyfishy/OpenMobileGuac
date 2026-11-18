import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TunnelState } from '../core/transport/TunnelLike.ts';
import Guacamole from '../vendor/guacamole-common-js/index.js';
import { DemoTunnel, createDemoSessionTransport, type DemoTunnelOptions } from './DemoTunnel.ts';
import { LAYERS, MAX_PASTE } from './desktop.ts';
import { Keysym } from './keysyms.ts';
import { DEMO_CONNECTIONS, DEMO_SERVER_PROFILE } from './profile.ts';
import { assertHttpBaseUrl } from '../core/models/ServerProfile.ts';
import { base64ToBytes, bytesToBase64, encodeInstruction } from './protocol.ts';
import { STAGING_LAYER, type DemoServer } from './server.ts';
import { createStubRenderer } from './testing.ts';

interface Rx {
  readonly opcode: string;
  readonly args: string[];
}

function setup(options: DemoTunnelOptions = {}) {
  const renderer = createStubRenderer();
  const tunnel = new DemoTunnel({ renderer, uuid: 'demo-test', ...options });
  const rx: Rx[] = [];
  const log: string[] = [];
  tunnel.oninstruction = (opcode, args) => {
    rx.push({ opcode, args });
    log.push(`ins:${opcode}`);
  };
  tunnel.onstatechange = (s) => log.push(`state:${s}`);
  tunnel.onuuid = (u) => log.push(`uuid:${u}`);
  tunnel.onerror = (s) => log.push(`error:${s.code}`);
  const take = () => rx.splice(0);
  return { tunnel, renderer, rx, log, take };
}

function open(t: DemoTunnel, data = 'GUAC_WIDTH=1280&GUAC_HEIGHT=800') {
  t.connect(data);
  vi.advanceTimersByTime(0);
}

/** Lets the server coalesce input into a frame. */
function frame() {
  vi.advanceTimersByTime(20);
}

function srv(t: DemoTunnel): DemoServer {
  if (!t.server) throw new Error('tunnel is not open');
  return t.server;
}

const ops = (list: readonly Rx[]) => list.map((i) => i.opcode);
const find = (list: readonly Rx[], opcode: string) => list.filter((i) => i.opcode === opcode);

/** Reads a server-to-client stream with the vendored StringReader, as the UI would. */
function readTextStream(list: readonly Rx[], index: string): string {
  const fakeClient = { sendAck: () => {} } as unknown as Guacamole.Client;
  const stream = new Guacamole.InputStream(fakeClient, Number(index));
  const reader = new Guacamole.StringReader(stream);
  let text = '';
  let ended = false;
  reader.ontext = (t) => (text += t);
  reader.onend = () => (ended = true);
  for (const i of list) {
    if (i.args[0] !== index) continue;
    if (i.opcode === 'blob') stream.onblob?.(i.args[1] ?? '');
    if (i.opcode === 'end') stream.onend?.();
  }
  expect(ended).toBe(true);
  return text;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2024, 4, 6, 10, 0, 0, 500));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('DemoTunnel handshake', () => {
  it('goes CONNECTING synchronously and OPEN with a uuid on the next tick', () => {
    const { tunnel, log, rx } = setup();
    expect(tunnel.state).toBe(TunnelState.CLOSED);
    tunnel.connect('GUAC_WIDTH=1024&GUAC_HEIGHT=700');
    expect(tunnel.state).toBe(TunnelState.CONNECTING);
    expect(log).toEqual(['state:0']);
    expect(rx).toEqual([]);

    vi.advanceTimersByTime(0);
    expect(tunnel.isConnected()).toBe(true);
    expect(tunnel.uuid).toBe('demo-test');
    expect(log.slice(0, 4)).toEqual(['state:0', 'uuid:demo-test', 'state:1', 'ins:name']);
  });

  it('sends name, cursor, layer sizes and a first frame ending in sync', () => {
    const { tunnel, rx } = setup();
    open(tunnel, 'token=x&GUAC_ID=demo-desktop&GUAC_WIDTH=1024&GUAC_HEIGHT=700&GUAC_DPI=96');
    expect(rx[0]).toEqual({ opcode: 'name', args: ['Demo desktop'] });
    expect(rx.at(-1)?.opcode).toBe('sync');
    expect(find(rx, 'sync')).toHaveLength(1);

    const sizes = find(rx, 'size').map((i) => i.args);
    expect(sizes).toContainEqual(['0', '1024', '700']);
    for (const layer of [1, 2, 3, 4]) expect(sizes.some((s) => s[0] === String(layer))).toBe(true);
    // Cursor images go to buffers (negative layers) and are selected with `cursor`.
    expect(sizes.some((s) => Number(s[0]) < 0)).toBe(true);
    const cursor = find(rx, 'cursor');
    expect(cursor).toHaveLength(1);
    expect(cursor[0]?.args).toEqual(['1', '1', '-1', '0', '0', '13', '20']);

    // Windows are positioned with move; the hidden menu is shaded out.
    // Every layer has z = 0; stacking is DOM order, built by re-appending bottom to top
    // through the staging layer. At 1024 px the windows cascade, stacked in cascade order:
    // Notes, Input test, About, then the menu.
    const moves = find(rx, 'move').map((i) => i.args);
    expect(moves.every((m) => m[4] === '0')).toBe(true);
    const order = ['1', '2', '3', '4'];
    expect(moves.filter((m) => m[1] === '0').map((m) => m[0])).toEqual(order);
    expect(moves.filter((m) => m[1] === String(STAGING_LAYER)).map((m) => m[0])).toEqual(order);
    expect(find(rx, 'shade')).toEqual([
      { opcode: 'shade', args: [String(STAGING_LAYER), '0'] },
      { opcode: 'shade', args: [String(LAYERS.menu), '0'] },
    ]);

    // Layer 0 is cleared with rect + cfill before tiles arrive.
    const iRect = rx.findIndex((i) => i.opcode === 'rect' && i.args[0] === '0');
    expect(rx[iRect]?.args).toEqual(['0', '0', '0', '1024', '700']);
    expect(rx[iRect + 1]?.opcode).toBe('cfill');
    expect(rx[iRect + 1]?.args.slice(0, 2)).toEqual(['14', '0']);

    // Every img stream is followed by blobs and an end on the same index.
    const imgs = find(rx, 'img');
    expect(imgs.length).toBeGreaterThan(10);
    for (const img of imgs) {
      const [index, mask, , mimetype] = img.args;
      expect(mask).toBe('14');
      expect(mimetype).toBe('image/png');
      const at = rx.indexOf(img);
      expect([rx[at + 1]?.opcode, rx[at + 1]?.args[0]]).toEqual(['blob', index]);
      const end = rx.findIndex((i, k) => k > at && i.opcode === 'end' && i.args[0] === index);
      expect(end).toBeGreaterThan(at);
    }
    // Tiles cover all of layer 0.
    const area = imgs
      .filter((i) => i.args[2] === '0')
      .map((i) => {
        const blob = find(rx, 'blob').find((b) => b.args[0] === i.args[0]);
        const [, , wh = ''] = atob(blob?.args[1] ?? '').split(' ');
        const [w = 0, h = 0] = wh.split('x').map(Number);
        return w * h;
      })
      .reduce((a, b) => a + b, 0);
    expect(area).toBe(1024 * 700);
  });

  it('produces only well-formed wire instructions', () => {
    const { tunnel, rx } = setup();
    open(tunnel);
    const wire = rx.map((i) => Guacamole.Parser.toInstruction([i.opcode, ...i.args])).join('');
    const parser = new Guacamole.Parser();
    const parsed: Rx[] = [];
    parser.oninstruction = (opcode, args) => parsed.push({ opcode, args });
    parser.receive(wire);
    expect(parsed).toEqual(rx);
    expect(wire).toBe(rx.map((i) => encodeInstruction(i.opcode, i.args)).join(''));
  });

  it('uses a default size, clamps silly sizes, and honours fixed-size connections', () => {
    const a = setup({ width: 900, height: 600 });
    open(a.tunnel, '');
    expect(find(a.rx, 'size').map((i) => i.args)).toContainEqual(['0', '900', '600']);

    const b = setup();
    open(b.tunnel, 'GUAC_WIDTH=5&GUAC_HEIGHT=100000');
    expect(find(b.rx, 'size').map((i) => i.args)).toContainEqual(['0', '320', '4096']);

    const c = setup();
    open(c.tunnel, 'GUAC_ID=demo-desktop-1024&GUAC_WIDTH=2000&GUAC_HEIGHT=1000');
    expect(c.rx[0]?.args[0]).toBe('Demo desktop (fixed 1024 × 768)');
    expect(find(c.rx, 'size').map((i) => i.args)).toContainEqual(['0', '1024', '768']);
    c.take();
    c.tunnel.sendMessage('size', 1500, 900);
    frame();
    expect(find(c.rx, 'size')).toEqual([]);
  });

  it('drops messages sent before open', () => {
    const { tunnel } = setup();
    tunnel.sendMessage('mouse', 1, 2, 0);
    tunnel.connect();
    tunnel.sendMessage('mouse', 1, 2, 0);
    vi.advanceTimersByTime(0);
    expect(srv(tunnel).desktop.pointerX).toBe(0);
  });

  it('reports a renderer failure as a tunnel error and closes', () => {
    const { tunnel, log } = setup({
      renderer: () => {
        throw new Error('no canvas');
      },
    });
    open(tunnel);
    expect(log).toEqual(['state:0', 'error:512', 'state:2']);
  });

  it('works with an asynchronous renderer, keeping instruction order', async () => {
    const renderer = createStubRenderer({ async: true });
    const { tunnel, rx } = setup({ renderer });
    open(tunnel);
    expect(ops(rx)).toEqual(['name']);
    await vi.advanceTimersByTimeAsync(0);
    expect(rx.at(-1)?.opcode).toBe('sync');
    expect(find(rx, 'img').length).toBeGreaterThan(0);
  });
});

describe('DemoTunnel input', () => {
  it('records sync acknowledgements', () => {
    const { tunnel, rx } = setup();
    open(tunnel);
    const ts = find(rx, 'sync')[0]?.args[0] ?? '';
    tunnel.sendMessage('sync', ts);
    expect(srv(tunnel).lastAckedSync).toBe(Number(ts));
  });

  it('sync timestamps strictly increase', () => {
    const { tunnel, rx } = setup();
    open(tunnel);
    for (let i = 0; i < 5; i++) {
      tunnel.sendMessage('mouse', 10 + i, 10, 0);
      frame();
    }
    const stamps = find(rx, 'sync').map((i) => Number(i.args[0]));
    expect(stamps.length).toBe(6);
    for (let i = 1; i < stamps.length; i++)
      expect(stamps[i]).toBeGreaterThan(stamps[i - 1] as number);
  });

  it('coalesces mouse moves into one frame that repaints only what changed', () => {
    const { tunnel, take } = setup();
    open(tunnel);
    take();
    for (let i = 0; i < 20; i++) tunnel.sendMessage('mouse', 900 + i, 700, 0);
    expect(take()).toEqual([]);
    frame();
    const out = take();
    expect(find(out, 'sync')).toHaveLength(1);
    const imgs = find(out, 'img');
    expect(imgs.length).toBeGreaterThan(0);
    // Only the Input test window (layer 2) changes: the pointer row.
    expect(new Set(imgs.map((i) => i.args[2]))).toEqual(new Set(['2']));
    expect(srv(tunnel).desktop.pointerX).toBe(919);
  });

  it('moves a dragged window with move instructions, without repainting it', () => {
    const { tunnel, take } = setup();
    open(tunnel);
    const notes = srv(tunnel).desktop.windows.notes;
    const x0 = notes.x + 200;
    const y0 = notes.y + 10;
    take();
    tunnel.sendMessage('mouse', x0, y0, 1);
    frame();
    const press = take();
    // Pressing raises Notes above Input test: from the first changed position upwards,
    // layers are re-appended via the staging layer. z stays 0.
    const moves = find(press, 'move').map((i) => i.args);
    expect(moves).toContainEqual(['1', String(STAGING_LAYER), '0', '0', '0']);
    expect(moves).toContainEqual(['1', '0', String(notes.x), String(notes.y), '0']);
    expect(moves.filter((m) => m[1] === '0').map((m) => m[0])).toEqual(['2', '1', '4']);
    // The cursor switched to the move shape when the drag began.
    expect(find(press, 'cursor')[0]?.args[2]).toBe('-3');

    tunnel.sendMessage('mouse', x0 + 50, y0 + 40, 1);
    frame();
    const out = take();
    expect(find(out, 'move')).toEqual([
      { opcode: 'move', args: ['1', '0', String(notes.x), String(notes.y), '0'] },
    ]);
    expect(find(out, 'img').filter((i) => i.args[2] === '1')).toEqual([]);
    tunnel.sendMessage('mouse', x0 + 50, y0 + 40, 0);
    frame();
  });

  it('pastes a very large phone clipboard without failing', () => {
    const { tunnel } = setup();
    open(tunnel);
    const d = srv(tunnel).desktop;
    const big = 'abcdefghij'.repeat(20000);
    tunnel.sendMessage('clipboard', 1, 'text/plain');
    tunnel.sendMessage('blob', 1, bytesToBase64(new TextEncoder().encode(big)));
    tunnel.sendMessage('end', 1);
    expect(d.clipboard).toHaveLength(200000);
    d.notes.setText('');
    tunnel.sendMessage('key', Keysym.Control_L, 1);
    tunnel.sendMessage('key', 0x76, 1);
    tunnel.sendMessage('key', Keysym.Control_L, 0);
    expect(d.notes.length).toBe(MAX_PASTE);
    frame();
    expect(tunnel.isConnected()).toBe(true);
  });

  it('scrolls the list with copy plus a strip of new pixels', () => {
    const { tunnel, take } = setup();
    open(tunnel);
    const input = srv(tunnel).desktop.windows.input;
    const x = input.x + 400;
    const y = input.y + 300;
    take();
    tunnel.sendMessage('mouse', x, y, 16);
    tunnel.sendMessage('mouse', x, y, 0);
    frame();
    const out = take();
    const copy = find(out, 'copy');
    expect(copy).toHaveLength(1);
    // copy,src layer,x,y,w,h,mask,dst layer,x,y: content moves up by two rows (40 px).
    const [src, sx, sy, w, h, mask, dst, dx, dy] = (copy[0]?.args ?? []).map(Number);
    expect([src, mask, dst, dx, sx]).toEqual([2, 14, 2, sx, sx]);
    expect(Number(sy) - Number(dy)).toBe(40);
    expect(w).toBeGreaterThan(100);
    expect(h).toBe(198 - 40);
    // copy comes before the repaint of the exposed strip.
    expect(out.findIndex((i) => i.opcode === 'copy')).toBeLessThan(
      out.findIndex((i) => i.opcode === 'img'),
    );
  });

  it('applies keys with modifiers', () => {
    const { tunnel } = setup();
    open(tunnel);
    tunnel.sendMessage('key', Keysym.Control_L, 1);
    tunnel.sendMessage('key', Keysym.Alt_L, 1);
    tunnel.sendMessage('key', Keysym.Delete, 1);
    expect(srv(tunnel).desktop.lastKey).toBe('Ctrl+Alt+Delete');
  });

  it('re-lays out on size and resizes layer 0', () => {
    const { tunnel, take } = setup();
    open(tunnel);
    take();
    tunnel.sendMessage('size', 800, 1000);
    frame();
    const out = take();
    expect(find(out, 'size')).toEqual([{ opcode: 'size', args: ['0', '800', '1000'] }]);
    expect(find(out, 'move').length).toBeGreaterThan(0);
    const layer0 = find(out, 'img').filter((i) => i.args[2] === '0');
    expect(layer0.length).toBe(Math.ceil(800 / 256) * Math.ceil(1000 / 256));
  });

  it('rejects file uploads and other streams with an error ack', () => {
    const { tunnel, take } = setup();
    open(tunnel);
    take();
    tunnel.sendMessage('file', 3, 'application/pdf', 'a.pdf');
    expect(take()).toEqual([]); // replies are asynchronous
    vi.advanceTimersByTime(0);
    expect(take()).toEqual([
      { opcode: 'ack', args: ['3', 'Not supported by the demo server', '256'] },
    ]);
  });

  it('closes after disconnect and sends nothing more', () => {
    const { tunnel, take, log } = setup();
    open(tunnel);
    take();
    tunnel.sendMessage('nop');
    tunnel.sendMessage('disconnect');
    expect(tunnel.state).toBe(TunnelState.CLOSED);
    tunnel.disconnect();
    vi.advanceTimersByTime(5000);
    expect(take()).toEqual([]);
    expect(log.filter((l) => l === 'state:2')).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('updates the taskbar clock every second', () => {
    const { tunnel, take } = setup();
    open(tunnel);
    take();
    vi.advanceTimersByTime(1000);
    const out = take();
    expect(find(out, 'sync')).toHaveLength(1);
    expect(find(out, 'img').every((i) => i.args[2] === '0')).toBe(true);
  });
});

describe('DemoTunnel clipboard', () => {
  // The vendored stream helpers use window.atob/btoa.
  beforeEach(() => {
    vi.stubGlobal('window', globalThis);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('receives a clipboard stream from the client, acks each blob, and pastes it', () => {
    const { tunnel, take } = setup();
    open(tunnel);
    take();
    const text = 'Grüße 🙂 from the phone';
    const b64 = bytesToBase64(new TextEncoder().encode(text));
    // Split inside a multi-byte character to check bytes are joined before decoding.
    const bytes = base64ToBytes(b64);
    const first = bytesToBase64(bytes.slice(0, 4));
    const second = bytesToBase64(bytes.slice(4));
    tunnel.sendMessage('clipboard', 7, 'text/plain');
    tunnel.sendMessage('blob', 7, first);
    tunnel.sendMessage('blob', 7, second);
    tunnel.sendMessage('end', 7);
    vi.advanceTimersByTime(0);
    expect(find(take(), 'ack')).toEqual([
      { opcode: 'ack', args: ['7', 'OK', '0'] },
      { opcode: 'ack', args: ['7', 'OK', '0'] },
    ]);
    const d = srv(tunnel).desktop;
    expect(d.clipboard).toBe(text);
    frame();
    expect(find(take(), 'img').some((i) => i.args[2] === '1')).toBe(true);

    d.notes.setText('');
    tunnel.sendMessage('key', Keysym.Control_L, 1);
    tunnel.sendMessage('key', 0x76, 1);
    tunnel.sendMessage('key', 0x76, 0);
    tunnel.sendMessage('key', Keysym.Control_L, 0);
    expect(d.notes.text).toBe(text);
  });

  it('accepts a clipboard written by the vendored StringWriter', () => {
    const { tunnel } = setup();
    open(tunnel);
    // Minimal client: just enough for OutputStream/StringWriter to send through the tunnel.
    const client = {
      sendBlob: (i: number, data: string) => tunnel.sendMessage('blob', i, data),
      endStream: (i: number) => tunnel.sendMessage('end', i),
    } as unknown as Guacamole.Client;
    tunnel.sendMessage('clipboard', 0, 'text/plain');
    const writer = new Guacamole.StringWriter(new Guacamole.OutputStream(client, 0));
    const long = 'é'.repeat(5000) + ' end';
    writer.sendText(long);
    writer.sendEnd();
    expect(srv(tunnel).desktop.clipboard).toBe(long);
  });

  it('ignores non-text clipboard data with an error ack', () => {
    const { tunnel, take } = setup();
    open(tunnel);
    take();
    tunnel.sendMessage('clipboard', 2, 'image/png');
    tunnel.sendMessage('blob', 2, 'AAAA');
    tunnel.sendMessage('end', 2);
    vi.advanceTimersByTime(0);
    expect(find(take(), 'ack')).toEqual([
      { opcode: 'ack', args: ['2', 'Only text clipboard data is supported', '256'] },
    ]);
    expect(srv(tunnel).desktop.clipboard).toBe('');
  });

  it('sends Ctrl+C text to the client as clipboard, blob and end', () => {
    const { tunnel, take } = setup();
    open(tunnel);
    const d = srv(tunnel).desktop;
    d.notes.setText('Copied: ☕ naïve 🙂');
    take();
    for (const [k, p] of [
      [Keysym.Control_L, 1],
      [0x61, 1],
      [0x61, 0],
      [0x63, 1],
      [0x63, 0],
      [Keysym.Control_L, 0],
    ] as const) {
      tunnel.sendMessage('key', k, p);
    }
    frame();
    const out = take();
    const clip = find(out, 'clipboard');
    expect(clip).toHaveLength(1);
    const [index = '', mimetype] = clip[0]?.args ?? [];
    expect(mimetype).toBe('text/plain');
    // The bytes on the wire are exact UTF-8, astral characters included...
    const bytes = find(out, 'blob')
      .filter((b) => b.args[0] === index)
      .map((b) => base64ToBytes(b.args[1] ?? ''));
    expect(new TextDecoder().decode(bytes[0])).toBe('Copied: ☕ naïve 🙂');
    // ...and the vendored StringReader decodes them. (Its UTF8Parser in 1.6.0 truncates
    // code points above U+FFFF with String.fromCharCode, so compare only the BMP part.)
    expect(readTextStream(out, index).startsWith('Copied: ☕ naïve ')).toBe(true);
    expect(d.clipboardSource).toBe('notes');
  });
});

describe('createDemoSessionTransport', () => {
  it('creates fresh demo tunnels', () => {
    const transport = createDemoSessionTransport({ renderer: createStubRenderer() });
    expect(transport.kind).toBe('replay');
    expect(transport.demo).toBe(true);
    const a = transport.createTunnel({ baseUrl: DEMO_SERVER_PROFILE.baseUrl });
    const b = transport.createTunnel({ baseUrl: DEMO_SERVER_PROFILE.baseUrl });
    expect(a).toBeInstanceOf(DemoTunnel);
    expect(a).not.toBe(b);
  });

  it('lists valid, invented demo connections', () => {
    expect(() => assertHttpBaseUrl(DEMO_SERVER_PROFILE.baseUrl)).not.toThrow();
    expect(new URL(DEMO_SERVER_PROFILE.baseUrl).hostname.endsWith('.invalid')).toBe(true);
    expect(DEMO_CONNECTIONS.map((c) => c.name)).toContain('Demo desktop');
  });
});
