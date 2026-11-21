import { buildTunnelUrls } from '../api/tunnel.ts';
import type { AuthSession } from '../models/AuthSession.ts';
import {
  ReplayTransport,
  type RecordedInstruction,
  type ReplayOptions,
} from './ReplayTransport.ts';
import type { TunnelConstructor, TunnelLike } from './TunnelLike.ts';
import {
  NativeBridgeTunnel,
  type GuacamoleProtocolDeps,
  type NativeSocketHub,
} from './NativeBridgeTunnel.ts';

/**
 * Supplies a Guacamole tunnel for a session (SPEC §8.2). Session code creates the tunnel,
 * gives it to `new Guacamole.Client(tunnel)`, and calls
 * `client.connect(buildTunnelConnectString(...))`.
 *
 * Planned implementations behind this interface:
 * - WebSocket, from the WebView (now);
 * - replay (now);
 * - a native tunnel bridge for servers with a pinned self-signed certificate
 *   (`createPinAwareTransport`, SRV-8, docs/tls.md).
 */
export interface SessionTransport {
  readonly kind: 'websocket' | 'replay' | 'native-bridge';
  /** Returns a new, unconnected tunnel for the session's server. */
  createTunnel(session: Pick<AuthSession, 'baseUrl'>): TunnelLike;
}

/**
 * A WebSocket transport. `Tunnel` is injected, normally `Guacamole.WebSocketTunnel` from the
 * vendored library, so that core does not import the vendor directory. The tunnel gets the
 * absolute `ws(s)://<base>/websocket-tunnel` URL (see `buildTunnelUrls` for why it must be
 * absolute).
 */
export function createWebSocketTransport(Tunnel: TunnelConstructor): SessionTransport {
  return {
    kind: 'websocket',
    createTunnel(session) {
      return new Tunnel(buildTunnelUrls(session.baseUrl).websocket);
    },
  };
}

/** What `createPinAwareTransport` needs to pick the native tunnel for pinned servers. */
export interface PinnedTunnelSupport {
  readonly hub: NativeSocketHub;
  readonly deps: GuacamoleProtocolDeps;
  /** Trusted fingerprints for a URL's origin (synchronous; empty when none). */
  pinsFor(url: string): readonly string[];
}

/**
 * SRV-8: the WebSocket transport, except that a server whose certificate the user pinned
 * gets a `NativeBridgeTunnel` (the WebView cannot be told to trust one certificate). With
 * `pinned` undefined (web, or the plugin missing) this is exactly `createWebSocketTransport`.
 */
export function createPinAwareTransport(
  Tunnel: TunnelConstructor,
  pinned: PinnedTunnelSupport | undefined,
): SessionTransport {
  const websocket = createWebSocketTransport(Tunnel);
  if (!pinned) return websocket;
  return {
    kind: 'native-bridge',
    createTunnel(session) {
      const url = buildTunnelUrls(session.baseUrl).websocket;
      const pins = pinned.pinsFor(url);
      if (pins.length === 0) return websocket.createTunnel(session);
      return new NativeBridgeTunnel({ hub: pinned.hub, deps: pinned.deps, url, pins });
    },
  };
}

/** A transport whose tunnels replay `recording`. Each call returns a fresh `ReplayTransport`. */
export function createReplaySessionTransport(
  recording: readonly RecordedInstruction[],
  options?: ReplayOptions,
): SessionTransport & { readonly created: ReplayTransport[] } {
  const created: ReplayTransport[] = [];
  return {
    kind: 'replay',
    created,
    createTunnel() {
      const tunnel = new ReplayTransport(recording, options);
      created.push(tunnel);
      return tunnel;
    },
  };
}
