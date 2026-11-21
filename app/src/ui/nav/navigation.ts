/**
 * A tiny navigation stack (no dependency). Pure: the React side lives in `NavProvider`.
 *
 * The root entry is always the server list. Opening a server replaces everything above the
 * root, so the stack stays shallow: servers → connections. Open sessions live outside the
 * stack (`sessions/SessionsProvider`), so going back to the list keeps them connected.
 */

export interface SessionTarget {
  readonly dataSource: string;
  readonly identifier: string;
  /** `c` = connection, `g` = balancing group. */
  readonly type: 'c' | 'g';
  readonly name: string;
  readonly protocol: string;
  /**
   * Join someone else's running session instead (admin "Join"): the active connection's
   * identifier, sent as `GUAC_TYPE=a` (`TunnelRequestType.ACTIVE_CONNECTION`). `identifier`
   * stays the underlying connection, for its settings. Nothing is stored under it.
   */
  readonly join?: string;
}

/** Whose own session settings an editor shows (Settings › Connections, SET-1). */
export type LayerTarget =
  | {
      readonly kind: 'connection';
      readonly serverId: string;
      readonly ref: {
        readonly dataSource: string;
        readonly identifier: string;
        readonly type: 'c' | 'g';
      };
      readonly name?: string;
      readonly protocol?: string;
      /** Opened from this open session: Back shows it again. */
      readonly sessionId?: string;
    }
  | { readonly kind: 'server'; readonly serverId: string; readonly name?: string };

export type Route =
  | { readonly name: 'servers' }
  | { readonly name: 'server-edit'; readonly serverId?: string }
  | { readonly name: 'connections'; readonly serverId: string }
  | { readonly name: 'settings' }
  | { readonly name: 'backup' }
  | { readonly name: 'diagnostics' }
  /** Settings › Connections, optionally only those with their own values on one page. */
  | { readonly name: 'connection-settings'; readonly page?: string }
  /** One connection's (or one server's) own session settings. */
  | { readonly name: 'layer-settings'; readonly target: LayerTarget };

export interface NavEntry {
  readonly key: number;
  readonly route: Route;
}

export interface NavState {
  readonly stack: readonly NavEntry[];
  readonly nextKey: number;
}

export type NavAction =
  | { readonly type: 'push'; readonly route: Route }
  | { readonly type: 'pop' }
  /** Replaces the top entry (keeps the root). */
  | { readonly type: 'replace'; readonly route: Route }
  /** Clears everything above the root, then pushes `route` (unless it is the root). */
  | { readonly type: 'open'; readonly route: Route }
  | { readonly type: 'reset' };

export function initialNavState(): NavState {
  return { stack: [{ key: 0, route: { name: 'servers' } }], nextKey: 1 };
}

export function navReducer(state: NavState, action: NavAction): NavState {
  const root = state.stack[0] ?? { key: 0, route: { name: 'servers' } as Route };
  const entry = (route: Route): NavEntry => ({ key: state.nextKey, route });
  switch (action.type) {
    case 'push': {
      if (action.route.name === 'servers') return navReducer(state, { type: 'reset' });
      return { stack: [...state.stack, entry(action.route)], nextKey: state.nextKey + 1 };
    }
    case 'pop':
      if (state.stack.length <= 1) return state;
      return { ...state, stack: state.stack.slice(0, -1) };
    case 'replace': {
      if (state.stack.length <= 1 || action.route.name === 'servers') {
        return navReducer(state, { type: 'push', route: action.route });
      }
      return {
        stack: [...state.stack.slice(0, -1), entry(action.route)],
        nextKey: state.nextKey + 1,
      };
    }
    case 'open':
      if (action.route.name === 'servers') return { ...state, stack: [root] };
      return { stack: [root, entry(action.route)], nextKey: state.nextKey + 1 };
    case 'reset':
      return { ...state, stack: [root] };
  }
}

export function topRoute(state: NavState): Route {
  return (state.stack[state.stack.length - 1] ?? { route: { name: 'servers' } as Route }).route;
}

export function canGoBack(state: NavState): boolean {
  return state.stack.length > 1;
}

/** The server whose detail is showing, for highlighting in the two-pane list. */
export function selectedServerId(state: NavState): string | undefined {
  for (let i = state.stack.length - 1; i >= 0; i--) {
    const r = state.stack[i]?.route;
    if (r && r.name === 'connections') return r.serverId;
    if (r && r.name === 'server-edit') return r.serverId;
  }
  return undefined;
}

/**
 * What a hardware back press should do, given the registered interceptors (open dialogs,
 * the session's disconnect confirmation). Interceptors run newest first; the first that
 * returns `true` consumes the press.
 */
export type BackDecision = 'handled' | 'pop' | 'exit';

export function decideBack(
  state: NavState,
  interceptors: readonly (() => boolean)[],
): BackDecision {
  for (let i = interceptors.length - 1; i >= 0; i--) {
    if (interceptors[i]?.()) return 'handled';
  }
  return canGoBack(state) ? 'pop' : 'exit';
}
