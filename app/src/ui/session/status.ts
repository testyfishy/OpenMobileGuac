/**
 * Connection status: human-readable messages for `Guacamole.Status` codes, and a small
 * pure state machine for the session overlay (connecting / connected / reconnecting /
 * error / disconnected) including the auto-reconnect policy.
 *
 * Status codes are the values of `Guacamole.Status.Code` in the vendored `Status.js`.
 */

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

const MESSAGES: Readonly<Record<number, string>> = {
  [STATUS.UNSUPPORTED]: 'The server does not support this operation.',
  [STATUS.SERVER_ERROR]: 'The Guacamole server hit an internal error.',
  [STATUS.SERVER_BUSY]: 'The server is busy. Try again in a moment.',
  [STATUS.UPSTREAM_TIMEOUT]: 'The remote computer is not responding.',
  [STATUS.UPSTREAM_ERROR]: 'The remote computer reported an error.',
  [STATUS.RESOURCE_NOT_FOUND]: 'This connection no longer exists.',
  [STATUS.RESOURCE_CONFLICT]: 'This connection is already in use and does not allow sharing.',
  [STATUS.RESOURCE_CLOSED]: 'The connection was closed.',
  [STATUS.UPSTREAM_NOT_FOUND]: 'The remote computer could not be found.',
  [STATUS.UPSTREAM_UNAVAILABLE]: 'The remote computer is unavailable (it may be off or refusing).',
  [STATUS.SESSION_CONFLICT]: 'Another session took over this connection.',
  [STATUS.SESSION_TIMEOUT]: 'The session timed out.',
  [STATUS.SESSION_CLOSED]: 'The session was closed by the remote computer or an administrator.',
  [STATUS.CLIENT_BAD_REQUEST]: 'The server rejected the connection parameters.',
  [STATUS.CLIENT_UNAUTHORIZED]: 'Not signed in, or the login expired. Sign in again.',
  [STATUS.CLIENT_FORBIDDEN]: 'You do not have permission to use this connection.',
  [STATUS.CLIENT_TIMEOUT]: 'The connection to the server timed out.',
  [STATUS.CLIENT_OVERRUN]: 'Too much data was sent to the server.',
  [STATUS.CLIENT_BAD_TYPE]: 'The server refused data of an unsupported type.',
  [STATUS.CLIENT_TOO_MANY]: 'Too many sessions are open for this account or connection.',
};

/** A readable message for a status code; falls back to the server's text, then a generic one. */
export function statusMessage(code: number, serverMessage?: string): string {
  const known = MESSAGES[code];
  if (known) return known;
  const text = serverMessage?.trim();
  if (text) return text;
  if (code >= 0x0300 && code <= 0x03ff) return `The request was refused (code 0x${hex(code)}).`;
  return `The connection failed (code 0x${hex(code)}).`;
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
    }
  | { readonly kind: 'error'; readonly code: number | null; readonly message: string }
  | { readonly kind: 'disconnected' };

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
    }
  /** The tunnel closed. `intentional` = the user, unmount or the server asked for it. */
  | { readonly type: 'closed'; readonly intentional: boolean }
  | { readonly type: 'user-disconnect' };

export interface SessionMachine {
  readonly phase: SessionPhase;
  /** Whether this run has ever reached CONNECTED. */
  readonly everConnected: boolean;
  /** Reconnect attempts made since the last successful connection. */
  readonly attempts: number;
  /** Last error seen in this attempt (decides retry vs error). */
  readonly lastError: { readonly code: number; readonly text: string } | null;
}

export const INITIAL_SESSION_MACHINE: SessionMachine = {
  phase: { kind: 'connecting' },
  everConnected: false,
  attempts: 0,
  lastError: null,
};

/**
 * Reduce a connection event. Auto-reconnect happens only after an unintentional close of a
 * session that had connected, when the last error (if any) is retryable, and while
 * attempts remain. The host schedules the retry after `phase.delayMs`.
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
        phase: m.phase.kind === 'reconnecting' ? m.phase : { kind: 'connecting' },
      };
    case 'connected':
      return { phase: { kind: 'connected' }, everConnected: true, attempts: 0, lastError: null };
    case 'error':
      return {
        ...m,
        lastError: { code: e.code, text: e.display ?? statusMessage(e.code, e.message) },
      };
    case 'user-disconnect':
      return { ...m, phase: { kind: 'disconnected' } };
    case 'closed': {
      if (m.phase.kind === 'error' || m.phase.kind === 'disconnected') return m;
      const err = m.lastError;
      const retryable = err === null || isRetryableStatus(err.code);
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
            reason: err ? err.text : 'The connection was lost.',
          },
        };
      }
      if (err) {
        return {
          ...m,
          phase: { kind: 'error', code: err.code, message: err.text },
        };
      }
      if (e.intentional) return { ...m, phase: { kind: 'disconnected' } };
      return {
        ...m,
        phase: {
          kind: 'error',
          code: null,
          message: m.everConnected
            ? 'The connection was lost and could not be restored.'
            : 'Could not reach the server.',
        },
      };
    }
  }
}

/**
 * Message for an error reported by the tunnel itself (not by guacd). The WebSocket tunnel
 * maps an abnormal close (1006, also used when the socket cannot open) to
 * UPSTREAM_NOT_FOUND, which would otherwise read as "remote computer not found".
 */
export function tunnelErrorMessage(code: number, serverMessage?: string): string {
  if (code === STATUS.UPSTREAM_NOT_FOUND) return 'Could not reach the server (network error).';
  if (code === STATUS.UPSTREAM_UNAVAILABLE) return 'The server closed the connection.';
  return statusMessage(code, serverMessage);
}
