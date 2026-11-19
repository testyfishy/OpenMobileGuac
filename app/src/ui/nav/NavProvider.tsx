import { App as CapApp } from '@capacitor/app';
import { useCallback, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { NavContext, type NavApi } from './NavContext.ts';
import { decideBack, initialNavState, navReducer, type Route } from './navigation.ts';

/**
 * Owns the navigation stack and the back button: Android hardware back (via @capacitor/app)
 * and Escape on desktop/hardware keyboards. Registering a `backButton` listener disables the
 * default behaviour, so at the root the app minimises itself.
 */
export function NavProvider({
  children,
  native,
  sessionVisible,
}: {
  children: ReactNode;
  native: boolean;
  /** While a remote session is on screen, Escape belongs to the remote desktop. */
  sessionVisible?: () => boolean;
}) {
  const sessionVisibleRef = useRef(sessionVisible);
  useEffect(() => {
    sessionVisibleRef.current = sessionVisible;
  });
  const [state, dispatch] = useReducer(navReducer, undefined, initialNavState);
  const interceptors = useRef<(() => boolean)[]>([]);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const addBackInterceptor = useCallback((fn: () => boolean) => {
    interceptors.current = [...interceptors.current, fn];
    return () => {
      interceptors.current = interceptors.current.filter((f) => f !== fn);
    };
  }, []);

  const back = useCallback(() => {
    const decision = decideBack(stateRef.current, interceptors.current);
    if (decision === 'pop') dispatch({ type: 'pop' });
    else if (decision === 'exit' && native) void CapApp.minimizeApp().catch(() => undefined);
  }, [native]);

  useEffect(() => {
    if (!native) return undefined;
    let removed = false;
    let remove: (() => void) | undefined;
    void CapApp.addListener('backButton', () => back())
      .then((handle) => {
        if (removed) void handle.remove();
        else remove = () => void handle.remove();
      })
      .catch(() => undefined);
    return () => {
      removed = true;
      remove?.();
    };
  }, [native, back]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // In a session Escape belongs to the remote desktop (its dialogs handle their own).
      // Only the app's own dialogs and sheets (above the session) take it then.
      if (
        sessionVisibleRef.current?.() &&
        !document.querySelector('.sheet-backdrop, .dialog-backdrop')
      ) {
        return;
      }
      back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [back]);

  const api = useMemo<NavApi>(
    () => ({
      state,
      dispatch,
      push: (route: Route) => dispatch({ type: 'push', route }),
      open: (route: Route) => dispatch({ type: 'open', route }),
      replace: (route: Route) => dispatch({ type: 'replace', route }),
      pop: () => dispatch({ type: 'pop' }),
      addBackInterceptor,
      back,
    }),
    [state, addBackInterceptor, back],
  );

  return <NavContext.Provider value={api}>{children}</NavContext.Provider>;
}
