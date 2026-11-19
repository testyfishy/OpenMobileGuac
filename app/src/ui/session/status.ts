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
    return 'The remote computer rejected the sign-in. Check the username and password and try again.';
  }
  if (code === STATUS.CLIENT_FORBIDDEN && source === 'client') {
    return 'The remote computer denied access to this account.';
  }
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
  switch (reason) {
    case 'kicked':
      return 'Signed in elsewhere';
    case 'idle':
      return 'Session timed out';
    case 'logged-off':
      return 'Signed out';
    case 'server-closed':
      return 'Disconnected by the server';
    case 'auth':
      return 'Sign-in failed';
    case 'forbidden':
      return 'Access denied';
    case 'busy':
      return 'Connection busy';
    case 'network':
      return everConnected ? 'Connection lost' : 'Could not connect';
    default:
      return everConnected ? 'Connection ended' : 'Could not connect';
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
          ? tunnelErrorMessage(e.code, e.message)
          : statusMessage(e.code, e.message, e.source));
      const reason: EndReason =
        e.source === 'tunnel' && e.code === STATUS.UPSTREAM_UNAVAILABLE
          ? 'network'
          : classifyStatus(e.code, e.message);
      return { ...m, lastError: { code: e.code, text, reason } };
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
            ? 'The connection was lost and could not be restored.'
            : m.offline
              ? 'This device is offline.'
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
