import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { GuacAdminApi } from '../../core/api/GuacAdminApi.ts';
import type { AuthSession } from '../../core/models/AuthSession.ts';
import type { ServerProfile } from '../../core/models/ServerProfile.ts';
import type { RevalidateResult } from '../services/AuthService.ts';
import { DEMO_PROFILE_ID } from '../integration/demoProfile.ts';
import { adminStrings } from '../admin/adminStrings.ts';
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
import { onPipWindowChange, pipWindowActive as pipWindowActiveNow } from '../session/pipFeed.ts';
import {
  PAGE_STALL_MS,
  backgroundClockStart,
  pipWindowOnReturn,
  graceApplies,
  shouldSuspendInBackground,
  wantKeepAlive,
} from './backgroundPolicy.ts';
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
import { askInUseToStore, decideTap, liveInAppCount, planInUse, type InUsePlan } from './inUse.ts';
import { IN_USE_CHECK_TIMEOUT_MS, checkServerUse } from './inUseCheck.ts';

interface Pending {
  readonly serverId: string;
  readonly serverName: string;
  readonly target: SessionTarget;
  readonly suggest: OpenSession;
  readonly resumed: boolean;
}

/** "<name> is already open": waiting for Go to the open session / Open another. */
interface AskPending {
  readonly serverId: string;
  readonly serverName: string;
  readonly target: SessionTarget;
}

/** MUL-5 "<name> is already in use" (server-reported sessions), or the plain confirm. */
interface InUsePending {
  readonly serverId: string;
  readonly serverName: string;
  readonly target: SessionTarget;
  readonly session: AuthSession;
  readonly plan: Extract<InUsePlan, { kind: 'prompt' }>;
  /** When the server answered ("since 14:02" is relative to it). */
  readonly askedAt: number;
  readonly busy: boolean;
  readonly error: string | undefined;
}

interface ConfirmPending {
  readonly serverId: string;
  readonly serverName: string;
  readonly target: SessionTarget;
  readonly checked: boolean;
}

interface OpenOptions {
  /** "Open another": skip the open session (still respects the cap). */
  readonly forceNew?: boolean;
  /** The user already answered a question for this tap: never ask "in use" / "connect?". */
  readonly skipInUse?: boolean;
  /** Joining the user's own running session ("Open the existing one"). */
  readonly resumed?: boolean;
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
  const [inUse, setInUse] = useState<InUsePending | null>(null);
  const [confirmAsk, setConfirmAsk] = useState<ConfirmPending | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  // MUL-5: a short-timeout client for the check before connecting (never blocks for long).
  const checkApi = useMemo(
    () => new GuacAdminApi(services.http, { timeoutMs: IN_USE_CHECK_TIMEOUT_MS }),
    [services.http],
  );
  /** Targets whose in-use check is running: a second tap meanwhile does nothing. */
  const checking = useRef(new Set<string>());
  /** Bumped on every tap (`openWith`). */
  const tapSeq = useRef(0);
  const stateRef = useRef(state);
  const settingsRef = useRef(settings);
  useEffect(() => {
    stateRef.current = state;
    settingsRef.current = settings;
  });

  /**
   * Questions waiting for an answer leave with their server's sign-in: answered later, they
   * would open a session that has none.
   */
  const dropQuestions = useCallback((match: (serverId: string) => boolean) => {
    const keep = <T extends { readonly serverId: string }>(x: T | null) =>
      x !== null && match(x.serverId) ? null : x;
    setPending(keep);
    setAsk(keep);
    setInUse(keep);
    setConfirmAsk(keep);
  }, []);

  const openNow = useCallback(
    (serverId: string, serverName: string, target: SessionTarget, resumed = false) => {
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
          ...(resumed ? { resumed: true as const } : {}),
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
        else if (r === 'failed' && !services.auth.current(profile.id)) {
          // Network trouble after the token was dropped: a session mounted now would have no
          // sign-in. It stays disconnected; Reconnect tries again.
          haptic('error');
        }
        // 'failed' with the sign-in still there: reconnect anyway, the session screen shows
        // its own error and retry.
        else dispatch({ type: 'reconnect', id, now: Date.now() });
      })();
    },
    [findProfile, revalidateServer, services.auth, services.log],
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
      // Signed in again since its sign-in failed: the session reconnects instead of showing
      // "Sign in again".
      else if (s.state === 'reauth' && services.auth.current(s.serverId)) reconnect(id);
    },
    [reconnect, services.auth],
  );

  const openWith = useCallback(
    (serverId: string, serverName: string, target: SessionTarget, opts: OpenOptions = {}) => {
      const forceNew = opts.forceNew === true;
      const resumed = opts.resumed === true;
      const setting = settingsRef.current.askInUse;
      const session = services.auth.current(serverId);
      // One question per tap (decideTap): open in the app + "Go to" → silently; + Ask → only
      // the MUL-4 question; at the cap → only the cap question; then maybe the server's.
      const d = decideTap({
        state: stateRef.current,
        serverId,
        target,
        maxSessions: settingsRef.current.maxSessions,
        openAgain: settingsRef.current.openAgain,
        askInUse: setting,
        forceNew,
        skipInUse: opts.skipInUse === true,
        demo: serverId === DEMO_PROFILE_ID,
        shareLink: isShareServerId(serverId),
        signedIn: session !== undefined,
      });
      // The latest tap wins: an in-use answer for an earlier tap that comes back late is
      // dropped, so it never replaces a question already showing or opens a session behind
      // it. A repeated tap on the connection being checked is not a new tap (deduped below).
      if (d.kind !== 'check') tapSeq.current++;
      switch (d.kind) {
        case 'existing':
          goTo(d.id);
          return;
        case 'ask':
          setAsk({ serverId, serverName, target });
          return;
        case 'limit':
          setPending({ serverId, serverName, target, suggest: d.suggest, resumed });
          haptic('warning');
          return;
        case 'open':
          openNow(serverId, serverName, target, resumed);
          return;
        case 'confirm':
          setConfirmAsk({ serverId, serverName, target, checked: false });
          return;
        case 'check':
          break;
      }
      if (!session) return;
      const key = `${serverId}|${target.type}:${target.dataSource}:${target.identifier}`;
      if (checking.current.has(key)) return;
      checking.current.add(key);
      const seq = ++tapSeq.current;
      void checkServerUse(checkApi, session, target)
        .then((use) => {
          if (seq !== tapSeq.current) {
            services.log.info('session', 'in-use check: superseded by a later tap');
            return;
          }
          // Signed out while the server answered: a session opened now would have no sign-in.
          if (!services.auth.current(serverId)) return;
          const state = stateRef.current;
          const plan = planInUse({
            setting,
            use,
            username: session.username,
            liveInApp: liveInAppCount(state, serverId, target),
            inAppId: findOpenSession(state, serverId, target)?.id,
          });
          services.log.info(
            'session',
            `in-use check: ${use ? `${use.count} active` : 'no answer'} -> ${plan.kind}`,
          );
          if (plan.kind === 'connect') {
            // Re-decided: sessions may have opened or closed while the server answered.
            const again = decideOpen(
              state,
              serverId,
              target,
              settingsRef.current.maxSessions,
              openAgainFor(settingsRef.current.openAgain, target, false),
              forceNew,
            );
            if (again.kind === 'limit')
              setPending({ serverId, serverName, target, suggest: again.suggest, resumed });
            else if (again.kind === 'existing') goTo(again.id);
            // Opened meanwhile (a link, Admin › Sessions) and the setting is Ask: ask.
            else if (again.kind === 'ask') setAsk({ serverId, serverName, target });
            else openNow(serverId, serverName, target, resumed);
          } else if (plan.kind === 'confirm') {
            setConfirmAsk({ serverId, serverName, target, checked: plan.checked });
          } else {
            haptic('warning');
            setInUse({
              serverId,
              serverName,
              target,
              session,
              plan,
              askedAt: Date.now(),
              busy: false,
              error: undefined,
            });
          }
        })
        .finally(() => checking.current.delete(key));
    },
    [checkApi, goTo, openNow, services.auth, services.log],
  );

  const open = useCallback(
    (
      serverId: string,
      serverName: string,
      target: SessionTarget,
      options?: { readonly confirmed?: boolean },
    ) => openWith(serverId, serverName, target, { skipInUse: options?.confirmed === true }),
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

  /**
   * A session was mounted without a sign-in for its server: it turns into its "Sign in
   * again" card instead of a spinner that never ends (a later tap on the connection goes to
   * that card, not to the spinner). Not while that server's sign-in is being renewed
   * (`revalidateServer` settles it).
   */
  const needsSignIn = useCallback(
    (id: string) => {
      const s = stateRef.current.sessions.find((x) => x.id === id);
      if (!s || s.state !== 'live' || s.serverId === DEMO_PROFILE_ID) return;
      if (revalidating.current.has(s.serverId) || services.auth.current(s.serverId)) return;
      dispatch({ type: 'reauth', id });
    },
    [services.auth],
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
  // keep-alive service running, or while a Picture in Picture window is up, the clocks do
  // not run; after the window closes they count from then (`backgroundClockStart`).
  useEffect(() => {
    /** When the app left (null: in the foreground). */
    let awaySince: number | null = null;
    let tentative = false;
    /** When the Picture in Picture window closed during this trip away. */
    let pipClosedAt: number | null = null;
    let signedOutThisTrip = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let signOutTimer: ReturnType<typeof setTimeout> | undefined;
    // Away heartbeat: a long gap between ticks means iOS froze the page, so the window state
    // may be stale on return (`pipWindowOnReturn`).
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let lastTick = 0;
    let stalledFrom: number | null = null;
    let windowKnownClosed = false;
    const noteTick = () => {
      const now = Date.now();
      if (lastTick > 0 && now - lastTick > PAGE_STALL_MS) stalledFrom ??= lastTick;
      lastTick = now;
    };
    const pipWindowActive = () => !windowKnownClosed && pipWindowActiveNow();
    const clockStart = () =>
      backgroundClockStart({ awaySince, pipWindowUp: pipWindowActive(), pipClosedAt });
    const suspendIfDue = () => {
      const grace = settingsRef.current.backgroundDisconnectSeconds;
      const due = shouldSuspendInBackground({
        backgroundedAt: clockStart(),
        now: Date.now(),
        graceSeconds: grace,
        keepAliveRunning: keepAliveRunning(),
        pipWindowUp: pipWindowActive(),
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
      if (signedOutThisTrip) return;
      const afterSeconds = settingsRef.current.serverSignOutAfterSeconds;
      if (
        !shouldSignOutAfterBackground({
          afterSeconds,
          backgroundedAt: clockStart(),
          now: Date.now(),
          keepAliveRunning: keepAliveRunning(),
          pipWindowUp: pipWindowActive(),
        })
      ) {
        return;
      }
      signedOutThisTrip = true;
      services.log.info('session', 'background sign-out time over: signing out of servers');
      const all = stateRef.current.sessions;
      for (const s of all) {
        if (s.serverId !== DEMO_PROFILE_ID) dispatch({ type: 'close', id: s.id });
      }
      if (all.every((s) => s.serverId !== DEMO_PROFILE_ID)) setSwitcherOpen(false);
      dropQuestions((id) => id !== DEMO_PROFILE_ID);
      void services.auth.signOutAfterBackground();
    };
    const clearTimers = () => {
      clearTimeout(timer);
      clearTimeout(signOutTimer);
      timer = undefined;
      signOutTimer = undefined;
    };
    const armTimers = () => {
      clearTimers();
      // No timers while a prompt is open: that pause is most likely the prompt's.
      if (tentative) return;
      const from = clockStart();
      if (from === null) return;
      const grace = settingsRef.current.backgroundDisconnectSeconds;
      if (
        graceApplies({
          graceSeconds: grace,
          keepAliveRunning: keepAliveRunning(),
          pipWindowUp: pipWindowActive(),
        }) &&
        grace !== null
      ) {
        timer = setTimeout(suspendIfDue, Math.max(0, from + grace * 1000 - Date.now()) + 50);
      }
      // After a Picture in Picture window the page is known to run in the background: the
      // sign-out is then due there too. Otherwise it is decided on return, as before.
      const after = settingsRef.current.serverSignOutAfterSeconds;
      if (pipClosedAt !== null && after !== null) {
        signOutTimer = setTimeout(signOutIfDue, Math.max(0, from + after * 1000 - Date.now()) + 50);
      }
    };
    const offPip = onPipWindowChange((up) => {
      if (awaySince === null) return;
      if (!up) {
        pipClosedAt = Date.now();
        // The persisted clock moves with it (checked at start-up if the app is ended).
        if (settingsRef.current.serverSignOutAfterSeconds !== null) {
          services.backgroundClock.note(pipClosedAt);
        }
      }
      armTimers();
    });
    // The biometric prompt itself can pause/resume the app (appAwayTracker.ts).
    const away = new AppAwayTracker(services.lock);
    const sub = onAppActiveChange((active) => {
      const change = away.change(active);
      if (change.kind === 'ignore') return;
      if (change.kind === 'away') {
        awaySince = change.at;
        tentative = change.tentative;
        pipClosedAt = null;
        signedOutThisTrip = false;
        stalledFrom = null;
        windowKnownClosed = false;
        lastTick = change.at;
        clearInterval(heartbeat);
        heartbeat = setInterval(noteTick, 1000);
        // Persisted too: the system may end the app while it is away (checked at start-up).
        if (settingsRef.current.serverSignOutAfterSeconds !== null) {
          services.backgroundClock.note(change.at);
        }
        armTimers();
      } else {
        clearTimers();
        clearInterval(heartbeat);
        heartbeat = undefined;
        noteTick();
        awaySince = change.awaySince;
        tentative = false;
        const seen = pipWindowOnReturn({
          pipWindowUp: pipWindowActiveNow(),
          pipClosedAt,
          stalledFrom,
        });
        pipClosedAt = seen.pipClosedAt;
        windowKnownClosed = !seen.pipWindowUp;
        signOutIfDue();
        suspendIfDue();
        awaySince = null;
        pipClosedAt = null;
        windowKnownClosed = false;
        services.backgroundClock.clear();
      }
    });
    return () => {
      clearTimers();
      clearInterval(heartbeat);
      offPip();
      sub.dispose();
    };
  }, [services.lock, services.log, services.auth, services.backgroundClock, dropQuestions]);

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
        dropQuestions((id) => id === profileId);
      }),
    [services.auth, dropQuestions],
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
              openNow(pending.serverId, pending.serverName, pending.target, pending.resumed);
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
      // Already asked once for this tap: no server "in use" question after it.
      else openWith(ask.serverId, ask.serverName, ask.target, { forceNew: true, skipInUse: true });
    };
    return {
      name: ask.target.name,
      goToOpen: (dontAskAgain: boolean) => answer('switch', dontAskAgain),
      openAnother: (dontAskAgain: boolean) => answer('new', dontAskAgain),
      cancel: () => setAsk(null),
    };
  }, [ask, goTo, openWith, updateSettings]);

  const storeAskInUse = useCallback(
    (answer: Parameters<typeof askInUseToStore>[0], dontAskAgain: boolean) => {
      const store = askInUseToStore(answer, dontAskAgain);
      if (store !== null) updateSettings({ ...settingsRef.current, askInUse: store });
    },
    [updateSettings],
  );

  const inUseApi = useMemo(() => {
    if (!inUse) return null;
    const { serverId, serverName, target, plan } = inUse;
    const fresh = () => openWith(serverId, serverName, target, { forceNew: true, skipInUse: true });
    return {
      name: target.name,
      plan,
      askedAt: inUse.askedAt,
      busy: inUse.busy,
      error: inUse.error,
      openExisting: (dontAskAgain: boolean) => {
        const existing = plan.existing;
        if (!existing) return;
        setInUse(null);
        storeAskInUse('existing', dontAskAgain);
        if (existing.kind === 'switch') {
          // Re-resolved: it may have closed while the question was showing.
          const s = findOpenSession(stateRef.current, serverId, target);
          if (s) goTo(s.id);
          else fresh();
          return;
        }
        services.log.info(
          'session',
          `in use: joining ${existing.own ? 'the own' : 'another user’s'} running session`,
        );
        // The user's own session then stands for the connection ("resumed"); someone else's
        // is a join like the administrator's Join, named after that user.
        openWith(
          serverId,
          serverName,
          {
            ...target,
            join: existing.activeId,
            ...(existing.own
              ? {}
              : {
                  name: adminStrings.sessions.joinedName(
                    target.name,
                    existing.username || adminStrings.sessions.anonymous,
                  ),
                }),
          },
          { skipInUse: true, resumed: existing.own },
        );
      },
      endAndStart: (dontAskAgain: boolean) => {
        if (plan.end.length === 0) return;
        // Only this question: never a later one that took its place.
        const askedAt = inUse.askedAt;
        const mine = (cur: InUsePending | null) => cur !== null && cur.askedAt === askedAt;
        setInUse({ ...inUse, busy: true, error: undefined });
        // The current sign-in: it may have been renewed since the server was asked.
        const session = services.auth.current(serverId) ?? inUse.session;
        // Only the active connections listed in the plan: the user's own ones on this
        // connection (or, for an administrator, the ones shown), never anything else.
        void services.admin.killActiveConnections(session, target.dataSource, plan.end).then(
          () => {
            services.log.info('session', `in use: ended ${plan.end.length} session(s)`);
            setInUse((cur) => (mine(cur) ? null : cur));
            storeAskInUse('end', dontAskAgain);
            fresh();
          },
          async () => {
            haptic('error');
            // Some may have ended already, or the list changed: ask the server again, so a
            // retry sends what is still running.
            const use = await checkServerUse(checkApi, session, target).catch(() => undefined);
            const state = stateRef.current;
            const again = use
              ? planInUse({
                  setting: settingsRef.current.askInUse,
                  use,
                  username: session.username,
                  liveInApp: liveInAppCount(state, serverId, target),
                  inAppId: findOpenSession(state, serverId, target)?.id,
                })
              : undefined;
            setInUse((cur) =>
              mine(cur) && cur
                ? {
                    ...cur,
                    session,
                    ...(again?.kind === 'prompt' ? { plan: again } : {}),
                    busy: false,
                    error: strings.session.inUseEndFailed,
                  }
                : cur,
            );
          },
        );
      },
      openAnother: (dontAskAgain: boolean) => {
        setInUse(null);
        storeAskInUse('another', dontAskAgain);
        fresh();
      },
      cancel: () => {
        if (!inUse.busy) setInUse(null);
      },
    };
  }, [inUse, checkApi, goTo, openWith, services.admin, services.auth, services.log, storeAskInUse]);

  const connectConfirm = useMemo(() => {
    if (!confirmAsk) return null;
    const { serverId, serverName, target } = confirmAsk;
    return {
      name: target.name,
      checked: confirmAsk.checked,
      connect: (dontAskAgain: boolean) => {
        setConfirmAsk(null);
        storeAskInUse('connect', dontAskAgain);
        openWith(serverId, serverName, target, { skipInUse: true });
      },
      cancel: () => setConfirmAsk(null),
    };
  }, [confirmAsk, openWith, storeAskInUse]);

  const api = useMemo<SessionsApi>(
    () => ({
      state,
      limit,
      alreadyOpen,
      inUse: inUseApi,
      connectConfirm,
      open,
      show,
      hide,
      close,
      closeServer,
      closeAll,
      reconnect,
      recoverSignIn,
      needsSignIn,
      switcherOpen,
      setSwitcherOpen,
    }),
    [
      state,
      limit,
      alreadyOpen,
      inUseApi,
      connectConfirm,
      open,
      show,
      hide,
      close,
      closeServer,
      closeAll,
      reconnect,
      recoverSignIn,
      needsSignIn,
      switcherOpen,
    ],
  );

  return <SessionsContext.Provider value={api}>{children}</SessionsContext.Provider>;
}
