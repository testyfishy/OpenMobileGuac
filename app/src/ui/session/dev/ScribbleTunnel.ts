/**
 * ScribbleTunnel: a tiny in-memory `TunnelLike` test double for the session dev harness.
 *
 * It completes the handshake, draws a simple fake desktop with `rect`/`cfill`, supplies a
 * server cursor image, moves a "remote cursor box" layer to wherever the client's mouse
 * goes, paints a dot trail while the left button is held, resizes on `size`, and records
 * every mouse / key / clipboard instruction it receives so the harness can show them.
 *
 * Instruction formats follow the vendored `Client.js` handlers (`size`, `rect`, `cfill`,
 * `move`, `cursor`, `clipboard`, `blob`, `end`, `sync`). Fills use channel mask 0xE,
 * `Guacamole.Layer.OVER` (`Layer.js`); SRC (0xC) maps to canvas "copy", which would
 * clear everything outside each rectangle.
 */

import {
  TunnelState,
  makeStatus,
  type StatusLike,
  type TunnelLike,
} from '../../../core/transport/TunnelLike.ts';

const OVER = 0xe;

export interface ScribbleLogEntry {
  readonly time: number;
  readonly kind: 'mouse' | 'key' | 'clipboard' | 'size' | 'connect' | 'file' | 'argv' | 'other';
  readonly text: string;
}

type Rgb = readonly [number, number, number];

const DESKTOP: Rgb = [38, 70, 110];
const TASKBAR: Rgb = [24, 28, 36];
const WINDOW: Rgb = [235, 238, 242];
const TITLE: Rgb = [60, 110, 200];
const TRAIL: Rgb = [250, 170, 40];

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToUtf8(data: string): string {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function keysymLabel(keysym: number): string {
  if (keysym >= 0x20 && keysym <= 0xff) return JSON.stringify(String.fromCharCode(keysym));
  if (keysym >= 0x01000100 && keysym <= 0x0110ffff) {
    return JSON.stringify(String.fromCodePoint(keysym & 0xffffff));
  }
  return '0x' + keysym.toString(16);
}

export class ScribbleTunnel implements TunnelLike {
  state: number = TunnelState.CLOSED;
  uuid: string | null = null;
  receiveTimeout = 15000;
  unstableThreshold = 1500;
  onuuid: ((uuid: string) => void) | null = null;
  onerror: ((status: StatusLike) => void) | null = null;
  onstatechange: ((state: number) => void) | null = null;
  oninstruction: ((opcode: string, args: string[]) => void) | null = null;

  /** Called whenever the log changes. */
  onlog: ((entries: readonly ScribbleLogEntry[]) => void) | null = null;

  private width = 1280;
  private height = 800;
  private readonly log: ScribbleLogEntry[] = [];
  private readonly incomingClipboard = new Map<string, string>();
  private queue: string[][] = [];
  private flushScheduled = false;
  private lastMask = 0;
  private syncCounter = 0;
  private outStream = 100;
  private readonly connectDelayMs: number;
  private readonly failConnect: StatusLike | null;
  private readonly startTime = Date.now();

  constructor(options: { connectDelayMs?: number; failConnect?: StatusLike | null } = {}) {
    this.connectDelayMs = options.connectDelayMs ?? 400;
    this.failConnect = options.failConnect ?? null;
  }

  getLog(): readonly ScribbleLogEntry[] {
    return this.log;
  }

  isConnected(): boolean {
    return this.state === TunnelState.OPEN || this.state === TunnelState.UNSTABLE;
  }

  setState(state: number): void {
    if (state === this.state) return;
    this.state = state;
    this.onstatechange?.(state);
  }

  setUUID(uuid: string): void {
    this.uuid = uuid;
    this.onuuid?.(uuid);
  }

  connect(data?: string): void {
    this.setState(TunnelState.CONNECTING);
    const params = new URLSearchParams(data ?? '');
    const w = Number(params.get('GUAC_WIDTH'));
    const h = Number(params.get('GUAC_HEIGHT'));
    this.record('connect', `connect ${data ?? ''}`);
    // A fake desktop keeps a fixed size unless the client asks for a resize later; the
    // connect-string size is honoured only when it is plausible.
    if (w >= 320 && h >= 240 && params.get('SCRIBBLE_MATCH') === '1') {
      this.width = Math.min(4096, Math.floor(w));
      this.height = Math.min(4096, Math.floor(h));
    }
    setTimeout(() => {
      if (this.state !== TunnelState.CONNECTING) return;
      if (this.failConnect) {
        this.onerror?.(this.failConnect);
        this.setState(TunnelState.CLOSED);
        return;
      }
      this.setUUID('scribble-' + Math.random().toString(36).slice(2, 10));
      this.setState(TunnelState.OPEN);
      this.send(['name', 'Scribble desktop']);
      this.beforeDesktop(() => {
        this.drawDesktop();
        this.sendCursorImage();
        this.afterDesktop();
      });
    }, this.connectDelayMs);
  }

  disconnect(): void {
    this.setState(TunnelState.CLOSED);
  }

  /** Simulate network loss: the tunnel errors and closes on its own. */
  drop(): void {
    if (!this.isConnected()) return;
    this.onerror?.(makeStatus(0x0202, 'Simulated network loss'));
    this.setState(TunnelState.CLOSED);
  }

  /** Simulate the remote copying text: a server-to-client clipboard stream. */
  emitClipboard(text: string): void {
    if (!this.isConnected()) return;
    const idx = String(this.outStream++);
    this.send(['clipboard', idx, 'text/plain']);
    this.send(['blob', idx, utf8ToBase64(text)]);
    this.send(['end', idx]);
    this.record('clipboard', `remote copied ${JSON.stringify(text)}`);
  }

  /** Hook: runs after the handshake, before the first frame (e.g. a `required` prompt). */
  protected beforeDesktop(draw: () => void): void {
    draw();
  }

  /** Hook: runs after the first frame. */
  protected afterDesktop(): void {}

  /** Hook: handle an instruction from the client first; return true when consumed. */
  protected handleExtra(opcode: string, args: readonly string[]): boolean {
    void opcode;
    void args;
    return false;
  }

  sendMessage(...elements: unknown[]): void {
    if (!this.isConnected()) return;
    const [opcode, ...rest] = elements.map((e) => String(e));
    if (opcode === undefined) return;
    if (this.handleExtra(opcode, rest)) return;
    switch (opcode) {
      case 'mouse':
        this.onMouse(rest);
        break;
      case 'key': {
        const keysym = Number(rest[0]);
        this.record('key', `key ${keysymLabel(keysym)} ${rest[1] === '1' ? 'down' : 'up'}`);
        break;
      }
      case 'clipboard':
        this.incomingClipboard.set(rest[0] ?? '', '');
        this.record('clipboard', `clipboard stream ${rest[0] ?? ''} ${rest[1] ?? ''}`);
        break;
      case 'blob': {
        const idx = rest[0] ?? '';
        if (this.incomingClipboard.has(idx)) {
          this.incomingClipboard.set(
            idx,
            (this.incomingClipboard.get(idx) ?? '') + (rest[1] ?? ''),
          );
          this.send(['ack', idx, 'OK', '0']);
        }
        break;
      }
      case 'end': {
        const idx = rest[0] ?? '';
        const data = this.incomingClipboard.get(idx);
        if (data !== undefined) {
          this.incomingClipboard.delete(idx);
          let text: string;
          try {
            text = base64ToUtf8(data);
          } catch {
            text = '(undecodable)';
          }
          this.record('clipboard', `remote clipboard = ${JSON.stringify(text)}`);
        }
        break;
      }
      case 'size': {
        const w = Math.floor(Number(rest[0]));
        const h = Math.floor(Number(rest[1]));
        this.record('size', `size ${w}x${h}`);
        if (w >= 64 && h >= 64) {
          this.width = Math.min(4096, w);
          this.height = Math.min(4096, h);
          this.drawDesktop();
        }
        break;
      }
      case 'sync':
      case 'nop':
      case 'ack':
        break;
      case 'disconnect':
        this.record('other', 'disconnect');
        break;
      default:
        this.record('other', [opcode, ...rest].join(','));
    }
  }

  // -------------------------------------------------------------------------------------

  private onMouse(args: string[]): void {
    const x = Math.floor(Number(args[0]));
    const y = Math.floor(Number(args[1]));
    const mask = Math.floor(Number(args[2]));
    if (mask !== this.lastMask) {
      const names = ['left', 'middle', 'right', 'up', 'down'].filter((_, i) => (mask >> i) & 1);
      this.record('mouse', `mouse ${x},${y} [${names.join(' ') || 'none'}]`);
      this.lastMask = mask;
    }
    // Cursor box follows the pointer (offset so the hotspot stays visible).
    this.send(['move', '1', '0', String(x + 14), String(y + 14), '1']);
    if (mask & 1) this.fill(0, x - 3, y - 3, 6, 6, TRAIL);
    this.sync();
  }

  protected drawDesktop(): void {
    const w = this.width;
    const h = this.height;
    this.send(['size', '0', String(w), String(h)]);
    this.fill(0, 0, 0, w, h, DESKTOP);
    // Diagonal-ish pattern of tiles so panning/zooming is visible.
    for (let ty = 0; ty < h; ty += 80) {
      for (let tx = (ty / 80) % 2 === 0 ? 0 : 80; tx < w; tx += 160) {
        this.fill(0, tx, ty, 80, 80, [44, 80, 124]);
      }
    }
    // A "window" with a title bar and a few buttons.
    const ww = Math.min(560, w - 80);
    const wh = Math.min(360, h - 140);
    this.fill(0, 40, 40, ww, wh, WINDOW);
    this.fill(0, 40, 40, ww, 32, TITLE);
    for (let i = 0; i < 4; i++) this.fill(0, 64 + i * 110, 100, 90, 36, [200, 205, 215]);
    // Small precise targets (for S4: nudging tiny controls in trackpad mode).
    for (let i = 0; i < 8; i++) this.fill(0, 64 + i * 20, 170, 8, 8, [210, 40, 40]);
    // Taskbar
    this.fill(0, 0, h - 40, w, 40, TASKBAR);
    this.fill(0, 8, h - 32, 24, 24, [90, 160, 250]);
    // Corner markers to check framing: red top-left, green bottom-right.
    this.fill(0, 0, 0, 16, 16, [230, 50, 50]);
    this.fill(0, w - 16, h - 16, 16, 16, [50, 200, 80]);
    // Remote cursor box (layer 1)
    this.send(['size', '1', '10', '10']);
    this.fill(1, 0, 0, 10, 10, [255, 255, 255]);
    this.fill(1, 2, 2, 6, 6, [220, 30, 120]);
    this.send(['move', '1', '0', String(Math.floor(w / 2)), String(Math.floor(h / 2)), '1']);
    this.sync();
  }

  /** A simple arrow cursor drawn in buffer -1, set with the `cursor` instruction. */
  private sendCursorImage(): void {
    const rows = [
      'X',
      'XX',
      'X.X',
      'X..X',
      'X...X',
      'X....X',
      'X.....X',
      'X......X',
      'X.......X',
      'X........X',
      'X.....XXXXX',
      'X..X..X',
      'X.X X..X',
      'XX  X..X',
      'X    X..X',
      '     XXXX',
    ];
    this.send(['size', '-1', '12', '16']);
    rows.forEach((row, y) => {
      [...row].forEach((c, x) => {
        if (c === 'X') this.fill(-1, x, y, 1, 1, [0, 0, 0]);
        else if (c === '.') this.fill(-1, x, y, 1, 1, [255, 255, 255]);
      });
    });
    this.send(['cursor', '0', '0', '-1', '0', '0', '12', '16']);
    this.sync();
  }

  private fill(
    layer: number,
    x: number,
    y: number,
    w: number,
    h: number,
    [r, g, b]: Rgb,
    mask = OVER,
  ): void {
    this.send(['rect', String(layer), String(x), String(y), String(w), String(h)]);
    this.send(['cfill', String(mask), String(layer), String(r), String(g), String(b), '255']);
  }

  protected sync(): void {
    this.send(['sync', String(++this.syncCounter)]);
  }

  protected send(instruction: string[]): void {
    this.queue.push(instruction);
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    setTimeout(() => {
      this.flushScheduled = false;
      const batch = this.queue;
      this.queue = [];
      for (const [opcode, ...args] of batch) {
        if (!this.isConnected()) return;
        if (opcode !== undefined) this.oninstruction?.(opcode, args);
      }
    }, 0);
  }

  protected record(kind: ScribbleLogEntry['kind'], text: string): void {
    this.log.push({ time: Date.now() - this.startTime, kind, text });
    if (this.log.length > 200) this.log.splice(0, this.log.length - 200);
    this.onlog?.(this.log);
  }
}
