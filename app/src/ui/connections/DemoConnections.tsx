import { useState } from 'react';
import { InfoBanner } from '../components/Feedback.tsx';
import { Screen } from '../components/Screen.tsx';
import { DEMO_CONNECTION_TREE, DEMO_PROFILE_ID } from '../integration/demoProfile.ts';
import { useNav } from '../nav/NavContext.ts';
import { strings } from '../strings.ts';
import { ConnectionsPanel } from './ConnectionsPanel.tsx';
import { SearchBox } from './SearchBox.tsx';
import { SortMenu } from './SortMenu.tsx';

/**
 * The built-in Demo server's connections. Entirely local: no sign-in and no network; the
 * session runs against the in-app `DemoTunnel`. Favourites/recents use local storage only.
 */
export function DemoConnections() {
  const nav = useNav();
  const [query, setQuery] = useState('');
  return (
    <Screen
      title={strings.servers.demoName}
      onBack={nav.back}
      toolbar={
        <div className="toolbar-row">
          <SearchBox value={query} onChange={setQuery} />
          <SortMenu />
        </div>
      }
    >
      <InfoBanner icon="play">{strings.connections.demoNotice}</InfoBanner>
      <ConnectionsPanel
        serverId={DEMO_PROFILE_ID}
        serverName={strings.servers.demoName}
        tree={DEMO_CONNECTION_TREE}
        query={query}
        flat
      />
    </Screen>
  );
}
