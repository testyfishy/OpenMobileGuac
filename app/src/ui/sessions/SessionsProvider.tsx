import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ServerProfile } from '../../core/models/ServerProfile.ts';
import { DEMO_PROFILE_ID } from '../integration/demoProfile.ts';
import type { SessionTarget } from '../nav/navigation.ts';
import { useAppSettings, useServices } from '../services/context.ts';
import { haptic, onAppActiveChange } from '../services/native.ts';
import { isInsecureUrl } from '../servers/serverForm.ts';
import { parseServerOptions } from '../settings/settingsModel.ts';
import { seedPolicy } from '../servers/seedPolicy.ts';
import {
  INITIAL_SESSIONS,
  decideOpen,
  sessionsReducer,
  shouldSuspend,
  type OpenSession,
} from './sessionModel.ts';
import { SessionsContext, type SessionsApi } from './SessionsContext.ts';
import { captureThumbnail } from './thumbnails.ts';

interface Pending {
  readonly serverId: string;
  readonly serverName: string;
  readonly target: SessionTarget;
  readonly suggest: OpenSession;
}

/**
 * Owns the open sessions (MUL-1) and their lifecycle (T2.1): disconnect after the
 * background grace period, reconnect with re-validated sign-in, thumbnails (CON-4).
 * Rendering of the sessions themselves is `SessionLayer`.
 */
export function SessionsProvider({
  children,
  slotFor,
}: {
  children: ReactNode;
  /** Finds a session's DOM container, for thumbnails. */
  slotFor: (id: string) => HTMLElement | null;
}) {
  const services = useServices();
  const { settings } = useAppSettings();
  const [state, dispatch] = useReducer(sessionsReducer, INITIAL_SESSIONS);
  const [pending, setPending] = useState<Pending | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const stateRef = useRef(state);
  const settingsRef = useRef(settings);
  useEffect(() => {
    stateRef.current = state;
    settingsRef.current = settings;
  });

  const saveThumb = useCallback(
    (s: OpenSession) => {
      if (!settingsRef.current.thumbnails || s.state !== 'live') return;
      const dataUrl = captureThumbnail(slotFor(s.id));
      if (!dataUrl) return;
      const ref = {
        dataSource: s.target.dataSource,
        identifier: s.target.identifier,
        type: s.target.type,
      };
      void services.profiles
        .setThumbnail(s.serverId, ref, { dataUrl, at: Date.now() })
        .catch(() => undefined);
    },
    [services.profiles, slotFor],
  );

  const saveActiveThumb = useCallback(() => {
    const active = stateRef.current.sessions.find((s) => s.id === stateRef.current.activeId);
    if (active) saveThumb(active);
  }, [saveThumb]);

  const openNow = useCallback(
    (serverId: string, serverName: string, target: SessionTarget) => {
      const now = Date.now();
      saveActiveThumb();
      dispatch({
        type: 'open',
        session: {
          id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          serverId,
          serverName,
          target,
          openedAt: now,
          lastShownAt: now,
          state: 'live',
          epoch: 0,
        },
      });
      services.log.info('session', `opened ${target.protocol || 'connection'} session`);
      haptic('light');
    },
    [saveActiveThumb, services.log],
  );

  const close = useCallback(
    (id: string) => {
      const s = stateRef.current.sessions.find((x) => x.id === id);
      if (s) saveThumb(s);
      dispatch({ type: 'close', id });
      if (stateRef.current.sessions.every((x) => x.id === id)) setSwitcherOpen(false);
      services.log.info('session', 'closed session');
    },
    [saveThumb, services.log],
  );

  const open = useCallback(
    (serverId: string, serverName: string, target: SessionTarget) => {
      const d = decideOpen(stateRef.current, serverId, target, settingsRef.current.maxSessions);
      if (d.kind === 'existing') {
        saveActiveThumb();
        dispatch({ type: 'show', id: d.id, now: Date.now() });
        return;
      }
      if (d.kind === 'limit') {
        setPending({ serverId, serverName, target, suggest: d.suggest });
        haptic('warning');
        return;
      }
      openNow(serverId, serverName, target);
    },
    [openNow, saveActiveThumb],
  );

  const show = useCallback(
    (id: string) => {
      saveActiveThumb();
      dispatch({ type: 'show', id, now: Date.now() });
      setSwitcherOpen(false);
    },
    [saveActiveThumb],
  );

  const hide = useCallback(() => {
    saveActiveThumb();
    dispatch({ type: 'hide' });
  }, [saveActiveThumb]);

  const closeServer = useCallback((serverId: string) => {
    dispatch({ type: 'close-server', serverId });
  }, []);

  const findProfile = useCallback(
    async (serverId: string): Promise<ServerProfile | undefined> => {
      const dev = services.devServer;
      if (dev && dev.profile.id === serverId) return dev.profile;
      return services.profiles.get(serverId);
    },
    [services.devServer, services.profiles],
  );

  const reconnect = useCallback(
    (id: string) => {
      const s = stateRef.current.sessions.find((x) => x.id === id);
      if (!s) return;
      if (s.serverId === DEMO_PROFILE_ID) {
        dispatch({ type: 'reconnect', id, now: Date.now() });
        return;
      }
      void (async () => {
        const profile = await findProfile(s.serverId);
        if (!profile) {
          dispatch({ type: 'close', id });
          return;
        }
        const options = parseServerOptions(await services.profiles.getOptions(profile.id));
        const httpAllowed =
          !isInsecureUrl(profile.baseUrl) ||
          services.auth.isHttpConfirmed(profile.id) ||
          (await services.settings.isHttpWarningDismissed(profile.id));
        try {
          const seedsAllowed =
            seedPolicy(
              services.secretStorage,
              await services.lock.availability(),
              settingsRef.current.lock.enabled,
            ) === 'allowed';
          const r = await services.auth.revalidate(profile, {
            httpAllowed,
            totpAutofill: options.totpAutofill && seedsAllowed,
          });
          services.log.info('session', `reconnect: ${r}`);
          if (r === 'needs-sign-in') dispatch({ type: 'reauth', id });
          else dispatch({ type: 'reconnect', id, now: Date.now() });
        } catch {
          // Network trouble: reconnect anyway, the session screen shows its own error and retry.
          dispatch({ type: 'reconnect', id, now: Date.now() });
        }
      })();
    },
    [findProfile, services],
  );

  // ---- T2.1 lifecycle: grace timer (best effort) plus a timestamp check on return.
  useEffect(() => {
    let backgroundedAt: number | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const suspendIfDue = () => {
      const grace = settingsRef.current.backgroundDisconnectSeconds;
      if (!shouldSuspend(backgroundedAt, Date.now(), grace)) return;
      if (stateRef.current.sessions.some((s) => s.state === 'live')) {
        services.log.info('session', 'background grace period over: disconnecting sessions');
        dispatch({ type: 'suspend-all' });
      }
    };
    const sub = onAppActiveChange((active) => {
      // The biometric prompt itself can pause/resume the app on Android.
      if (services.lock.promptActive()) return;
      if (!active) {
        backgroundedAt = Date.now();
        for (const s of stateRef.current.sessions) saveThumb(s);
        const grace = settingsRef.current.backgroundDisconnectSeconds;
        if (grace !== null) timer = setTimeout(suspendIfDue, grace * 1000 + 50);
      } else {
        clearTimeout(timer);
        suspendIfDue();
        backgroundedAt = null;
      }
    });
    return () => {
      clearTimeout(timer);
      sub.dispose();
    };
  }, [saveThumb, services.lock, services.log]);

  // Sessions of a server whose sign-in ended elsewhere (sign out) cannot continue.
  useEffect(
    () =>
      services.auth.onSessionChange((profileId) => {
        if (profileId === DEMO_PROFILE_ID || services.auth.current(profileId)) return;
        const affected = stateRef.current.sessions.filter(
          (s) => s.serverId === profileId && s.state === 'live',
        );
        for (const s of affected) dispatch({ type: 'reauth', id: s.id });
      }),
    [services.auth],
  );

  const limit = useMemo(
    () =>
      pending
        ? {
            closeName: pending.suggest.target.name,
            max: settings.maxSessions,
            confirm: () => {
              setPending(null);
              close(pending.suggest.id);
              openNow(pending.serverId, pending.serverName, pending.target);
            },
            cancel: () => setPending(null),
          }
        : null,
    [pending, settings.maxSessions, close, openNow],
  );

  const api = useMemo<SessionsApi>(
    () => ({
      state,
      limit,
      open,
      show,
      hide,
      close,
      closeServer,
      reconnect,
      switcherOpen,
      setSwitcherOpen,
    }),
    [state, limit, open, show, hide, close, closeServer, reconnect, switcherOpen],
  );

  return <SessionsContext.Provider value={api}>{children}</SessionsContext.Provider>;
}
