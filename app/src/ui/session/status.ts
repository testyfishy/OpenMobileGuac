/**
 * Connection status: human-readable messages for `Guacamole.Status` codes, and a small
 * pure state machine for the session overlay (connecting / connected / reconnecting /
 * error / disconnected) including the auto-reconnect policy.
 *
 * Status codes are the values of `Guacamole.Status.Code` in the vendored `Status.js`.
 * Texts come from the active session table, read when each function runs.
 */

import { sessionStrings } from './sessionStrings.ts';

export const STATUS = {
  SUCCESS: 0x0000,
  UNSUPPORTED: 0x0100,
  SERVER_ERROR: 0x0200,
  SERVER_BUSY: 0x0201,
  UPSTREAM_TIMEOUT: 0x0202,
  UPSTREAM_ERROR: 0x0203,
  RESOURCE_NOT_FOUND: 0x0204,
  RESOURCE_CONFLICT: 0x0205,
  RESOURCE_CLOSED: 0x0206,
  UPSTREAM_NOT_FOUND: 0x0207,
  UPSTREAM_UNAVAILABLE: 0x0208,
  SESSION_CONFLICT: 0x0209,
  SESSION_TIMEOUT: 0x020a,
  SESSION_CLOSED: 0x020b,
  CLIENT_BAD_REQUEST: 0x0300,
  CLIENT_UNAUTHORIZED: 0x0301,
  CLIENT_FORBIDDEN: 0x0303,
  CLIENT_TIMEOUT: 0x0308,
  CLIENT_OVERRUN: 0x030d,
  CLIENT_BAD_TYPE: 0x030f,
  CLIENT_TOO_MANY: 0x031d,
} as const;

/** Readable message for each known status code (looked up at call time, see `statusMessage`). */
function knownMessage(code: number): string | undefined {
  const m = sessionStrings.status.codes;
  switch (code) {
    case STATUS.UNSUPPORTED:
      return m.unsupported;
    case STATUS.SERVER_ERROR:
      return m.serverError;
    case STATUS.SERVER_BUSY:
      return m.serverBusy;
    case STATUS.UPSTREAM_TIMEOUT:
      return m.upstreamTimeout;
    case STATUS.UPSTREAM_ERROR:
      return m.upstreamError;
    case STATUS.RESOURCE_NOT_FOUND:
      return m.resourceNotFound;
    case STATUS.RESOURCE_CONFLICT:
      return m.resourceConflict;
    case STATUS.RESOURCE_CLOSED:
      return m.resourceClosed;
    case STATUS.UPSTREAM_NOT_FOUND:
      return m.upstreamNotFound;
    case STATUS.UPSTREAM_UNAVAILABLE:
      return m.upstreamUnavailable;
    case STATUS.SESSION_CONFLICT:
      return m.sessionConflict;
    case STATUS.SESSION_TIMEOUT:
      return m.sessionTimeout;
    case STATUS.SESSION_CLOSED:
      return m.sessionClosed;
    case STATUS.CLIENT_BAD_REQUEST:
      return m.clientBadRequest;
    case STATUS.CLIENT_UNAUTHORIZED:
      return m.clientUnauthorized;
    case STATUS.CLIENT_FORBIDDEN:
      return m.clientForbidden;
    case STATUS.CLIENT_TIMEOUT:
      return m.clientTimeout;
    case STATUS.CLIENT_OVERRUN:
      return m.clientOverrun;
    case STATUS.CLIENT_BAD_TYPE:
      return m.clientBadType;
    case STATUS.CLIENT_TOO_MANY:
      return m.clientTooMany;
    default:
      return undefined;
  }
}

/** Where an error status came from: guacd (`error` instruction) or the tunnel itself. */
export type StatusSource = 'client' | 'tunnel';

/**
 * A readable message for a status code; falls back to the server's text, then a generic one.
 * CLIENT_UNAUTHORIZED means different things by source (upstream `en.json`:
 * `ERROR_CLIENT_301` "Log in failed" vs `ERROR_TUNNEL_301` "not logged in"): from guacd it
 * is the remote computer rejecting the credentials, from the tunnel an expired sign-in.
 */
export function statusMessage(code: number, serverMessage?: string, source?: StatusSource): string {
  if (code === STATUS.CLIENT_UNAUTHORIZED && source === 'client') {
    return sessionStrings.status.remoteRejectedSignIn;
  }
  if (code === STATUS.CLIENT_FORBIDDEN && source === 'client') {
    return sessionStrings.status.remoteDeniedAccess;
  }
  const known = knownMessage(code);
  if (known) return known;
  const text = serverMessage?.trim();
  if (text) return text;
  if (code >= 0x0300 && code <= 0x03ff) return sessionStrings.status.refused(hex(code));
  return sessionStrings.status.failed(hex(code));
}

function hex(code: number): string {
  return Math.max(0, Math.trunc(code)).toString(16).padStart(4, '0');
}

/**
 * Whether an automatic reconnect makes sense after this status. Client errors (bad
 * request, auth, permission, too many) and conflicts would fail the same way again.
 */
export function isRetryableStatus(code: number): boolean {
  switch (code) {
    case STATUS.UPSTREAM_TIMEOUT:
    case STATUS.UPSTREAM_ERROR:
    case STATUS.UPSTREAM_UNAVAILABLE:
    case STATUS.SERVER_ERROR:
    case STATUS.SERVER_BUSY:
    case STATUS.CLIENT_TIMEOUT:
    case STATUS.RESOURCE_CLOSED:
    case STATUS.UPSTREAM_NOT_FOUND: // what a WebSocket tunnel reports for network loss (1006)
      return true;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------------------
// Overlay state machine

/**
 * Why a session ended, for tailored messages and the retry decision (DSP-9). Derived from
 * the status code and, where guacd uses one code for several causes, its message. RDP
 * (guacamole-server `src/protocols/rdp/error.c`, `guac_rdp_client_abort`):
 * SESSION_CLOSED "Forcibly disconnected." / "Logged off." / "Active session time limit
 * exceeded.", SESSION_TIMEOUT "Idle session time limit exceeded.", SESSION_CONFLICT
 * "Disconnected by other connection."; a log off or disconnect by the remote user sends
 * no error at all (status SUCCESS), so the session just ends.
 */
export type EndReason =
  | 'network'
  | 'server-closed'
  | 'logged-off'
  | 'kicked'
  | 'idle'
  | 'auth'
  | 'forbidden'
  | 'not-found'
  | 'busy'
  | 'other';

export function classifyStatus(code: number, serverMessage?: string): EndReason {
  switch (code) {
    case STATUS.SESSION_CONFLICT:
      return 'kicked';
    case STATUS.SESSION_TIMEOUT:
      return 'idle';
    case STATUS.SESSION_CLOSED:
      return /log(ged)?[\s-]*off/i.test(serverMessage ?? '') ? 'logged-off' : 'server-closed';
    case STATUS.RESOURCE_CONFLICT:
    case STATUS.CLIENT_TOO_MANY:
    case STATUS.SERVER_BUSY:
      return 'busy';
    case STATUS.CLIENT_UNAUTHORIZED:
      return 'auth';
    case STATUS.CLIENT_FORBIDDEN:
      return 'forbidden';
    case STATUS.RESOURCE_NOT_FOUND:
      return 'not-found';
    case STATUS.UPSTREAM_NOT_FOUND:
    case STATUS.CLIENT_TIMEOUT:
    case STATUS.UPSTREAM_TIMEOUT:
      return 'network';
    default:
      return 'other';
  }
}

/** Overlay heading for an ended session. */
export function endHeading(reason: EndReason, everConnected: boolean): string {
  const h = sessionStrings.status.headings;
  switch (reason) {
    case 'kicked':
      return h.kicked;
    case 'idle':
      return h.idle;
    case 'logged-off':
      return h.loggedOff;
    case 'server-closed':
      return h.serverClosed;
    case 'auth':
      return h.auth;
    case 'forbidden':
      return h.forbidden;
    case 'busy':
      return h.busy;
    case 'network':
      return everConnected ? h.lost : h.couldNotConnect;
    default:
      return everConnected ? h.ended : h.couldNotConnect;
  }
}

export type SessionPhase =
  | { readonly kind: 'connecting' }
  | { readonly kind: 'connected' }
  | {
      readonly kind: 'reconnecting';
      /** 1-based attempt about to be made. */
      readonly attempt: number;
      readonly maxAttempts: number;
      readonly delayMs: number;
      readonly reason: string;
      /** The device is offline: the attempt waits for the network instead of the delay. */
      readonly waitingForNetwork?: boolean;
    }
  | {
      readonly kind: 'error';
      readonly code: number | null;
      readonly message: string;
      readonly reason?: EndReason;
      readonly heading?: string;
      /** Who reported the error: guacd (`client`) or the tunnel / web app (`tunnel`). */
      readonly source?: StatusSource;
    }
  | {
      readonly kind: 'disconnected';
      /** The remote side ended the session (e.g. the user signed out on the remote). */
      readonly byServer?: boolean;
    };

export interface ReconnectPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export const DEFAULT_RECONNECT_POLICY: ReconnectPolicy = {
  maxAttempts: 4,
  baseDelayMs: 1000,
  maxDelayMs: 8000,
};

/** Exponential backoff: 1 s, 2 s, 4 s, 8 s, ... capped. `attempt` is 1-based. */
export function reconnectDelay(attempt: number, policy = DEFAULT_RECONNECT_POLICY): number {
  const n = Math.max(1, Math.trunc(attempt));
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (n - 1));
}

export type SessionEvent =
  /** A connect attempt was started (first or retry). */
  | { readonly type: 'connect' }
  /** The client reached CONNECTED (first frame received). */
  | { readonly type: 'connected' }
  /**
   * An error status from the server or tunnel. `message` is the server's text; `display`,
   * when given, replaces the derived human-readable message.
   */
  | {
      readonly type: 'error';
      readonly code: number;
      readonly message?: string;
      readonly display?: string;
      readonly source?: StatusSource;
    }
  /**
   * The tunnel closed. `intentional` = the user, unmount or the server asked for it;
   * `byServer` = the server ended the session without an error.
   */
  | { readonly type: 'closed'; readonly intentional: boolean; readonly byServer?: boolean }
  | { readonly type: 'user-disconnect' }
  /** Device network state (`online` / `offline` events). */
  | { readonly type: 'network'; readonly online: boolean };

export interface SessionMachine {
  readonly phase: SessionPhase;
  /** Whether this run has ever reached CONNECTED. */
  readonly everConnected: boolean;
  /** Reconnect attempts made since the last successful connection. */
  readonly attempts: number;
  /** First error seen in this attempt (decides retry vs error). */
  readonly lastError: {
    readonly code: number;
    readonly text: string;
    readonly reason: EndReason;
    readonly source?: StatusSource;
  } | null;
  /** The device reported that it is offline. */
  readonly offline?: boolean;
}

export const INITIAL_SESSION_MACHINE: SessionMachine = {
  phase: { kind: 'connecting' },
  everConnected: false,
  attempts: 0,
  lastError: null,
};

/**
 * Reduce a connection event. Auto-reconnect happens only after an unintentional close of a
 * session that had connected, when the first error of the attempt (if any) is retryable,
 * and while attempts remain. The host schedules the retry after `phase.delayMs`, or, while
 * `phase.waitingForNetwork`, as soon as the network is back. Terminal causes (signed in
 * elsewhere, idle timeout, closed by an administrator, sign-in failure) never retry.
 */
export function reduceSession(
  m: SessionMachine,
  e: SessionEvent,
  policy: ReconnectPolicy = DEFAULT_RECONNECT_POLICY,
): SessionMachine {
  switch (e.type) {
    case 'connect':
      return {
        ...m,
        lastError: null,
        phase:
          m.phase.kind === 'reconnecting'
            ? { ...m.phase, waitingForNetwork: false }
            : { kind: 'connecting' },
      };
    case 'connected': {
      const next: SessionMachine = {
        phase: { kind: 'connected' },
        everConnected: true,
        attempts: 0,
        lastError: null,
      };
      return m.offline ? { ...next, offline: true } : next;
    }
    case 'error': {
      // Keep the first error of an attempt: a tunnel error that follows a guacd error is
      // less specific.
      if (m.lastError !== null) return m;
      const text =
        e.display ??
        (e.source === 'tunnel'
          ? // Never connected and the WebSocket closed without a Guacamole status (1006): the
            // handshake was refused, typically a proxy that blocks WebSockets. The upstream
            // HTTP-tunnel fallback cannot work from the app (docs/protocol-notes.md §3.5).
            !m.everConnected && e.code === STATUS.UPSTREAM_NOT_FOUND
            ? sessionStrings.status.websocketBlocked
            : tunnelErrorMessage(e.code, e.message)
          : statusMessage(e.code, e.message, e.source));
      const reason: EndReason =
        e.source === 'tunnel' && e.code === STATUS.UPSTREAM_UNAVAILABLE
          ? 'network'
          : classifyStatus(e.code, e.message);
      return {
        ...m,
        lastError: e.source
          ? { code: e.code, text, reason, source: e.source }
          : { code: e.code, text, reason },
      };
    }
    case 'user-disconnect':
      return { ...m, phase: { kind: 'disconnected' } };
    case 'network': {
      const offline = !e.online;
      if (m.phase.kind === 'reconnecting') {
        return { ...m, offline, phase: { ...m.phase, waitingForNetwork: offline } };
      }
      return { ...m, offline };
    }
    case 'closed': {
      if (m.phase.kind === 'error' || m.phase.kind === 'disconnected') return m;
      const err = m.lastError;
      // A close with no error is a clean close (WebSocket 1000 / status SUCCESS): the server
      // ended the session, e.g. an administrator's "Kill" from Active Sessions closes the
      // tunnel with SUCCESS and guacd sends nothing (AUDIT #7). Upstream's web client shows
      // "Disconnected" with a manual Reconnect for it. A real network drop always reports
      // an error first (1006 → UPSTREAM_NOT_FOUND, receive timeout → UPSTREAM_TIMEOUT).
      const retryable = err !== null && isRetryableStatus(err.code);
      const canRetry =
        !e.intentional && m.everConnected && retryable && m.attempts < policy.maxAttempts;
      if (canRetry) {
        const attempt = m.attempts + 1;
        return {
          ...m,
          attempts: attempt,
          phase: {
            kind: 'reconnecting',
            attempt,
            maxAttempts: policy.maxAttempts,
            delayMs: reconnectDelay(attempt, policy),
            reason: err ? err.text : sessionStrings.status.lost,
            waitingForNetwork: m.offline === true,
          },
        };
      }
      if (err) {
        return {
          ...m,
          phase: {
            kind: 'error',
            code: err.code,
            message: err.text,
            reason: err.reason,
            heading: endHeading(err.reason, m.everConnected),
            ...(err.source ? { source: err.source } : {}),
          },
        };
      }
      if (e.intentional) {
        return {
          ...m,
          phase: e.byServer ? { kind: 'disconnected', byServer: true } : { kind: 'disconnected' },
        };
      }
      return {
        ...m,
        phase: {
          kind: 'error',
          code: null,
          message: m.everConnected
            ? sessionStrings.status.lostNotRestored
            : m.offline
              ? sessionStrings.status.offline
              : sessionStrings.status.unreachable,
        },
      };
    }
  }
}

/**
 * Whether a session ended because the Guacamole sign-in (auth token) is no longer accepted:
 * CLIENT_UNAUTHORIZED / CLIENT_FORBIDDEN reported by the tunnel, typically when a reconnect
 * after a dropped connection presents an expired token. The same codes from guacd (`client`)
 * mean the remote computer refused its own credentials, which a new token cannot fix.
 */
export function isSignInFailure(phase: SessionPhase): boolean {
  return (
    phase.kind === 'error' &&
    phase.source === 'tunnel' &&
    (phase.reason === 'auth' || phase.reason === 'forbidden')
  );
}

/**
 * Message for an error reported by the tunnel itself (not by guacd). The WebSocket tunnel
 * maps an abnormal close (1006, also used when the socket cannot open) to
 * UPSTREAM_NOT_FOUND, which would otherwise read as "remote computer not found".
 */
export function tunnelErrorMessage(code: number, serverMessage?: string): string {
  if (code === STATUS.UPSTREAM_NOT_FOUND) return sessionStrings.status.tunnelUnreachable;
  if (code === STATUS.UPSTREAM_UNAVAILABLE) return sessionStrings.status.tunnelClosed;
  return statusMessage(code, serverMessage);
}
