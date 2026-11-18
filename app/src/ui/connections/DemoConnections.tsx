import { useCallback, useEffect, useState } from 'react';
import type { Connection } from '../../core/models/Connection.ts';
import type { ConnectionRef } from '../../core/storage/ProfileStore.ts';
import { InfoBanner } from '../components/Feedback.tsx';
import { Screen } from '../components/Screen.tsx';
import { DEMO_CONNECTION_TREE, DEMO_PROFILE_ID } from '../integration/demo.ts';
import { useNav } from '../nav/NavContext.ts';
import { useServices } from '../services/context.ts';
import { strings } from '../strings.ts';
import { ConnectionBrowser } from './ConnectionBrowser.tsx';
import { SearchBox } from './SearchBox.tsx';
import { refOf } from './treeView.ts';

/**
 * The built-in Demo server's connections. Entirely local: no sign-in and no network; the
 * session runs against the in-app `DemoTunnel`. Favourites/recents use local storage only.
 */
export function DemoConnections() {
  const nav = useNav();
  const { profiles } = useServices();
  const [query, setQuery] = useState('');
  const [favourites, setFavourites] = useState<ConnectionRef[]>([]);
  const [recents, setRecents] = useState<ConnectionRef[]>([]);

  const loadLocal = useCallback(async () => {
    const [f, r] = await Promise.all([
      profiles.listFavourites(DEMO_PROFILE_ID),
      profiles.listRecents(DEMO_PROFILE_ID),
    ]);
    setFavourites(f);
    setRecents(r.map((e) => e.ref));
  }, [profiles]);

  useEffect(() => {
    let live = true;
    void Promise.all([
      profiles.listFavourites(DEMO_PROFILE_ID),
      profiles.listRecents(DEMO_PROFILE_ID),
    ]).then(([f, r]) => {
      if (!live) return;
      setFavourites(f);
      setRecents(r.map((e) => e.ref));
    });
    return () => {
      live = false;
    };
  }, [profiles]);

  const onConnect = (c: Connection) => {
    void profiles.recordRecent(DEMO_PROFILE_ID, refOf(c));
    nav.push({
      name: 'session',
      serverId: DEMO_PROFILE_ID,
      target: {
        dataSource: c.dataSource,
        identifier: c.identifier,
        type: 'c',
        name: c.name,
        protocol: c.protocol,
      },
    });
  };

  return (
    <Screen
      title={strings.servers.demoName}
      onBack={nav.back}
      toolbar={<SearchBox value={query} onChange={setQuery} />}
    >
      <InfoBanner icon="play">{strings.connections.demoNotice}</InfoBanner>
      <ConnectionBrowser
        tree={DEMO_CONNECTION_TREE}
        query={query}
        favourites={favourites}
        recents={recents}
        onConnect={onConnect}
        onToggleFavourite={(c, fav) =>
          void profiles.setFavourite(DEMO_PROFILE_ID, refOf(c), fav).then(loadLocal)
        }
        flat
      />
    </Screen>
  );
}
