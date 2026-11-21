import type { PluginListenerHandle } from '@capacitor/core';
import { logNativeSocketClose } from '../diagnostics/webSocketDiagnostics.ts';
import type { NativeSocketEvent, PinnedTlsPlugin } from '../tls/plugin.ts';
import {
  INTERNAL_DATA_OPCODE,
  TunnelState,
  type StatusLike,
  type TunnelLike,
} from './TunnelLike.ts';

/**
 * Pieces of guacamole-common-js the tunnel reuses, injected so core does not import the
 * vendored library (the UI passes `Guacamole.Parser`, `Guacamole.Parser.toInstruction`,
 * `Guacamole.Status.Code.fromWebSocketCode` and `new Guacamole.Status`).
 */
export interface GuacamoleProtocolDeps {
  readonly createParser: () => {
    oninstruction: ((opcode: string, args: string[]) => void) | null;
    receive(data: string): void;
  };
  readonly toInstruction: (elements: readonly unknown[]) => string;
  readonly fromWebSocketCode: (code: number) => number;
  readonly makeStatus: (code: number, message?: string) => StatusLike;
}

/** `Guacamole.Status.Code` values used here (`Status.js`). */
const Code = {
  SUCCESS: 0x0000,
  SERVER_ERROR: 0x0200,
  UPSTREAM_TIMEOUT: 0x0202,
  UPSTREAM_NOT_FOUND: 0x0207,
} as const;

/** Same as `WebSocketTunnel`'s `PING_FREQUENCY`. */
const PING_FREQUENCY = 500;

/**
 * One listener on the plugin's `socket` event, dispatching by socket id. Each `messages`
 * event is acknowledged after its handler ran, which lets native code send the next batch
 * (and resume reading from the network if it had paused).
 */
export class NativeSocketHub {
  private readonly plugin: PinnedTlsPlugin;
  private readonly handlers = new Map<string, (event: NativeSocketEvent) => void>();
  private listening: Promise<PluginListenerHandle> | undefined;
  private counter = 0;

  constructor(plugin: PinnedTlsPlugin) {
    this.plugin = plugin;
  }

  get native(): PinnedTlsPlugin {
    return this.plugin;
  }

  newId(): string {
    this.counter += 1;
    const random = globalThis.crypto?.randomUUID?.() ?? String(Math.random()).slice(2);
    return `t${this.counter}-${random}`;
  }

  /** Registers `handler` for `id` and makes sure the plugin listener is attached first. */
  async attach(id: string, handler: (event: NativeSocketEvent) => void): Promise<void> {
    this.handlers.set(id, handler);
    if (!this.listening) {
      const listening = this.plugin.addListener('socket', (e) => this.dispatch(e));
      this.listening = listening;
      listening.catch(() => {
        if (this.listening === listening) this.listening = undefined;
      });
    }
    await this.listening;
  }

  detach(id: string): void {
    this.handlers.delete(id);
  }

  private dispatch(event: NativeSocketEvent): void {
    const handler = this.handlers.get(event.id);
    if (event.type === 'close') {
      this.handlers.delete(event.id);
      logNativeSocketClose(event);
    }
    try {
      handler?.(event);
    } finally {
      // Always acknowledge, even for a socket nobody listens to any more, so native code
      // never waits for an ack that will not come.
      if (event.type === 'messages') void this.plugin.ack({ id: event.id }).catch(() => undefined);
    }
  }
}

export interface NativeBridgeTunnelOptions {
  readonly hub: NativeSocketHub;
  readonly deps: GuacamoleProtocolDeps;
  /** Absolute `wss://…/websocket-tunnel` URL. */
  readonly url: string;
  /** Trusted fingerprints for the URL's origin. Must not be empty. */
  readonly pins: readonly string[];
  /** Native connect timeout (the receive timeout still applies on top). Default 15 s. */
  readonly connectTimeoutMs?: number;
}

/**
 * A `Guacamole.Tunnel` over the native `PinnedTls` WebSocket (SRV-8). It mirrors the
 * vendored `Guacamole.WebSocketTunnel` 1.6.0 (`Tunnel.js` 742-1035): the same states,
 * receive/unstable timers, 500 ms internal ping, UUID-on-first-instruction, close-reason
 * mapping (docs/protocol-notes.md §3.6), and `sendMessage` dropping while not connected.
 * Differences, all internal:
 * - frames cross the Capacitor bridge in batches (one event per batch inbound, one call per
 *   batch outbound), each instruction is still its own WebSocket frame on the wire;
 * - a native failure (certificate changed, handshake, network) always closes with an error
 *   status, never a clean one, and is exposed as `failure` for the UI.
 */
export class NativeBridgeTunnel implements TunnelLike {
  state: number = TunnelState.CLOSED;
  uuid: string | null = null;
  receiveTimeout = 15000;
  unstableThreshold = 1500;

  onuuid: ((uuid: string) => void) | null = null;
  onerror: ((status: StatusLike) => void) | null = null;
  onstatechange: ((state: number) => void) | null = null;
  oninstruction: ((opcode: string, args: string[]) => void) | null = null;

  /** Why the native socket failed, if it did (e.g. `PIN_MISMATCH`). */
  failure: string | undefined = undefined;

  private readonly hub: NativeSocketHub;
  private readonly deps: GuacamoleProtocolDeps;
  private readonly url: string;
  private readonly pins: readonly string[];
  private readonly connectTimeoutMs: number;

  private socketId: string | undefined;
  private receiveTimer: ReturnType<typeof setTimeout> | undefined;
  private unstableTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setTimeout> | undefined;
  private lastSentPing = 0;
  private outbox: string[] = [];
  private sending = false;

  constructor(options: NativeBridgeTunnelOptions) {
    if (options.pins.length === 0) throw new Error('NativeBridgeTunnel needs a pin');
    this.hub = options.hub;
    this.deps = options.deps;
    this.url = options.url;
    this.pins = options.pins;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 15000;
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

  sendMessage(...elements: unknown[]): void {
    if (!this.isConnected() || elements.length === 0 || this.socketId === undefined) return;
    this.outbox.push(this.deps.toInstruction(elements));
    this.flushOutbox();
  }

  connect(data?: string): void {
    this.resetTimers();
    this.setState(TunnelState.CONNECTING);
    this.failure = undefined;
    this.outbox = [];
    this.sending = false;

    const parser = this.deps.createParser();
    parser.oninstruction = (opcode, args) => {
      if (this.uuid === null) {
        if (opcode === INTERNAL_DATA_OPCODE && args.length === 1) this.setUUID(args[0] ?? '');
        this.setState(TunnelState.OPEN);
      }
      if (opcode !== INTERNAL_DATA_OPCODE) this.oninstruction?.(opcode, args);
    };

    const previous = this.socketId;
    if (previous !== undefined) {
      this.hub.detach(previous);
      void this.hub.native
        .closeSocket({ id: previous, code: 1000, reason: '' })
        .catch(() => undefined);
    }
    const id = this.hub.newId();
    this.socketId = id;
    const live = () => this.socketId === id;
    const url = this.url + '?' + (data ?? '');

    void this.hub
      .attach(id, (event) => {
        if (!live()) return;
        switch (event.type) {
          case 'open':
            this.resetTimers();
            return;
          case 'messages':
            this.resetTimers();
            for (const message of event.messages) {
              if (!live()) return;
              try {
                parser.receive(message);
              } catch (e) {
                this.closeTunnel(
                  this.deps.makeStatus(Code.SERVER_ERROR, e instanceof Error ? e.message : ''),
                );
                return;
              }
            }
            return;
          case 'close':
            this.onSocketClosed(event);
            return;
        }
      })
      .then(() => {
        if (!live()) return undefined;
        return this.hub.native.openSocket({
          id,
          url,
          protocols: ['guacamole'],
          pins: [...this.pins],
          timeoutMs: this.connectTimeoutMs,
        });
      })
      .catch(() => {
        if (!live()) return;
        this.failure = 'UNREACHABLE';
        this.closeTunnel(this.deps.makeStatus(Code.UPSTREAM_NOT_FOUND));
      });
  }

  disconnect(): void {
    this.closeTunnel(this.deps.makeStatus(Code.SUCCESS, 'Manually closed.'));
  }

  private onSocketClosed(event: Extract<NativeSocketEvent, { type: 'close' }>): void {
    if (event.error) {
      // A failed connection is never a clean close (AUDIT #7), whatever code came with it.
      this.failure = event.error;
      this.closeTunnel(this.deps.makeStatus(Code.UPSTREAM_NOT_FOUND, event.error));
      return;
    }
    // Same order as WebSocketTunnel's socket.onclose.
    if (event.reason) {
      this.closeTunnel(this.deps.makeStatus(parseInt(event.reason), event.reason));
    } else if (event.code) {
      this.closeTunnel(this.deps.makeStatus(this.deps.fromWebSocketCode(event.code)));
    } else {
      this.closeTunnel(this.deps.makeStatus(Code.UPSTREAM_NOT_FOUND));
    }
  }

  private closeTunnel(status: StatusLike): void {
    this.clearTimers();
    if (this.state === TunnelState.CLOSED) return;
    if (status.code !== Code.SUCCESS) this.onerror?.(status);
    this.setState(TunnelState.CLOSED);
    const id = this.socketId;
    this.socketId = undefined;
    this.outbox = [];
    if (id !== undefined) {
      this.hub.detach(id);
      void this.hub.native.closeSocket({ id, code: 1000, reason: '' }).catch(() => undefined);
    }
  }

  private flushOutbox(): void {
    const id = this.socketId;
    if (this.sending || this.outbox.length === 0 || id === undefined) return;
    this.sending = true;
    // Let the rest of this tick's instructions join the batch.
    queueMicrotask(() => {
      const messages = this.outbox;
      this.outbox = [];
      if (this.socketId !== id || messages.length === 0) {
        this.sending = false;
        return;
      }
      void this.hub.native
        .send({ id, messages })
        .catch(() => undefined) // a broken socket reports itself with a close event
        .finally(() => {
          if (this.socketId !== id) return;
          this.sending = false;
          this.flushOutbox();
        });
    });
  }

  private clearTimers(): void {
    clearTimeout(this.receiveTimer);
    clearTimeout(this.unstableTimer);
    clearTimeout(this.pingTimer);
  }

  private resetTimers(): void {
    this.clearTimers();
    if (this.state === TunnelState.UNSTABLE) this.setState(TunnelState.OPEN);
    this.receiveTimer = setTimeout(() => {
      this.closeTunnel(this.deps.makeStatus(Code.UPSTREAM_TIMEOUT, 'Server timeout.'));
    }, this.receiveTimeout);
    this.unstableTimer = setTimeout(() => {
      this.setState(TunnelState.UNSTABLE);
    }, this.unstableThreshold);
    const now = Date.now();
    const pingDelay = Math.max(this.lastSentPing + PING_FREQUENCY - now, 0);
    if (pingDelay > 0) this.pingTimer = setTimeout(() => this.sendPing(), pingDelay);
    else this.sendPing();
  }

  private sendPing(): void {
    const now = Date.now();
    // Through `this.sendMessage`, like upstream, so a wrapper (traffic counter) sees it.
    this.sendMessage(INTERNAL_DATA_OPCODE, 'ping', now);
    this.lastSentPing = now;
  }
}
