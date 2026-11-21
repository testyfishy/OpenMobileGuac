import type { SessionTarget } from '../nav/navigation.ts';
import type { OpenAgain } from '../settings/settingsModel.ts';

/**
 * Open sessions (SPEC MUL-1) and their lifecycle (T2.1), as a pure reducer. The React side
 * (`SessionsProvider`) keeps one mounted `SessionHost` per `live` session and shows only the
 * active one.
 */

export type SessionState =
  /** Mounted and connected (or connecting). */
  | 'live'
  /** Closed cleanly after too long in the background; one tap reconnects. */
  | 'suspended'
  /** The token expired and silent re-login failed: the user must sign in. */
  | 'reauth';

export interface OpenSession {
  readonly id: string;
  readonly serverId: string;
  readonly serverName: string;
  readonly target: SessionTarget;
  readonly openedAt: number;
  readonly lastShownAt: number;
  readonly state: SessionState;
  /** Bumped on reconnect so the session screen remounts with a fresh tunnel. */
  readonly epoch: number;
}

export interface SessionsState {
  readonly sessions: readonly OpenSession[];
  /** The session shown full screen, or `null` when the app chrome is showing. */
  readonly activeId: string | null;
}

export const INITIAL_SESSIONS: SessionsState = { sessions: [], activeId: null };

export type SessionsAction =
  | { readonly type: 'open'; readonly session: OpenSession }
  | { readonly type: 'show'; readonly id: string; readonly now: number }
  | { readonly type: 'hide' }
  | { readonly type: 'close'; readonly id: string }
  | { readonly type: 'close-server'; readonly serverId: string }
  | { readonly type: 'suspend-all' }
  /** Remount with a fresh tunnel; shows it unless `show` is false (background recovery). */
  | {
      readonly type: 'reconnect';
      readonly id: string;
      readonly now: number;
      readonly show?: boolean;
    }
  | { readonly type: 'reauth'; readonly id: string };

export function sameTarget(a: SessionTarget, b: SessionTarget): boolean {
  return (
    a.type === b.type &&
    a.dataSource === b.dataSource &&
    a.identifier === b.identifier &&
    a.join === b.join
  );
}

export function sessionsReducer(state: SessionsState, action: SessionsAction): SessionsState {
  switch (action.type) {
    case 'open':
      return {
        sessions: [...state.sessions, action.session],
        activeId: action.session.id,
      };
    case 'show': {
      if (!state.sessions.some((s) => s.id === action.id)) return state;
      return {
        sessions: state.sessions.map((s) =>
          s.id === action.id ? { ...s, lastShownAt: action.now } : s,
        ),
        activeId: action.id,
      };
    }
    case 'hide':
      return state.activeId === null ? state : { ...state, activeId: null };
    case 'close': {
      const sessions = state.sessions.filter((s) => s.id !== action.id);
      if (sessions.length === state.sessions.length) return state;
      return { sessions, activeId: state.activeId === action.id ? null : state.activeId };
    }
    case 'close-server': {
      const sessions = state.sessions.filter((s) => s.serverId !== action.serverId);
      const activeGone = !sessions.some((s) => s.id === state.activeId);
      return { sessions, activeId: activeGone ? null : state.activeId };
    }
    case 'suspend-all':
      if (!state.sessions.some((s) => s.state === 'live')) return state;
      return {
        ...state,
        sessions: state.sessions.map((s) =>
          s.state === 'live' ? { ...s, state: 'suspended' } : s,
        ),
      };
    case 'reconnect': {
      const show = action.show !== false;
      return {
        sessions: state.sessions.map((s) =>
          s.id === action.id
            ? {
                ...s,
                state: 'live',
                epoch: s.epoch + 1,
                lastShownAt: show ? action.now : s.lastShownAt,
              }
            : s,
        ),
        activeId:
          show && state.sessions.some((s) => s.id === action.id) ? action.id : state.activeId,
      };
    }
    case 'reauth':
      return {
        ...state,
        sessions: state.sessions.map((s) => (s.id === action.id ? { ...s, state: 'reauth' } : s)),
      };
  }
}

export type OpenDecision =
  /** That connection is already open: switch to it. */
  | { readonly kind: 'existing'; readonly id: string }
  /** That connection is already open: ask whether to go to it or open another. */
  | { readonly kind: 'ask'; readonly id: string }
  | { readonly kind: 'open' }
  /** At the cap: the user must close one. `suggest` is the least recently shown. */
  | { readonly kind: 'limit'; readonly suggest: OpenSession };

/** The most recently shown open session of that server and target, if any. */
export function findOpenSession(
  state: SessionsState,
  serverId: string,
  target: SessionTarget,
): OpenSession | undefined {
  let best: OpenSession | undefined;
  for (const s of state.sessions) {
    if (s.serverId !== serverId || !sameTarget(s.target, target)) continue;
    if (!best || s.lastShownAt > best.lastShownAt) best = s;
  }
  return best;
}

/**
 * The "When a connection is already open" setting as it applies to one target. Joining
 * someone else's session (admin Join) and share links always go to the open one: a second
 * copy of the same view is never the point there.
 */
export function openAgainFor(
  setting: OpenAgain,
  target: SessionTarget,
  shareLink: boolean,
): OpenAgain {
  return target.join !== undefined || shareLink ? 'switch' : setting;
}

/**
 * What tapping a connection does. `openAgain` is the effective setting (`openAgainFor`);
 * `forceNew` is the "Open another" answer, which skips the open session but still respects
 * the cap. Pure.
 */
export function decideOpen(
  state: SessionsState,
  serverId: string,
  target: SessionTarget,
  max: number,
  openAgain: OpenAgain = 'switch',
  forceNew = false,
): OpenDecision {
  const existing = forceNew ? undefined : findOpenSession(state, serverId, target);
  if (existing && openAgain === 'switch') return { kind: 'existing', id: existing.id };
  if (existing && openAgain === 'ask') return { kind: 'ask', id: existing.id };
  // Suspended sessions hold no connection, but still count: they are what the user sees
  // in the switcher, and reconnecting all of them would exceed the cap.
  if (state.sessions.length < Math.max(1, max)) return { kind: 'open' };
  const oldest = [...state.sessions].sort((a, b) => a.lastShownAt - b.lastShownAt)[0];
  return oldest ? { kind: 'limit', suggest: oldest } : { kind: 'open' };
}

/**
 * The setting to store after the "already open" question: the answer when "Don't ask
 * again" is ticked, otherwise nothing (`null`). Cancel never stores anything.
 */
export function openAgainToStore(
  answer: 'switch' | 'new' | 'cancel',
  dontAskAgain: boolean,
): OpenAgain | null {
  return answer !== 'cancel' && dontAskAgain ? answer : null;
}

export function activeSession(state: SessionsState): OpenSession | undefined {
  return state.sessions.find((s) => s.id === state.activeId);
}

/** Open sessions for one server and target, for "open" badges in the browser. */
export function openTargetKeys(state: SessionsState, serverId: string): Set<string> {
  return new Set(
    state.sessions
      // A joined session is someone else's: it does not mark the connection as open.
      .filter((s) => s.serverId === serverId && s.target.join === undefined)
      .map((s) => `${s.target.type}:${s.target.dataSource}:${s.target.identifier}`),
  );
}

// ---- lifecycle (timestamps, not timers: background WebViews throttle or freeze timers) --

/** Whether open sessions should be disconnected after `backgroundedAt`. */
export function shouldSuspend(
  backgroundedAt: number | null,
  now: number,
  graceSeconds: number | null,
): boolean {
  if (backgroundedAt === null || graceSeconds === null) return false;
  return now - backgroundedAt >= graceSeconds * 1000;
}

/** Whether the app lock applies when returning to the foreground. */
export function shouldLockOnResume(
  enabled: boolean,
  afterSeconds: number,
  backgroundedAt: number | null,
  now: number,
): boolean {
  if (!enabled || backgroundedAt === null) return false;
  return now - backgroundedAt >= afterSeconds * 1000;
}

/**
 * Whether to sign out of the servers on return (or at start-up, with the persisted
 * timestamp) after `backgroundedAt` ("Sign out of servers after …"; `null` = never).
 * Not while the Android keep-alive service held the sessions: the user chose to keep them.
 */
export function shouldSignOutAfterBackground(input: {
  readonly afterSeconds: number | null;
  readonly backgroundedAt: number | null;
  readonly now: number;
  readonly keepAliveRunning?: boolean;
}): boolean {
  if (input.afterSeconds === null || input.backgroundedAt === null) return false;
  if (input.keepAliveRunning) return false;
  // A clock set back (timestamp in the future) cannot prove the time passed.
  const away = input.now - input.backgroundedAt;
  return away >= 0 && away >= input.afterSeconds * 1000;
}

// ---- expired sign-in during a live session (T2.1) ---------------------------------------

/** How long an automatic re-login counts as "just happened". */
export const AUTH_RECOVERY_WINDOW_MS = 60_000;

export type AuthRecovery =
  /** Signed in again: remount the session with a fresh tunnel and the new token. */
  | 'reconnect'
  /** Silent re-login is not possible: show "Sign in again". */
  | 'reauth'
  /** Leave the session's own error showing (network trouble, or a real permission error). */
  | 'keep-error';

/**
 * What to do when a live session's tunnel refused the sign-in (`isSignInFailure`), given
 * the outcome of re-validating the server's sign-in (`AuthService.revalidate`, which uses
 * the saved password only through the app-lock credential gate and only with plain-http
 * consent; `'failed'` = it threw, e.g. offline). Pure.
 *
 * Loop guard: a session that was already recovered within the window and is refused again
 * has a fresh token, so the refusal is a permission problem and reconnecting would loop.
 * `'ok'` (the token is valid) only reconnects when the server was re-signed-in within the
 * window, e.g. by another of its sessions; otherwise the refusal is real.
 */
export function decideAuthRecovery(input: {
  readonly result: 'ok' | 'relogged' | 'needs-sign-in' | 'failed';
  readonly now: number;
  /** When this session last reconnected through this path. */
  readonly sessionRecoveredAt?: number | undefined;
  /** When the server last re-signed-in silently. */
  readonly serverReloggedAt?: number | undefined;
  readonly windowMs?: number;
}): AuthRecovery {
  const windowMs = input.windowMs ?? AUTH_RECOVERY_WINDOW_MS;
  const recent = (t: number | undefined) => t !== undefined && input.now - t < windowMs;
  if (input.result === 'needs-sign-in') return 'reauth';
  if (input.result === 'failed') return 'keep-error';
  if (recent(input.sessionRecoveredAt)) return 'keep-error';
  if (input.result === 'relogged') return 'reconnect';
  return recent(input.serverReloggedAt) ? 'reconnect' : 'keep-error';
}
