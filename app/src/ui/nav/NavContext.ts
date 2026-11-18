import { createContext, useContext, useEffect, useRef } from 'react';
import type { NavAction, NavState, Route } from './navigation.ts';

export interface NavApi {
  readonly state: NavState;
  readonly dispatch: (action: NavAction) => void;
  readonly push: (route: Route) => void;
  readonly open: (route: Route) => void;
  readonly replace: (route: Route) => void;
  readonly pop: () => void;
  /** Registers a back interceptor; returns the unregister function. */
  readonly addBackInterceptor: (fn: () => boolean) => () => void;
  /** Runs the same logic as a hardware back press. */
  readonly back: () => void;
}

export const NavContext = createContext<NavApi | null>(null);

export function useNav(): NavApi {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('useNav() outside <NavProvider>');
  return nav;
}

/**
 * While `active`, a back press (Android hardware back, Escape) calls `handler` instead of
 * popping the stack. Used by dialogs and the session screen.
 */
export function useBackInterceptor(active: boolean, handler: () => void): void {
  const nav = useNav();
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  const { addBackInterceptor } = nav;
  useEffect(() => {
    if (!active) return undefined;
    return addBackInterceptor(() => {
      ref.current();
      return true;
    });
  }, [active, addBackInterceptor]);
}
