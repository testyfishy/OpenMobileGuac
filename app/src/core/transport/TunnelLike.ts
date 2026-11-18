/**
 * A structural mirror of `Guacamole.Tunnel` from guacamole-common-js 1.6.0
 * (`guacamole-common-js/src/main/webapp/modules/Tunnel.js`). It lets core describe and
 * implement tunnels without importing the vendored library. Any upstream tunnel
 * (`WebSocketTunnel`, `HTTPTunnel`, `ChainedTunnel`) has this shape, and anything with this
 * shape can be handed to `Guacamole.Client`.
 * See docs/protocol-notes.md §3.3.
 */

/** `Guacamole.Tunnel.State`. */
export const TunnelState = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSED: 2,
  UNSTABLE: 3,
} as const;

export type TunnelStateValue = (typeof TunnelState)[keyof typeof TunnelState];

/** `Guacamole.Tunnel.INTERNAL_DATA_OPCODE`. */
export const INTERNAL_DATA_OPCODE = '';

/**
 * Mirrors `Guacamole.Status` (`Status.js`). The shape is kept identical so that `TunnelLike`
 * and the library's `Tunnel` are assignable in both directions.
 */
export interface StatusLike {
  code: number;
  message: string | undefined;
  isError(): boolean;
}

/** Creates a `StatusLike`. Codes are `Guacamole.Status.Code` values; below 0x0100 is success. */
export function makeStatus(code: number, message?: string): StatusLike {
  return { code, message, isError: () => code < 0 || code > 0x00ff };
}

export interface TunnelLike {
  /** One of `TunnelState`. Starts as `CLOSED`. */
  state: number;
  /** Tunnel UUID once known, else `null`. */
  uuid: string | null;
  /** Milliseconds without data before the tunnel closes with an error. Default 15000. */
  receiveTimeout: number;
  /** Milliseconds without data before the state becomes `UNSTABLE`. Default 1500. */
  unstableThreshold: number;

  onuuid: ((uuid: string) => void) | null;
  onerror: ((status: StatusLike) => void) | null;
  onstatechange: ((state: number) => void) | null;
  oninstruction: ((opcode: string, args: string[]) => void) | null;

  /** Connects, passing `data` (the tunnel connect string, see `api/tunnel.ts`). */
  connect(data?: string): void;
  disconnect(): void;
  /** Sends one instruction: `elements[0]` is the opcode, the rest are arguments. */
  sendMessage(...elements: unknown[]): void;
  /** True when the state is `OPEN` or `UNSTABLE`. */
  isConnected(): boolean;
  setState(state: number): void;
  setUUID(uuid: string): void;
}

/** A constructor with the same signature as `Guacamole.WebSocketTunnel(tunnelURL)`. */
export type TunnelConstructor = new (tunnelURL: string) => TunnelLike;
