import type { SessionTransport } from '../core/transport/SessionTransport.ts';
import {
  TunnelState,
  makeStatus,
  type StatusLike,
  type TunnelLike,
} from '../core/transport/TunnelLike.ts';
import { createCanvasRenderer } from './canvasRenderer.ts';
import { demoVariant } from './profile.ts';
import { WireParser, encodeInstruction } from './protocol.ts';
import type { DemoRenderer } from './renderer.ts';
import { DemoServer, defaultScheduler, type DemoScheduler } from './server.ts';

export interface DemoTunnelOptions {
  /** A renderer, or a factory called on connect. Default: `createCanvasRenderer`. */
  readonly renderer?: DemoRenderer | (() => DemoRenderer);
  readonly scheduler?: DemoScheduler;
  readonly now?: () => number;
  /** Reported through `onuuid`. Default: `demo-` plus a random suffix. */
  readonly uuid?: string;
  /** Size used when the connect string has no `GUAC_WIDTH`/`GUAC_HEIGHT`. */
  readonly width?: number;
  readonly height?: number;
  /**
   * Serialise every instruction to wire format and parse it back, in both directions, as a
   * network tunnel would. Default true; it guarantees the demo only uses valid encodings.
   */
  readonly wire?: boolean;
  readonly frameDelayMs?: number;
  readonly tileSize?: number;
}

/** `Guacamole.Status.Code.SERVER_ERROR`. */
const SERVER_ERROR = 0x0200;

function randomSuffix(): string {
  return Math.floor(Math.random() * 0x100000000)
    .toString(16)
    .padStart(8, '0');
}

/**
 * A `TunnelLike` whose far end is the in-app demo desktop, so
 * `new Guacamole.Client(new DemoTunnel())` behaves like a real connection.
 *
 * Timeline after `connect(data)`, matching `ReplayTransport` and `WebSocketTunnel`:
 * 1. The state becomes `CONNECTING` synchronously. Nothing else happens inside `connect`,
 *    because `Client.connect` only enters `WAITING` after `tunnel.connect` returns, and the
 *    first `sync` is what moves it on to `CONNECTED`.
 * 2. After 0 ms, `onuuid` fires, the state becomes `OPEN`, and the server sends `name`,
 *    the cursor, the layers and the first frame ending in `sync`.
 *
 * `data` is the usual connect string; `GUAC_WIDTH`, `GUAC_HEIGHT` and `GUAC_ID` are read
 * (see `profile.ts` for the IDs). Messages sent while not connected are dropped, as upstream.
 */
export class DemoTunnel implements TunnelLike {
  state: number = TunnelState.CLOSED;
  uuid: string | null = null;
  receiveTimeout = 15000;
  unstableThreshold = 1500;

  onuuid: ((uuid: string) => void) | null = null;
  onerror: ((status: StatusLike) => void) | null = null;
  onstatechange: ((state: number) => void) | null = null;
  oninstruction: ((opcode: string, args: string[]) => void) | null = null;

  /** The running server, once open. */
  server: DemoServer | null = null;

  private readonly options: DemoTunnelOptions;
  private readonly scheduler: DemoScheduler;
  private openTimer: unknown = undefined;
  private toClient = new WireParser();
  private toServer = new WireParser();

  constructor(options: DemoTunnelOptions = {}) {
    this.options = options;
    this.scheduler = options.scheduler ?? defaultScheduler;
  }

  connect(data?: string): void {
    this.teardown();
    this.uuid = null;
    this.toClient = new WireParser();
    this.toServer = new WireParser();
    const params = new URLSearchParams(data ?? '');
    const variant = demoVariant(params.get('GUAC_ID'));
    const reqW = Number(params.get('GUAC_WIDTH') ?? NaN);
    const reqH = Number(params.get('GUAC_HEIGHT') ?? NaN);
    this.setState(TunnelState.CONNECTING);

    this.openTimer = this.scheduler.setTimeout(() => {
      this.openTimer = undefined;
      let server: DemoServer;
      try {
        const r = this.options.renderer ?? createCanvasRenderer;
        server = new DemoServer({
          renderer: typeof r === 'function' ? r() : r,
          width: variant.fixed?.width ?? (reqW > 0 ? reqW : this.options.width),
          height: variant.fixed?.height ?? (reqH > 0 ? reqH : this.options.height),
          fixedSize: variant.fixed !== undefined,
          name: variant.name,
          scheduler: this.scheduler,
          now: this.options.now,
          frameDelayMs: this.options.frameDelayMs,
          tileSize: this.options.tileSize,
          onError: (e) => this.fail(e),
        });
      } catch (e) {
        this.fail(e);
        return;
      }
      server.onInstruction = (opcode, args) => this.deliver(opcode, args);
      this.server = server;
      this.setUUID(this.options.uuid ?? `demo-${randomSuffix()}`);
      this.setState(TunnelState.OPEN);
      server.start();
    }, 0);
  }

  disconnect(): void {
    this.teardown();
    this.setState(TunnelState.CLOSED);
  }

  sendMessage(...elements: unknown[]): void {
    if (!this.isConnected() || elements.length === 0 || !this.server) return;
    const [opcode = '', ...args] = elements.map(String);
    if (this.options.wire ?? true) {
      for (const i of this.toServer.receive(encodeInstruction(opcode, args))) {
        this.toServerInstruction(i.opcode, [...i.args]);
      }
    } else {
      this.toServerInstruction(opcode, args);
    }
  }

  isConnected(): boolean {
    return this.state === TunnelState.OPEN || this.state === TunnelState.UNSTABLE;
  }

  setState(state: number): void {
    if (state !== this.state) {
      this.state = state;
      this.onstatechange?.(state);
    }
  }

  setUUID(uuid: string): void {
    this.uuid = uuid;
    this.onuuid?.(uuid);
  }

  private toServerInstruction(opcode: string, args: string[]): void {
    // The internal opcode carries tunnel pings; there is no network to keep alive.
    if (opcode === '') return;
    this.server?.receive(opcode, args);
    if (opcode === 'disconnect') {
      // guacd closes the connection after `disconnect`.
      this.teardown();
      this.setState(TunnelState.CLOSED);
    }
  }

  private deliver(opcode: string, args: string[]): void {
    if (!this.isConnected()) return;
    if (this.options.wire ?? true) {
      for (const i of this.toClient.receive(encodeInstruction(opcode, args))) {
        this.oninstruction?.(i.opcode, [...i.args]);
      }
    } else {
      this.oninstruction?.(opcode, args);
    }
  }

  private fail(error: unknown): void {
    this.teardown();
    const message = error instanceof Error ? error.message : String(error);
    this.onerror?.(makeStatus(SERVER_ERROR, `Demo server error: ${message}`));
    this.setState(TunnelState.CLOSED);
  }

  private teardown(): void {
    if (this.openTimer !== undefined) {
      this.scheduler.clearTimeout(this.openTimer);
      this.openTimer = undefined;
    }
    this.server?.stop();
    this.server = null;
  }
}

/**
 * A `SessionTransport` whose tunnels are `DemoTunnel`s. Core's `kind` union has no demo
 * member, so it reports `'replay'` (a local, server-less transport) and adds `demo: true`.
 */
export function createDemoSessionTransport(
  options: DemoTunnelOptions = {},
): SessionTransport & { readonly demo: true } {
  return {
    kind: 'replay',
    demo: true,
    createTunnel() {
      return new DemoTunnel(options);
    },
  };
}
