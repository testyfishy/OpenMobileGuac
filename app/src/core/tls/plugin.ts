import type { PluginListenerHandle } from '@capacitor/core';

/**
 * The JavaScript face of the app's own native plugin `PinnedTls` (SRV-8, docs/tls.md),
 * source in `app/plugins/omg-pinned-tls`. It is used **only** for servers whose
 * certificate the user pinned; everything else keeps the WebView and `CapacitorHttp`.
 *
 * Native code accepts a TLS connection only when the SHA-256 of the leaf certificate's DER
 * is one of `pins` (host-name and chain checks are replaced by that exact match; JS binds
 * the pins to one scheme/host/port). It never follows redirects. Without pins it refuses.
 */

/** Machine-readable failure codes (`err.code` on rejections, `error` on close events). */
export type NativeTlsErrorCode =
  | 'PIN_MISMATCH' // the server presented another certificate; `der` carries it
  | 'TLS' // handshake failed for another reason
  | 'TIMEOUT'
  | 'UNREACHABLE'
  | 'BAD_REQUEST'; // invalid arguments (a bug in the caller)

export interface NativeTlsRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  /** Pre-encoded body; its `Content-Type` is in `headers`. */
  readonly data?: string;
  readonly timeoutMs: number;
  /** Fingerprints (64 lower-case hex digits). Must not be empty. */
  readonly pins: readonly string[];
}

export interface NativeTlsResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  /** Body as UTF-8 text ('' when empty). */
  readonly data: string;
}

export interface NativeSocketOpen {
  /** Chosen by JS, unique per socket. Every event carries it. */
  readonly id: string;
  /** `wss://…` */
  readonly url: string;
  readonly protocols: readonly string[];
  readonly pins: readonly string[];
  readonly timeoutMs: number;
}

/**
 * Events on the `socket` listener, in order per socket.
 * - `messages`: received text frames (binary frames are decoded as UTF-8; Guacamole sends
 *   text only). Native sends no further `messages` for that socket until JS calls `ack`,
 *   and stops reading from the network while too much is waiting (backpressure).
 * - `close`: always the last event. `error` is set when the connection failed rather than
 *   being closed by either side; such a close is never reported with code 1000.
 */
export type NativeSocketEvent =
  | { readonly id: string; readonly type: 'open'; readonly protocol?: string }
  | { readonly id: string; readonly type: 'messages'; readonly messages: readonly string[] }
  | {
      readonly id: string;
      readonly type: 'close';
      readonly code: number;
      readonly reason: string;
      readonly error?: NativeTlsErrorCode;
      /** With `PIN_MISMATCH`: the presented leaf certificate, base64 DER. */
      readonly der?: string;
    };

export interface PinnedTlsPlugin {
  /**
   * Connects to the URL's host and port, completes as much of a TLS handshake as needed to
   * read the server's leaf certificate, and aborts the handshake. No HTTP request and no
   * application data is ever sent. Resolves with the certificate as base64 DER.
   */
  inspect(options: { url: string; timeoutMs: number }): Promise<{ der: string }>;
  request(options: NativeTlsRequest): Promise<NativeTlsResponse>;
  openSocket(options: NativeSocketOpen): Promise<void>;
  /** Sends each message as its own text frame, in order. */
  send(options: { id: string; messages: readonly string[] }): Promise<void>;
  /** The last `messages` event for this socket has been processed. */
  ack(options: { id: string }): Promise<void>;
  closeSocket(options: { id: string; code: number; reason: string }): Promise<void>;
  addListener(
    eventName: 'socket',
    listener: (event: NativeSocketEvent) => void,
  ): Promise<PluginListenerHandle>;
}

/** Error code of a plugin rejection, if it is one of ours. */
export function nativeErrorCode(err: unknown): NativeTlsErrorCode | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  switch (code) {
    case 'PIN_MISMATCH':
    case 'TLS':
    case 'TIMEOUT':
    case 'UNREACHABLE':
    case 'BAD_REQUEST':
      return code;
    default:
      return undefined;
  }
}

/** The presented certificate (base64 DER) attached to a `PIN_MISMATCH` rejection. */
export function nativeErrorDer(err: unknown): string | undefined {
  const data = (err as { data?: unknown } | null)?.data;
  const der = (data as { der?: unknown } | null | undefined)?.der;
  return typeof der === 'string' && der.length > 0 ? der : undefined;
}
