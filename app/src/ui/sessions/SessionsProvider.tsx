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
import { AppAwayTracker } from '../lock/appAwayTracker.ts';
import type { SessionTarget } from '../nav/navigation.ts';
import { useAppSettings, useServices } from '../services/context.ts';
import {
  isAndroid,
  keepAliveRunning,
  onDisconnectAllPressed,
  startOrUpdateKeepAlive,
  stopKeepAlive,
} from '../services/keepAlive.ts';
import { haptic, onAppActiveChange, platformName } from '../services/native.ts';
import { strings } from '../strings.ts';
import { graceApplies, shouldSuspendInBackground, wantKeepAlive } from './backgroundPolicy.ts';
import { isInsecureUrl } from '../servers/serverForm.ts';
import { parseServerOptions } from '../settings/settingsModel.ts';
import { seedPolicy } from '../servers/seedPolicy.ts';
import { isShareServerId } from '../services/shareSessions.ts';
import {
  INITIAL_SESSIONS,
  decideAuthRecovery,
  decideOpen,
  findOpenSession,
  openAgainFor,
  openAgainToStore,
  sessionsReducer,
  shouldSignOutAfterBackground,
  type OpenSession,
} from './sessionModel.ts';
import { SessionsContext, type SessionsApi } from './SessionsContext.ts';

interface Pending {
  readonly serverId: string;
  readonly serverName: string;
  readonly target: SessionTarget;
  readonly suggest: OpenSession;
}

/** "<name> is already open": waiting for Go to the open session / Open another. */
interface AskPending {
  readonly serverId: string;
  readonly serverName: string;
  readonly target: SessionTarget;
}

/**
 * Owns the open sessions (MUL-1) and their lifecycle (T2.1): disconnect after the
 * background grace period, reconnect with re-validated sign-in, thumbnails (CON-4).
 * Rendering of the sessions themselves is `SessionLayer`.
 */
export function SessionsProvider({ children }: { children: ReactNode }) {
  const services = useServices();
  const { settings, update: updateSettings } = useAppSettings();
  const [state, dispatch] = useReducer(sessionsReducer, INITIAL_SESSIONS);
  const [pending, setPending] = useState<Pending | null>(null);
  const [ask, setAsk] = useState<AskPending | null>(null);
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

  const closeAll = useCallback(() => {
    for (const s of stateRef.current.sessions) dispatch({ type: 'close', id: s.id });
    setSwitcherOpen(false);
    services.log.info('session', 'closed all sessions');
  }, [services.log]);

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

  /**
   * Goes to an open session as the switcher does; a session disconnected in the background
   * reconnects at once (re-validating the sign-in first). One whose sign-in failed shows its
   * "Sign in again" card.
   */
  const goTo = useCallback(
    (id: string) => {
      const s = stateRef.current.sessions.find((x) => x.id === id);
      if (!s) return;
      dispatch({ type: 'show', id, now: Date.now() });
      setSwitcherOpen(false);
      if (s.state === 'suspended') reconnect(id);
    },
    [reconnect],
  );

  const openWith = useCallback(
    (serverId: string, serverName: string, target: SessionTarget, forceNew: boolean) => {
      const policy = openAgainFor(settingsRef.current.openAgain, target, isShareServerId(serverId));
      const d = decideOpen(
        stateRef.current,
        serverId,
        target,
        settingsRef.current.maxSessions,
        policy,
        forceNew,
      );
      if (d.kind === 'existing') {
        goTo(d.id);
        return;
      }
      if (d.kind === 'ask') {
        setAsk({ serverId, serverName, target });
        return;
      }
      if (d.kind === 'limit') {
        setPending({ serverId, serverName, target, suggest: d.suggest });
        haptic('warning');
        return;
      }
      openNow(serverId, serverName, target);
    },
    [goTo, openNow],
  );

  const open = useCallback(
    (serverId: string, serverName: string, target: SessionTarget) =>
      openWith(serverId, serverName, target, false),
    [openWith],
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

  // ---- Android keep-alive: a foreground service while at least one session is live and
  // "Keep sessions connected in the background" is on. Started and updated while the app is
  // visible (sessions open in the foreground); stopped when the last session closes.
  const liveCount = state.sessions.filter((s) => s.state === 'live').length;
  const keepAliveWanted = wantKeepAlive({
    platform: isAndroid() ? 'android' : platformName() === 'ios' ? 'ios' : 'web',
    enabled: settings.keepAliveBackground,
    liveSessions: liveCount,
  });
  useEffect(() => {
    if (!keepAliveWanted) {
      void stopKeepAlive();
      return;
    }
    const t = strings.settings;
    void startOrUpdateKeepAlive({
      title: t.notifTitle(liveCount),
      body: t.notifBody,
      disconnectAll: t.notifDisconnectAll,
      channelName: t.channelName,
      channelDescription: t.channelDescription,
    }).then((ok) =>
      services.log.info('session', `keep-alive service ${ok ? 'running' : 'failed to start'}`),
    );
  }, [keepAliveWanted, liveCount, services.log]);
  useEffect(() => () => void stopKeepAlive(), []);
  useEffect(() => {
    const sub = onDisconnectAllPressed(() => closeAll());
    return () => sub.dispose();
  }, [closeAll]);

  // ---- T2.1 lifecycle: grace timer (best effort) plus a timestamp check on return. With the
  // keep-alive service running, the timer does not disconnect.
  useEffect(() => {
    let backgroundedAt: number | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const suspendIfDue = () => {
      const grace = settingsRef.current.backgroundDisconnectSeconds;
      const due = shouldSuspendInBackground({
        backgroundedAt,
        now: Date.now(),
        graceSeconds: grace,
        keepAliveRunning: keepAliveRunning(),
      });
      if (!due) return;
      if (stateRef.current.sessions.some((s) => s.state === 'live')) {
        services.log.info('session', 'background grace period over: disconnecting sessions');
        dispatch({ type: 'suspend-all' });
      }
    };
    // "Sign out of servers after …": decided from the timestamp on return. The sessions close
    // and the in-memory sign-ins are dropped synchronously, before a resumed session can
    // reconnect with the old token.
    const signOutIfDue = () => {
      const afterSeconds = settingsRef.current.serverSignOutAfterSeconds;
      if (
        !shouldSignOutAfterBackground({
          afterSeconds,
          backgroundedAt,
          now: Date.now(),
          keepAliveRunning: keepAliveRunning(),
        })
      ) {
        return;
      }
      services.log.info('session', 'background sign-out time over: signing out of servers');
      const all = stateRef.current.sessions;
      for (const s of all) {
        if (s.serverId !== DEMO_PROFILE_ID) dispatch({ type: 'close', id: s.id });
      }
      if (all.every((s) => s.serverId !== DEMO_PROFILE_ID)) setSwitcherOpen(false);
      void services.auth.signOutAfterBackground();
    };
    // The biometric prompt itself can pause/resume the app (appAwayTracker.ts).
    const away = new AppAwayTracker(services.lock);
    const sub = onAppActiveChange((active) => {
      const change = away.change(active);
      if (change.kind === 'ignore') return;
      if (change.kind === 'away') {
        backgroundedAt = change.at;
        // Persisted too: the system may end the app while it is away (checked at start-up).
        if (settingsRef.current.serverSignOutAfterSeconds !== null) {
          services.backgroundClock.note(backgroundedAt);
        }
        // No grace timer while a prompt is open: that pause is most likely the prompt's.
        const grace = settingsRef.current.backgroundDisconnectSeconds;
        if (
          !change.tentative &&
          graceApplies({ graceSeconds: grace, keepAliveRunning: keepAliveRunning() }) &&
          grace !== null
        ) {
          timer = setTimeout(suspendIfDue, grace * 1000 + 50);
        }
      } else {
        clearTimeout(timer);
        backgroundedAt = change.awaySince;
        signOutIfDue();
        suspendIfDue();
        backgroundedAt = null;
        services.backgroundClock.clear();
      }
    });
    return () => {
      clearTimeout(timer);
      sub.dispose();
    };
  }, [services.lock, services.log, services.auth, services.backgroundClock]);

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

  const alreadyOpen = useMemo(() => {
    if (!ask) return null;
    const answer = (choice: 'switch' | 'new', dontAskAgain: boolean) => {
      setAsk(null);
      const store = openAgainToStore(choice, dontAskAgain);
      if (store !== null) updateSettings({ ...settingsRef.current, openAgain: store });
      // Re-resolved now: the session may have closed while the question was showing.
      const existing = findOpenSession(stateRef.current, ask.serverId, ask.target);
      if (choice === 'switch' && existing) goTo(existing.id);
      else openWith(ask.serverId, ask.serverName, ask.target, true);
    };
    return {
      name: ask.target.name,
      goToOpen: (dontAskAgain: boolean) => answer('switch', dontAskAgain),
      openAnother: (dontAskAgain: boolean) => answer('new', dontAskAgain),
      cancel: () => setAsk(null),
    };
  }, [ask, goTo, openWith, updateSettings]);

  const api = useMemo<SessionsApi>(
    () => ({
      state,
      limit,
      alreadyOpen,
      open,
      show,
      hide,
      close,
      closeServer,
      closeAll,
      reconnect,
      recoverSignIn,
      switcherOpen,
      setSwitcherOpen,
    }),
    [
      state,
      limit,
      alreadyOpen,
      open,
      show,
      hide,
      close,
      closeServer,
      closeAll,
      reconnect,
      recoverSignIn,
      switcherOpen,
    ],
  );

  return <SessionsContext.Provider value={api}>{children}</SessionsContext.Provider>;
}
