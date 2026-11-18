import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ConnectionsScreen } from './ui/connections/ConnectionsScreen.tsx';
import { EmptyState } from './ui/components/Feedback.tsx';
import { SessionHost } from './ui/launch/SessionHost.tsx';
import { NavProvider } from './ui/nav/NavProvider.tsx';
import { useNav } from './ui/nav/NavContext.ts';
import type { Route } from './ui/nav/navigation.ts';
import type { AppServices } from './ui/services/AppServices.ts';
import { ProfilesVersionContext, ServicesContext, SettingsContext } from './ui/services/context.ts';
import { ServerEditScreen } from './ui/servers/ServerEditScreen.tsx';
import { ServersScreen } from './ui/servers/ServersScreen.tsx';
import type { AppSettings } from './ui/settings/settingsModel.ts';
import { SettingsScreen } from './ui/settings/SettingsScreen.tsx';
import { strings } from './ui/strings.ts';
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

  return (
    <ServicesContext.Provider value={services}>
      <SettingsContext.Provider value={settingsValue}>
        <ProfilesVersionContext.Provider value={versionValue}>
          <NavProvider native={services.native}>
            <Shell />
          </NavProvider>
        </ProfilesVersionContext.Provider>
      </SettingsContext.Provider>
    </ServicesContext.Provider>
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
    case 'session':
      return <SessionHost serverId={route.serverId} target={route.target} />;
  }
}

/**
 * Renders the navigation stack. Every entry stays mounted (so going back keeps scroll
 * position and state); only the visible ones are shown:
 * - phone: the top entry;
 * - wide: the server list on the left and the top entry on the right;
 * - session: the session alone, full screen.
 */
function Shell() {
  const { state } = useNav();
  const wide = useWide();
  const stack = state.stack;
  const top = stack[stack.length - 1];
  const inSession = top?.route.name === 'session';
  const className = [
    'shell',
    wide ? 'shell-wide' : 'shell-narrow',
    inSession ? 'shell-session' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={className}>
      {stack.map((entry, i) => {
        const isRoot = i === 0;
        const isTop = i === stack.length - 1;
        const visible = inSession ? isTop : wide ? isRoot || isTop : isTop;
        const pane =
          entry.route.name === 'session' ? 'pane-session' : isRoot ? 'pane-list' : 'pane-detail';
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
  );
}
