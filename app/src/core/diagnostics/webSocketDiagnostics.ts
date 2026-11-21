import type { Logger } from './log.ts';

/**
 * DIAG-1: logs how each WebView WebSocket ended (code, reason, clean or not, how long it was
 * open), so a device log can tell a network drop (1006, no reason) from a server close
 * (a Guacamole status code as the reason) or a proxy timeout. guacamole-common-js maps the
 * close to a status itself (1006 becomes 0x0207) and drops the code.
 *
 * Never logs the URL: the tunnel URL's query carries the auth token. The reason is the
 * server's text, cut short and limited to printable characters.
 */

interface CloseLike {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;
}

type Listener = (type: string, fn: (e: never) => void) => void;

interface SocketLike {
  addEventListener: Listener;
}

type SocketCtor = new (url: string | URL, protocols?: string | string[]) => SocketLike;

/** One log line for a close event. */
export function describeClose(e: CloseLike, openMs: number | null, lifetimeMs: number): string {
  const reason = e.reason.replace(/[^\x20-\x7e]/g, '?').slice(0, 64);
  const how = e.wasClean ? 'clean' : 'not clean';
  const life =
    openMs === null
      ? `never opened (${lifetimeMs} ms)`
      : `open ${Math.round((lifetimeMs - openMs) / 100) / 10} s`;
  return `WebSocket closed: code ${e.code}${reason ? `, reason "${reason}"` : ''}, ${how}, ${life}`;
}

/**
 * Replaces `target.WebSocket` with a subclass that logs open and close. Idempotent. The
 * subclass behaves exactly like the original (same constructor arguments, constants and
 * prototype chain); it only adds listeners.
 */
export function instrumentWebSockets(
  target: { WebSocket?: unknown },
  log: Pick<Logger, 'debug' | 'info' | 'warn'>,
  now: () => number = () => Date.now(),
): void {
  nativeLog = log;
  const Base = target.WebSocket as (SocketCtor & { __omgLogged?: true }) | undefined;
  if (typeof Base !== 'function' || Base.__omgLogged) return;
  class LoggedWebSocket extends Base {
    static __omgLogged = true as const;
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      const started = now();
      let openedAt: number | null = null;
      try {
        this.addEventListener('open', () => {
          openedAt = now() - started;
          log.debug('tunnel', `WebSocket open after ${openedAt} ms`);
        });
        this.addEventListener('close', ((e: CloseLike) => {
          const line = describeClose(e, openedAt, now() - started);
          if (e.code === 1000) log.info('tunnel', line);
          else log.warn('tunnel', line);
        }) as (e: never) => void);
      } catch {
        // Diagnostics must never break a connection.
      }
    }
  }
  target.WebSocket = LoggedWebSocket;
}

let nativeLog: Pick<Logger, 'info' | 'warn'> | undefined;

/**
 * The same line for the native tunnel of a pinned server (`NativeBridgeTunnel`, which does
 * not use the WebView WebSocket). `error` is the plugin's failure code, if any.
 */
export function logNativeSocketClose(e: {
  readonly code: number;
  readonly reason: string;
  readonly error?: string;
}): void {
  const log = nativeLog;
  if (!log) return;
  const line = `native ${describeClose({ code: e.code, reason: e.reason, wasClean: !e.error }, 0, 0).replace(/, open 0 s$/, '')}${e.error ? `, error ${e.error}` : ''}`;
  if (e.code === 1000 && !e.error) log.info('tunnel', line);
  else log.warn('tunnel', line);
}
