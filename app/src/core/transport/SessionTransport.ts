import { buildTunnelUrls } from '../api/tunnel.ts';
import type { AuthSession } from '../models/AuthSession.ts';
import {
  ReplayTransport,
  type RecordedInstruction,
  type ReplayOptions,
} from './ReplayTransport.ts';
import type { TunnelConstructor, TunnelLike } from './TunnelLike.ts';

/**
 * Supplies a Guacamole tunnel for a session (SPEC §8.2). Session code creates the tunnel,
 * gives it to `new Guacamole.Client(tunnel)`, and calls
 * `client.connect(buildTunnelConnectString(...))`.
 *
 * Planned implementations behind this interface:
 * - WebSocket, from the WebView (now);
 * - replay (now);
 * - a native tunnel bridge for self-signed certificates and origin-restricted proxies
 *   (SPEC §8.3; later).
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
