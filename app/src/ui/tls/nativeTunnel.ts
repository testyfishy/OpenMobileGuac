import {
  NativeSocketHub,
  type GuacamoleProtocolDeps,
} from '../../core/transport/NativeBridgeTunnel.ts';
import {
  createPinAwareTransport,
  type SessionTransport,
} from '../../core/transport/SessionTransport.ts';
import type { TlsTrustService } from '../../core/tls/TlsTrustService.ts';
import Guacamole from '../../vendor/guacamole-common-js/index.js';

/** The parts of the vendored library the native tunnel reuses (unmodified). */
export const guacamoleProtocolDeps: GuacamoleProtocolDeps = {
  createParser: () => new Guacamole.Parser(),
  toInstruction: (elements) => Guacamole.Parser.toInstruction([...elements]),
  fromWebSocketCode: (code) => Guacamole.Status.Code.fromWebSocketCode(code),
  makeStatus: (code, message) => new Guacamole.Status(code, message),
};

const hubs = new WeakMap<object, NativeSocketHub>();

/**
 * The session transport for the app (SRV-8): the WebView `WebSocketTunnel`, except for a
 * server with a pinned certificate on a native build, which gets the native tunnel.
 */
export function sessionTransportFor(tls: TlsTrustService): SessionTransport {
  const plugin = tls.nativePlugin;
  if (!plugin) return createPinAwareTransport(Guacamole.WebSocketTunnel, undefined);
  let hub = hubs.get(plugin);
  if (!hub) {
    hub = new NativeSocketHub(plugin);
    hubs.set(plugin, hub);
  }
  return createPinAwareTransport(Guacamole.WebSocketTunnel, {
    hub,
    deps: guacamoleProtocolDeps,
    pinsFor: (url) => tls.pinsForSync(url),
  });
}
