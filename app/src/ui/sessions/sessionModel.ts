import type { SessionTarget } from '../nav/navigation.ts';

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
  | { readonly type: 'reconnect'; readonly id: string; readonly now: number }
  | { readonly type: 'reauth'; readonly id: string };

export function sameTarget(a: SessionTarget, b: SessionTarget): boolean {
  return a.type === b.type && a.dataSource === b.dataSource && a.identifier === b.identifier;
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
    case 'reconnect':
      return {
        sessions: state.sessions.map((s) =>
          s.id === action.id
            ? { ...s, state: 'live', epoch: s.epoch + 1, lastShownAt: action.now }
            : s,
        ),
        activeId: state.sessions.some((s) => s.id === action.id) ? action.id : state.activeId,
      };
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
  | { readonly kind: 'open' }
  /** At the cap: the user must close one. `suggest` is the least recently shown. */
  | { readonly kind: 'limit'; readonly suggest: OpenSession };

export function decideOpen(
  state: SessionsState,
  serverId: string,
  target: SessionTarget,
  max: number,
): OpenDecision {
  const existing = state.sessions.find(
    (s) => s.serverId === serverId && sameTarget(s.target, target),
  );
  if (existing) return { kind: 'existing', id: existing.id };
  // Suspended sessions hold no connection, but still count: they are what the user sees
  // in the switcher, and reconnecting all of them would exceed the cap.
  if (state.sessions.length < Math.max(1, max)) return { kind: 'open' };
  const oldest = [...state.sessions].sort((a, b) => a.lastShownAt - b.lastShownAt)[0];
  return oldest ? { kind: 'limit', suggest: oldest } : { kind: 'open' };
}

export function activeSession(state: SessionsState): OpenSession | undefined {
  return state.sessions.find((s) => s.id === state.activeId);
}

/** Open sessions for one server and target, for "open" badges in the browser. */
export function openTargetKeys(state: SessionsState, serverId: string): Set<string> {
  return new Set(
    state.sessions
      .filter((s) => s.serverId === serverId)
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
