/**
 * The demo "server": the counterpart of guacd for the simulated desktop. It interprets the
 * instructions `Guacamole.Client` sends and answers with drawing, stream and `sync`
 * instructions, exactly as they would arrive over a real tunnel. It has no knowledge of
 * tunnels or canvases: `DemoTunnel` carries the instructions and a `DemoRenderer` makes
 * the PNGs.
 *
 * Instruction formats follow the vendored `Client.js` handlers (server to client) and its
 * `send*` methods (client to server). See README.md for the list.
 */
import { CURSORS } from './cursors.ts';
import {
  DemoDesktop,
  clampSize,
  type CursorShape,
  type SurfaceId,
  type SurfaceState,
} from './desktop.ts';
import { intersect, isEmpty, rect, tiles, type Rect } from './geometry.ts';
import { DESKTOP_BASE_RGB, WINDOW_BASE_RGB, paintSurface } from './paintDesktop.ts';
import { base64ToBytes, bytesToBase64, chunkBase64, type Instruction } from './protocol.ts';
import type { Painter } from './painter.ts';
import type { DemoRenderer } from './renderer.ts';

/** Same shape as core's `ReplayScheduler`; the defaults work with Vitest fake timers. */
export interface DemoScheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const defaultScheduler: DemoScheduler = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface DemoServerOptions {
  readonly renderer: DemoRenderer;
  /** Initial size in pixels (clamped). Default 1280×800. */
  readonly width?: number;
  readonly height?: number;
  /** Ignore `size` requests from the client and keep the initial size. */
  readonly fixedSize?: boolean;
  /** Sent with the `name` instruction. */
  readonly name?: string;
  readonly scheduler?: DemoScheduler;
  /** Wall clock in epoch ms, for `sync` timestamps, the taskbar clock and double clicks. */
  readonly now?: () => number;
  /** Delay used to coalesce input into one frame. Default 16 ms. */
  readonly frameDelayMs?: number;
  /** Largest PNG tile side. Default 256. */
  readonly tileSize?: number;
  /** Called once if rendering fails; the server has stopped by then. */
  readonly onError?: (error: unknown) => void;
}

/** `Guacamole.Status.Code` values used here. */
export const StatusCode = { SUCCESS: 0, UNSUPPORTED: 0x0100 } as const;

/** Channel mask for `img`, `cfill` and `copy`: 0xE is source-over (`Layer.js`). */
const OVER = 0xe;
/** A hidden visible layer used as a temporary parent when restacking (see `buildFrame`). */
export const STAGING_LAYER = 99;
/** Largest clipboard text accepted from the client, in bytes. */
const MAX_CLIPBOARD_BYTES = 1 << 20;

type PendingPng = {
  readonly layer: number;
  readonly x: number;
  readonly y: number;
  readonly data: string | Promise<string>;
};
type Piece = Instruction | PendingPng;

interface SentSurface {
  readonly state: SurfaceState;
  /** Damage arrived while hidden, so repaint everything when shown. */
  readonly stale: boolean;
}

interface InboundStream {
  readonly mimetype: string;
  readonly parts: Uint8Array[];
  bytes: number;
}

function ins(opcode: string, ...args: (string | number)[]): Instruction {
  return { opcode, args: args.map(String) };
}

function int(s: string | undefined): number {
  const n = Number.parseInt(s ?? '', 10);
  return Number.isFinite(n) ? n : NaN;
}

export class DemoServer {
  readonly desktop: DemoDesktop;
  /** Receives each server-to-client instruction. */
  onInstruction: ((opcode: string, args: string[]) => void) | null = null;

  /** Timestamp of the newest `sync` the client has acknowledged, or null. */
  lastAckedSync: number | null = null;
  /** Number of frames (`sync` instructions) sent. */
  framesSent = 0;

  private readonly opts: DemoServerOptions;
  private readonly renderer: DemoRenderer;
  private readonly scheduler: DemoScheduler;
  private readonly now: () => number;
  private running = false;
  private inFlight = false;
  private again = false;
  private frameTimer: unknown = undefined;
  private clockTimer: unknown = undefined;
  private responseTimer: unknown = undefined;
  private readonly responses: Instruction[] = [];
  private readonly sent = new Map<SurfaceId, SentSurface>();
  private cursorsSent = false;
  private sentCursor: CursorShape | null = null;
  /** Window and menu surfaces, bottom first, in the DOM order last sent. */
  private sentOrder: SurfaceId[] = [];
  private lastTimestamp = 0;
  private nextStream = 0;
  private readonly inbound = new Map<number, InboundStream>();

  constructor(options: DemoServerOptions) {
    this.opts = options;
    this.renderer = options.renderer;
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.now = options.now ?? (() => Date.now());
    this.desktop = new DemoDesktop({
      width: options.width,
      height: options.height,
      measure: options.renderer.measureText,
      now: this.now(),
    });
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Sends `name` and the first full frame. Call once the tunnel is open. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.emit(ins('name', this.opts.name ?? 'Demo desktop'));
    this.sendFrame();
    this.scheduleClock();
  }

  /** Stops all timers; nothing more is sent. */
  stop(): void {
    this.running = false;
    for (const t of [this.frameTimer, this.clockTimer, this.responseTimer]) {
      if (t !== undefined) this.scheduler.clearTimeout(t);
    }
    this.frameTimer = this.clockTimer = this.responseTimer = undefined;
    this.responses.length = 0;
    this.inbound.clear();
  }

  /** Handles one client-to-server instruction. */
  receive(opcode: string, args: readonly string[]): void {
    if (!this.running) return;
    const d = this.desktop;
    switch (opcode) {
      case 'mouse': {
        const x = int(args[0]);
        const y = int(args[1]);
        const mask = int(args[2]);
        if ([x, y, mask].some(Number.isNaN)) return;
        d.pointer(x, y, mask, this.now());
        break;
      }
      case 'key': {
        const keysym = int(args[0]);
        if (Number.isNaN(keysym)) return;
        d.key(keysym, args[1] === '1');
        break;
      }
      case 'size': {
        if (this.opts.fixedSize) return;
        const { width, height } = clampSize(int(args[0]), int(args[1]));
        d.resize(width, height);
        break;
      }
      case 'sync':
        this.lastAckedSync = int(args[0]);
        return;
      case 'clipboard':
        this.openInbound(int(args[0]), args[1] ?? '');
        return;
      case 'blob':
        this.inboundBlob(int(args[0]), args[1] ?? '');
        return;
      case 'end':
        this.endInbound(int(args[0]));
        break;
      case 'file':
      case 'pipe':
      case 'audio':
      case 'argv':
      case 'put': {
        const index = int(args[opcode === 'put' ? 1 : 0]);
        if (!Number.isNaN(index)) {
          this.respond(
            ins('ack', index, 'Not supported by the demo server', StatusCode.UNSUPPORTED),
          );
        }
        return;
      }
      case 'disconnect':
        this.stop();
        return;
      default:
        // nop, ack (for our own streams), touch, get: nothing to do.
        return;
    }
    this.requestFrame();
  }

  /** Builds and sends a frame now, if one is not already being encoded. For tests. */
  flush(): void {
    if (this.frameTimer !== undefined) {
      this.scheduler.clearTimeout(this.frameTimer);
      this.frameTimer = undefined;
    }
    this.sendFrame();
  }

  // ---- Clipboard from the client ------------------------------------------------------

  private openInbound(index: number, mimetype: string): void {
    if (Number.isNaN(index)) return;
    if (!mimetype.startsWith('text/')) {
      this.respond(
        ins('ack', index, 'Only text clipboard data is supported', StatusCode.UNSUPPORTED),
      );
      return;
    }
    this.inbound.set(index, { mimetype, parts: [], bytes: 0 });
  }

  private inboundBlob(index: number, data: string): void {
    const stream = this.inbound.get(index);
    if (!stream) return;
    try {
      const bytes = base64ToBytes(data);
      if (stream.bytes + bytes.length <= MAX_CLIPBOARD_BYTES) {
        stream.parts.push(bytes);
        stream.bytes += bytes.length;
      }
    } catch {
      // Ignore undecodable data but keep acknowledging, as the client expects.
    }
    this.respond(ins('ack', index, 'OK', StatusCode.SUCCESS));
  }

  private endInbound(index: number): void {
    const stream = this.inbound.get(index);
    if (!stream) return;
    this.inbound.delete(index);
    const all = new Uint8Array(stream.bytes);
    let pos = 0;
    for (const p of stream.parts) {
      all.set(p, pos);
      pos += p.length;
    }
    this.desktop.receiveClipboard(new TextDecoder('utf-8').decode(all));
  }

  // ---- Frames -------------------------------------------------------------------------

  private requestFrame(): void {
    if (!this.running) return;
    if (this.inFlight) {
      this.again = true;
      return;
    }
    if (this.frameTimer !== undefined) return;
    this.frameTimer = this.scheduler.setTimeout(() => {
      this.frameTimer = undefined;
      this.sendFrame();
    }, this.opts.frameDelayMs ?? 16);
  }

  /** Builds a frame. Sends it synchronously when every tile is ready, else when encoded. */
  private sendFrame(): void {
    if (!this.running || this.inFlight) return;
    let pieces: Piece[];
    try {
      pieces = this.buildFrame();
    } catch (e) {
      this.fail(e);
      return;
    }
    const pending = pieces.flatMap((p, i) =>
      'data' in p && typeof p.data !== 'string' ? [i] : [],
    );
    if (pending.length === 0) {
      this.emitPieces(pieces);
      return;
    }
    this.inFlight = true;
    Promise.all(pending.map((i) => (pieces[i] as PendingPng).data)).then(
      (values) => {
        this.inFlight = false;
        pending.forEach((pi, k) => {
          pieces[pi] = { ...(pieces[pi] as PendingPng), data: values[k] as string };
        });
        this.emitPieces(pieces);
      },
      (e: unknown) => {
        this.inFlight = false;
        this.fail(e);
      },
    );
  }

  private emitPieces(pieces: readonly Piece[]): void {
    if (!this.running) return;
    for (const p of pieces) {
      if ('opcode' in p) this.emit(p);
      else this.emitImage(p, p.data as string);
    }
    if (this.again) {
      this.again = false;
      this.requestFrame();
    }
  }

  private emitImage(p: PendingPng, data: string): void {
    const index = this.allocStream();
    this.emit(ins('img', index, OVER, p.layer, 'image/png', p.x, p.y));
    for (const chunk of chunkBase64(data)) this.emit(ins('blob', index, chunk));
    this.emit(ins('end', index));
  }

  private allocStream(): number {
    const i = this.nextStream;
    this.nextStream = (this.nextStream + 1) % 1024;
    return i;
  }

  private png(layer: number, r: Rect, paint: (p: Painter) => void): PendingPng {
    return { layer, x: r.x, y: r.y, data: this.renderer.renderPng(r.x, r.y, r.w, r.h, paint) };
  }

  private buildFrame(): Piece[] {
    const d = this.desktop;
    const out: Piece[] = [];

    if (!this.cursorsSent) {
      for (const c of Object.values(CURSORS)) {
        out.push(ins('size', c.buffer, c.w, c.h));
        out.push(this.png(c.buffer, rect(0, 0, c.w, c.h), (p) => c.paint(p)));
      }
      this.cursorsSent = true;
    }
    if (d.cursor !== this.sentCursor) {
      const c = CURSORS[d.cursor];
      out.push(ins('cursor', c.hotX, c.hotY, c.buffer, 0, 0, c.w, c.h));
      this.sentCursor = d.cursor;
    }

    const damage = d.takeDamage();
    const tileSize = this.opts.tileSize ?? 256;
    const surfaces = d.surfaces();

    // Stacking. Every layer is sent with z = 0 and stacked by DOM order instead: a CSS
    // z-index on window layers would lift them above the Display's own cursor layer, which
    // trackpad mode relies on. `VisibleLayer.move` re-appends a layer's element only when its
    // parent changes, so a layer is raised by moving it to a hidden staging layer and back.
    const order = surfaces
      .filter((s) => s.layer > 0)
      .sort((a, b) => a.z - b.z)
      .map((s) => s.id);
    let firstDiff = order.findIndex((id, i) => this.sentOrder[i] !== id);
    if (firstDiff < 0 && this.sentOrder.length !== order.length) firstDiff = order.length;
    const restack = new Set(firstDiff < 0 ? [] : order.slice(firstDiff));
    if (this.sentOrder.length === 0) {
      out.push(ins('size', STAGING_LAYER, 1, 1));
      out.push(ins('shade', STAGING_LAYER, 0));
    }

    for (const s of surfaces) {
      const prev = this.sent.get(s.id);
      const resized = !prev || prev.state.w !== s.w || prev.state.h !== s.h;
      if (resized) {
        const [r, g, b] = s.layer === 0 ? DESKTOP_BASE_RGB : WINDOW_BASE_RGB;
        out.push(ins('size', s.layer, s.w, s.h));
        out.push(ins('rect', s.layer, 0, 0, s.w, s.h));
        out.push(ins('cfill', OVER, s.layer, r, g, b, 255));
      }
      if (
        s.layer > 0 &&
        !restack.has(s.id) &&
        (!prev || prev.state.x !== s.x || prev.state.y !== s.y)
      ) {
        out.push(ins('move', s.layer, 0, s.x, s.y, 0));
      }
      if (prev ? prev.state.visible !== s.visible : !s.visible) {
        out.push(ins('shade', s.layer, s.visible ? 255 : 0));
      }

      const bounds = rect(0, 0, s.w, s.h);
      const rects = damage.rects.get(s.id) ?? [];
      let stale = resized || (prev?.stale ?? false);
      if (!s.visible) {
        this.sent.set(s.id, { state: s, stale: stale || rects.length > 0 });
        continue;
      }
      let paint: Rect[];
      if (stale) {
        paint = [bounds];
      } else {
        for (const c of damage.copies) {
          if (c.surface !== s.id) continue;
          const v = c.rect;
          const dy = c.dy;
          // Content moves by dy: copy the part that stays visible to its new place.
          const src = dy < 0 ? rect(v.x, v.y - dy, v.w, v.h + dy) : rect(v.x, v.y, v.w, v.h - dy);
          const dstY = dy < 0 ? v.y : v.y + dy;
          out.push(ins('copy', s.layer, src.x, src.y, src.w, src.h, OVER, s.layer, src.x, dstY));
        }
        paint = rects.map((r) => intersect(r, bounds)).filter((r) => !isEmpty(r));
      }
      stale = false;
      for (const r of paint) {
        for (const t of tiles(r, tileSize)) {
          out.push(this.png(s.layer, t, (p) => paintSurface(d, s.id, p)));
        }
      }
      this.sent.set(s.id, { state: s, stale });
    }

    for (const id of order) {
      if (!restack.has(id)) continue;
      const s = surfaces.find((x) => x.id === id) as SurfaceState;
      out.push(ins('move', s.layer, STAGING_LAYER, 0, 0, 0));
      out.push(ins('move', s.layer, 0, s.x, s.y, 0));
    }
    this.sentOrder = order;

    const clip = d.takeClipboard();
    if (clip !== null) {
      const index = this.allocStream();
      out.push(ins('clipboard', index, 'text/plain'));
      const b64 = bytesToBase64(new TextEncoder().encode(clip));
      if (b64) for (const chunk of chunkBase64(b64)) out.push(ins('blob', index, chunk));
      out.push(ins('end', index));
    }

    out.push(ins('sync', this.timestamp()));
    this.framesSent++;
    return out;
  }

  private timestamp(): number {
    this.lastTimestamp = Math.max(Math.floor(this.now()), this.lastTimestamp + 1);
    return this.lastTimestamp;
  }

  // ---- Timers and output --------------------------------------------------------------

  private scheduleClock(): void {
    if (!this.running) return;
    const delay = 1000 - (this.now() % 1000) + 5;
    this.clockTimer = this.scheduler.setTimeout(() => {
      this.clockTimer = undefined;
      if (this.desktop.tick(this.now())) this.requestFrame();
      this.scheduleClock();
    }, delay);
  }

  /** Queues a reply. Replies are delivered asynchronously, never inside `sendMessage`. */
  private respond(i: Instruction): void {
    this.responses.push(i);
    if (this.responseTimer !== undefined) return;
    this.responseTimer = this.scheduler.setTimeout(() => {
      this.responseTimer = undefined;
      for (const r of this.responses.splice(0)) this.emit(r);
    }, 0);
  }

  private emit(i: Instruction): void {
    if (this.running) this.onInstruction?.(i.opcode, [...i.args]);
  }

  private fail(error: unknown): void {
    this.stop();
    this.opts.onError?.(error);
  }
}
