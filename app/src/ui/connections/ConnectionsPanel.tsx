import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Connection, ConnectionGroup, ConnectionTree } from '../../core/models/Connection.ts';
import type { ConnectionRef, RecentEntry } from '../../core/storage/ProfileStore.ts';
import { useToast } from '../components/toastContext.ts';
import { useConsumePendingLaunch, useLaunch, type PendingLaunch } from '../launch/LaunchContext.ts';
import type { SessionTarget } from '../nav/navigation.ts';
import { useAppSettings, useServices } from '../services/context.ts';
import { haptic } from '../services/native.ts';
import { liveInAppCounts } from '../sessions/inUse.ts';
import { openTargetKeys } from '../sessions/sessionModel.ts';
import { useSessions } from '../sessions/SessionsContext.ts';
import type { ConnectionSort } from '../settings/settingsModel.ts';
import { strings } from '../strings.ts';
import { ConnectionBrowser } from './ConnectionBrowser.tsx';
import { ConnectionDetails } from './ConnectionDetails.tsx';
import { refKey, refOf, targetOf, targetOfGroup, type ConnectionMatch } from './treeView.ts';

/**
 * Everything below the search box for one server's tree: favourites, recents with
 * thumbnails, sort, details sheet, opening sessions (MUL-1) and pending deep links (CON-5).
 * Shared by real servers and the Demo.
 */
export function ConnectionsPanel({
  serverId,
  serverName,
  tree,
  query,
  flat,
}: {
  serverId: string;
  serverName: string;
  tree: ConnectionTree;
  query: string;
  flat?: boolean;
}) {
  const services = useServices();
  const { settings } = useAppSettings();
  const sessions = useSessions();
  const toast = useToast();
  const { profiles } = services;
  const [favourites, setFavourites] = useState<ConnectionRef[]>([]);
  const [recents, setRecents] = useState<RecentEntry[]>([]);
  const [thumbs, setThumbs] = useState<ReadonlyMap<string, string>>(new Map());
  const [details, setDetails] = useState<ConnectionMatch | null>(null);
  const [localVersion, setLocalVersion] = useState(0);

  useEffect(() => {
    let live = true;
    void Promise.all([profiles.listFavourites(serverId), profiles.listRecents(serverId)]).then(
      async ([f, r]) => {
        if (!live) return;
        setFavourites(f);
        setRecents(r);
        if (!settings.thumbnails) {
          setThumbs(new Map());
          return;
        }
        const entries = await Promise.all(
          r
            .slice(0, 8)
            .map(
              async (e) =>
                [refKey(e.ref), (await profiles.getThumbnail(serverId, e.ref))?.dataUrl] as const,
            ),
        );
        if (live)
          setThumbs(new Map(entries.filter((e): e is [string, string] => e[1] !== undefined)));
      },
    );
    return () => {
      live = false;
    };
    // Reload when sessions open, close or are hidden (new recents and thumbnails).
  }, [
    profiles,
    serverId,
    settings.thumbnails,
    localVersion,
    sessions.state.sessions.length,
    sessions.state.activeId,
  ]);

  const lastUsed = useMemo(() => new Map(recents.map((e) => [refKey(e.ref), e.at])), [recents]);
  const openKeys = useMemo(
    () => openTargetKeys(sessions.state, serverId),
    [sessions.state, serverId],
  );
  const liveCounts = useMemo(
    () => liveInAppCounts(sessions.state, serverId),
    [sessions.state, serverId],
  );

  const openTarget = useCallback(
    (t: SessionTarget, launched?: PendingLaunch) => {
      void profiles
        .recordRecent(
          serverId,
          { dataSource: t.dataSource, identifier: t.identifier, type: t.type },
          Date.now(),
          {
            name: t.name,
            protocol: t.protocol,
          },
        )
        .then(() => setLocalVersion((v) => v + 1));
      sessions.open(serverId, serverName, t, { confirmed: launched?.confirmed === true });
    },
    [profiles, serverId, serverName, sessions],
  );

  const onConnect = (c: Connection) => openTarget(targetOf(c));
  const onConnectGroup = (g: ConnectionGroup) => openTarget(targetOfGroup(g));

  const onToggleFavourite = (c: Connection, fav: boolean) => {
    haptic('light');
    void profiles.setFavourite(serverId, refOf(c), fav).then(() => setLocalVersion((v) => v + 1));
  };

  const launch = useLaunch();
  useConsumePendingLaunch(
    serverId,
    tree,
    openTarget,
    () => toast.show(strings.connections.linkConnectionMissing),
    launch.peek() ? 1 : 0,
  );

  const sort: ConnectionSort = settings.connectionSort;
  const favKeys = new Set(favourites.map(refKey));

  return (
    <>
      <ConnectionBrowser
        tree={tree}
        query={query}
        favourites={favourites}
        recents={recents.map((e) => e.ref)}
        onConnect={onConnect}
        onConnectGroup={onConnectGroup}
        onToggleFavourite={onToggleFavourite}
        onDetails={setDetails}
        sort={sort}
        lastUsed={lastUsed}
        openKeys={openKeys}
        liveCounts={liveCounts}
        thumbnails={thumbs}
        flat={flat}
      />
      {details ? (
        <ConnectionDetails
          serverId={serverId}
          match={details}
          favourite={favKeys.has(refKey(refOf(details.connection)))}
          lastUsed={lastUsed.get(refKey(refOf(details.connection)))}
          thumbnail={thumbs.get(refKey(refOf(details.connection)))}
          onConnect={() => {
            setDetails(null);
            onConnect(details.connection);
          }}
          onToggleFavourite={(fav) => onToggleFavourite(details.connection, fav)}
          onClose={() => setDetails(null)}
        />
      ) : null}
    </>
  );
}
