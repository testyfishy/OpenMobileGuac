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
import type { RevalidateResult } from '../services/AuthService.ts';
import { DEMO_PROFILE_ID } from '../integration/demoProfile.ts';
import type { SessionTarget } from '../nav/navigation.ts';
import { useAppSettings, useServices } from '../services/context.ts';
import { haptic, onAppActiveChange } from '../services/native.ts';
import { isInsecureUrl } from '../servers/serverForm.ts';
import { parseServerOptions } from '../settings/settingsModel.ts';
import { seedPolicy } from '../servers/seedPolicy.ts';
import { isShareServerId } from '../services/shareSessions.ts';
import {
  INITIAL_SESSIONS,
  decideAuthRecovery,
  decideOpen,
  sessionsReducer,
  shouldSuspend,
  type OpenSession,
} from './sessionModel.ts';
import { SessionsContext, type SessionsApi } from './SessionsContext.ts';

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
export function SessionsProvider({ children }: { children: ReactNode }) {
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

  const openNow = useCallback(
    (serverId: string, serverName: string, target: SessionTarget) => {
      const now = Date.now();
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
    [services.log],
  );

  const close = useCallback(
    (id: string) => {
      dispatch({ type: 'close', id });
      if (stateRef.current.sessions.every((x) => x.id === id)) setSwitcherOpen(false);
      services.log.info('session', 'closed session');
    },
    [services.log],
  );

  const open = useCallback(
    (serverId: string, serverName: string, target: SessionTarget) => {
      const d = decideOpen(stateRef.current, serverId, target, settingsRef.current.maxSessions);
      if (d.kind === 'existing') {
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
    [openNow],
  );

  const show = useCallback((id: string) => {
    dispatch({ type: 'show', id, now: Date.now() });
    setSwitcherOpen(false);
  }, []);

  const hide = useCallback(() => {
    dispatch({ type: 'hide' });
  }, []);

  const closeServer = useCallback((serverId: string) => {
    dispatch({ type: 'close-server', serverId });
  }, []);

  const findProfile = useCallback(
    async (serverId: string): Promise<ServerProfile | undefined> => {
      const dev = services.devServer;
      if (dev && dev.profile.id === serverId) return dev.profile;
      if (isShareServerId(serverId)) return services.shares.get(serverId);
      return services.profiles.get(serverId);
    },
    [services.devServer, services.profiles, services.shares],
  );

  // Re-validation of a server's sign-in, shared by reconnect (suspended) and recovery
  // (live session refused by the tunnel). One run per server at a time; while it runs, the
  // sign-in change it causes (token forgotten, then replaced) must not end live sessions.
  const revalidating = useRef(new Map<string, Promise<RevalidateResult | 'failed'>>());
  const reloggedAt = useRef(new Map<string, number>());
  const recoveredAt = useRef(new Map<string, number>());

  const revalidateServer = useCallback(
    (profile: ServerProfile): Promise<RevalidateResult | 'failed'> => {
      const running = revalidating.current.get(profile.id);
      if (running) return running;
      const run = (async (): Promise<RevalidateResult | 'failed'> => {
        const options = parseServerOptions(await services.profiles.getOptions(profile.id));
        // SRV-5: never send a password over plain http without the user's consent.
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
          // The saved password and TOTP seed pass the app-lock credential gate inside.
          const r = await services.auth.revalidate(profile, {
            httpAllowed,
            totpAutofill: options.totpAutofill && seedsAllowed,
          });
          if (r === 'relogged') reloggedAt.current.set(profile.id, Date.now());
          return r;
        } catch {
          return 'failed';
        }
      })();
      revalidating.current.set(profile.id, run);
      void run.finally(() => {
        revalidating.current.delete(profile.id);
        // Apply what the suppressed sign-in change would have done.
        if (profile.id === DEMO_PROFILE_ID || services.auth.current(profile.id)) return;
        for (const s of stateRef.current.sessions) {
          if (s.serverId === profile.id && s.state === 'live')
            dispatch({ type: 'reauth', id: s.id });
        }
      });
      return run;
    },
    [services],
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
        const r = await revalidateServer(profile);
        services.log.info('session', `reconnect: ${r}`);
        if (r === 'needs-sign-in') dispatch({ type: 'reauth', id });
        // 'failed' (network trouble): reconnect anyway, the session screen shows its own
        // error and retry.
        else dispatch({ type: 'reconnect', id, now: Date.now() });
      })();
    },
    [findProfile, revalidateServer, services.log],
  );

  const recoverSignIn = useCallback(
    (id: string) => {
      const s = stateRef.current.sessions.find((x) => x.id === id);
      if (!s || s.state !== 'live' || s.serverId === DEMO_PROFILE_ID) return;
      void (async () => {
        const profile = await findProfile(s.serverId);
        if (!profile) return;
        services.log.info('session', 'tunnel refused the sign-in: re-validating');
        const result = await revalidateServer(profile);
        const now = Date.now();
        const action = decideAuthRecovery({
          result,
          now,
          sessionRecoveredAt: recoveredAt.current.get(id),
          serverReloggedAt: reloggedAt.current.get(profile.id),
        });
        services.log.info('session', `sign-in recovery: ${result} -> ${action}`);
        const still = stateRef.current.sessions.find((x) => x.id === id);
        if (!still || still.epoch !== s.epoch) return;
        if (action === 'reconnect') {
          recoveredAt.current.set(id, now);
          dispatch({ type: 'reconnect', id, now, show: false });
        } else if (action === 'reauth') {
          dispatch({ type: 'reauth', id });
        }
      })();
    },
    [findProfile, revalidateServer, services.log],
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
  }, [services.lock, services.log]);

  // Sessions of a server whose sign-in ended elsewhere (sign out) cannot continue.
  useEffect(
    () =>
      services.auth.onSessionChange((profileId) => {
        if (profileId === DEMO_PROFILE_ID || services.auth.current(profileId)) return;
        // Mid re-validation: the token is briefly gone; `revalidateServer` settles it.
        if (revalidating.current.has(profileId)) return;
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
      recoverSignIn,
      switcherOpen,
      setSwitcherOpen,
    }),
    [state, limit, open, show, hide, close, closeServer, reconnect, recoverSignIn, switcherOpen],
  );

  return <SessionsContext.Provider value={api}>{children}</SessionsContext.Provider>;
}
