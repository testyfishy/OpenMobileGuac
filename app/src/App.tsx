import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { parseAppLink } from './core/links/links.ts';
import { deliverSsoCallback } from './ui/auth/ssoFlow.ts';
import { BackupScreen } from './ui/backup/BackupScreen.tsx';
import { EmptyState } from './ui/components/Feedback.tsx';
import { ToastProvider } from './ui/components/Toast.tsx';
import { useToast } from './ui/components/toastContext.ts';
import { ConnectionsScreen } from './ui/connections/ConnectionsScreen.tsx';
import { DiagnosticsScreen } from './ui/diagnostics/DiagnosticsScreen.tsx';
import { deviceLanguages, resolveLocale } from './ui/i18n/locale.ts';
import { DEMO_PROFILE_ID } from './ui/integration/demoProfile.ts';
import { LaunchContext, type LaunchApi, type PendingLaunch } from './ui/launch/LaunchContext.ts';
import { LockGate } from './ui/lock/LockGate.tsx';
import { NavProvider } from './ui/nav/NavProvider.tsx';
import { useNav } from './ui/nav/NavContext.ts';
import type { Route } from './ui/nav/navigation.ts';
import { Onboarding } from './ui/onboarding/Onboarding.tsx';
import type { AppServices } from './ui/services/AppServices.ts';
import {
  ProfilesVersionContext,
  ServicesContext,
  SettingsContext,
  useAppSettings,
  useServices,
} from './ui/services/context.ts';
import { onAppUrlOpen } from './ui/services/native.ts';
import { ServerEditScreen } from './ui/servers/ServerEditScreen.tsx';
import { ServersScreen } from './ui/servers/ServersScreen.tsx';
import { SessionLayer } from './ui/sessions/SessionLayer.tsx';
import { useSessions } from './ui/sessions/SessionsContext.ts';
import { SessionsProvider } from './ui/sessions/SessionsProvider.tsx';
import type { AppSettings } from './ui/settings/settingsModel.ts';
import { SettingsScreen } from './ui/settings/SettingsScreen.tsx';
import { activeLocale, setActiveLocale, strings } from './ui/strings.ts';
import {
  applyTheme,
  matchesMedia,
  subscribeMedia,
  watchSystemTheme,
} from './ui/theme/applyTheme.ts';

/** Two-pane layout from this width (tablets, unfolded foldables). Keep in sync with index.css. */
const WIDE_QUERY = '(min-width: 700px)';

function useWide(): boolean {
  return useSyncExternalStore(
    (cb) => subscribeMedia(WIDE_QUERY, cb),
    () => matchesMedia(WIDE_QUERY),
    () => false,
  );
}

export default function App({
  services,
  initialSettings,
}: {
  services: AppServices;
  initialSettings: AppSettings;
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [profilesVersion, setProfilesVersion] = useState(0);

  // I18N-1: pick the table before any child renders; a change re-renders the whole tree.
  const locale = resolveLocale(settings.language, deviceLanguages());
  if (activeLocale() !== locale) setActiveLocale(locale);

  const update = useCallback(
    (next: AppSettings) => {
      setSettings(next);
      void services.settings.save(next);
    },
    [services.settings],
  );

  useEffect(() => {
    applyTheme(settings.theme, services.native);
    if (settings.theme !== 'system') return undefined;
    return watchSystemTheme(() => applyTheme('system', services.native));
  }, [settings.theme, services.native]);

  const settingsValue = useMemo(() => ({ settings, update }), [settings, update]);
  const versionValue = useMemo(
    () => ({ version: profilesVersion, bump: () => setProfilesVersion((v) => v + 1) }),
    [profilesVersion],
  );

  // Session DOM containers, for thumbnails.
  const slots = useRef(new Map<string, HTMLElement>());
  const slotFor = useCallback((id: string) => slots.current.get(id) ?? null, []);
  const registerSlot = useCallback((id: string, el: HTMLElement | null) => {
    if (el) slots.current.set(id, el);
    else slots.current.delete(id);
  }, []);

  // CON-5: connection to open once its server is signed in.
  const pending = useRef<PendingLaunch | undefined>(undefined);
  const [launchVersion, setLaunchVersion] = useState(0);
  const launch = useMemo<LaunchApi>(
    () => ({
      request: (p) => {
        pending.current = p;
        setLaunchVersion((v) => v + 1);
      },
      take: (serverId) => {
        const p = pending.current;
        if (!p || p.serverId !== serverId) return undefined;
        pending.current = undefined;
        return p;
      },
      peek: () => pending.current,
    }),
    // Recreated on each request so consumers re-check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [launchVersion],
  );

  return (
    <ServicesContext.Provider value={services}>
      <SettingsContext.Provider value={settingsValue}>
        <ProfilesVersionContext.Provider value={versionValue}>
          <ToastProvider>
            <LaunchContext.Provider value={launch}>
              <SessionsProvider slotFor={slotFor}>
                <NavWithSessions native={services.native}>
                  <Shell registerSlot={registerSlot} />
                </NavWithSessions>
              </SessionsProvider>
            </LaunchContext.Provider>
          </ToastProvider>
        </ProfilesVersionContext.Provider>
      </SettingsContext.Provider>
    </ServicesContext.Provider>
  );
}

function NavWithSessions({ native, children }: { native: boolean; children: ReactNode }) {
  const sessions = useSessions();
  const activeRef = useRef(sessions.state.activeId);
  useEffect(() => {
    activeRef.current = sessions.state.activeId;
  });
  const sessionVisible = useCallback(() => activeRef.current !== null, []);
  return (
    <NavProvider native={native} sessionVisible={sessionVisible}>
      {children}
    </NavProvider>
  );
}

function renderRoute(route: Route) {
  switch (route.name) {
    case 'servers':
      return <ServersScreen />;
    case 'server-edit':
      return <ServerEditScreen serverId={route.serverId} />;
    case 'connections':
      return <ConnectionsScreen serverId={route.serverId} />;
    case 'settings':
      return <SettingsScreen />;
    case 'backup':
      return <BackupScreen />;
    case 'diagnostics':
      return <DiagnosticsScreen />;
  }
}

/**
 * Renders the navigation stack plus the open sessions. Every stack entry stays mounted (so
 * going back keeps scroll position and state); only the visible ones are shown:
 * - phone: the top entry;
 * - wide: the server list on the left and the top entry on the right.
 * Open sessions are drawn above the stack by `SessionLayer`; while one is visible the app
 * chrome underneath is inert.
 */
function Shell({ registerSlot }: { registerSlot: (id: string, el: HTMLElement | null) => void }) {
  const { state } = useNav();
  const sessions = useSessions();
  const wide = useWide();
  const stack = state.stack;
  const inSession = sessions.state.activeId !== null;
  const className = [
    'shell',
    wide ? 'shell-wide' : 'shell-narrow',
    inSession ? 'shell-covered' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <>
      <div className={className} inert={inSession} aria-hidden={inSession}>
        {stack.map((entry, i) => {
          const isRoot = i === 0;
          const isTop = i === stack.length - 1;
          const visible = wide ? isRoot || isTop : isTop;
          const pane = isRoot ? 'pane-list' : 'pane-detail';
          return (
            <div key={entry.key} className={`pane ${pane}`} hidden={!visible}>
              {renderRoute(entry.route)}
            </div>
          );
        })}
        {wide && stack.length === 1 ? (
          <div className="pane pane-detail pane-placeholder">
            <EmptyState icon="server" title={strings.servers.selectPrompt} />
          </div>
        ) : null}
      </div>
      <SessionLayer registerSlot={registerSlot} />
      <DeepLinks />
      <FirstRun />
      <LockGate />
    </>
  );
}

/** CON-5 deep links and the SSO app callback, delivered through `appUrlOpen`. */
function DeepLinks() {
  const nav = useNav();
  const services = useServices();
  const toast = useToast();
  const sessions = useSessions();
  const launch = useContext(LaunchContext);
  const latest = useRef({ nav, services, toast, sessions, launch });
  useEffect(() => {
    latest.current = { nav, services, toast, sessions, launch };
  });
  useEffect(() => {
    const sub = onAppUrlOpen((url) => {
      const { nav: n, services: s, toast: t, sessions: ss, launch: l } = latest.current;
      const link = parseAppLink(url);
      if (!link) return;
      if (link.kind === 'sso-callback') {
        deliverSsoCallback(link.url);
        return;
      }
      s.log.info('app', 'deep link: connect');
      void (async () => {
        const known =
          link.serverId === DEMO_PROFILE_ID ||
          link.serverId === s.devServer?.profile.id ||
          (await s.profiles.get(link.serverId)) !== undefined;
        if (!known) {
          t.show(strings.connections.linkServerMissing);
          return;
        }
        ss.hide();
        l.request({
          serverId: link.serverId,
          identifier: link.identifier,
          dataSource: link.dataSource,
          type: link.type,
        });
        n.open({ name: 'connections', serverId: link.serverId });
      })();
    });
    return () => sub.dispose();
  }, []);
  return null;
}

function FirstRun() {
  const { settings, update } = useAppSettings();
  const nav = useNav();
  if (settings.onboardingDone) return null;
  const done = () => update({ ...settings, onboardingDone: true });
  return (
    <Onboarding
      onDone={done}
      onTryDemo={() => {
        done();
        nav.open({ name: 'connections', serverId: DEMO_PROFILE_ID });
      }}
      onAddServer={() => {
        done();
        nav.open({ name: 'server-edit' });
      }}
    />
  );
}
