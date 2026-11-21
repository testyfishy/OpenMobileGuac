import { useEffect, useState } from 'react';
import type { RecentEntry } from '../../core/storage/ProfileStore.ts';
import { Icon } from '../components/Icon.tsx';
import { InUseBadge, OpenBadge } from '../connections/ConnectionBrowser.tsx';
import { isShareServerId } from '../services/shareSessions.ts';
import { liveInAppCount, serverOnlyCount } from '../sessions/inUse.ts';
import { IN_USE_CHECK_TIMEOUT_MS } from '../sessions/inUseCheck.ts';
import { protocolIcon, protocolLabel } from '../connections/treeView.ts';
import type { SessionTarget } from '../nav/navigation.ts';
import { DEMO_PROFILE_ID } from '../integration/demoProfile.ts';
import { useLaunch } from '../launch/LaunchContext.ts';
import { useNav } from '../nav/NavContext.ts';
import { useAppSettings, useProfilesVersion, useServices } from '../services/context.ts';
import { findOpenSession } from '../sessions/sessionModel.ts';
import { useSessions } from '../sessions/SessionsContext.ts';
import { demoVisible } from '../settings/settingsModel.ts';
import { strings } from '../strings.ts';
import { hostOf } from './serverForm.ts';

interface QuickItem {
  readonly serverId: string;
  readonly serverName: string;
  readonly entry: RecentEntry;
  readonly thumb: string | undefined;
}

const SHOWN = 4;

const itemKey = (i: QuickItem) =>
  `${i.serverId}:${i.entry.ref.type}:${i.entry.ref.dataSource}:${i.entry.ref.identifier}`;

/** "Jump back in": the most recent connections across all servers, on the first screen. */
export function QuickConnect() {
  const services = useServices();
  const { settings } = useAppSettings();
  const { version } = useProfilesVersion();
  const nav = useNav();
  const launch = useLaunch();
  const sessions = useSessions();
  const [items, setItems] = useState<QuickItem[]>([]);
  const sessionCount = sessions.state.sessions.length;
  const activeId = sessions.state.activeId;

  useEffect(() => {
    let live = true;
    void (async () => {
      const saved = await services.profiles.list();
      const servers = [
        ...(demoVisible(settings.showDemo, saved.length)
          ? [{ id: DEMO_PROFILE_ID, name: strings.servers.demoName }]
          : []),
        ...(services.devServer
          ? [{ id: services.devServer.profile.id, name: strings.servers.devName }]
          : []),
        ...saved.map((p) => ({
          id: p.id,
          name: p.name || hostOf(p.baseUrl),
        })),
      ];
      const all: QuickItem[] = [];
      for (const s of servers) {
        for (const entry of (await services.profiles.listRecents(s.id)).slice(0, SHOWN)) {
          if (entry.name === undefined) continue;
          all.push({ serverId: s.id, serverName: s.name, entry, thumb: undefined });
        }
      }
      const top = all.sort((a, b) => b.entry.at - a.entry.at).slice(0, SHOWN);
      const withThumbs = settings.thumbnails
        ? await Promise.all(
            top.map(async (i) => ({
              ...i,
              thumb: (await services.profiles.getThumbnail(i.serverId, i.entry.ref))?.dataUrl,
            })),
          )
        : top;
      if (live) setItems(withThumbs);
    })();
    return () => {
      live = false;
    };
  }, [
    services.profiles,
    services.devServer,
    settings.thumbnails,
    settings.showDemo,
    version,
    sessionCount,
    activeId,
  ]);

  // MUL-5 "In use" badges: only for servers the app is signed in to right now (never a
  // sign-in just for a badge), shortly after the list or the open sessions change.
  const [serverCounts, setServerCounts] = useState<ReadonlyMap<string, number>>(new Map());
  // A sign-in elsewhere in the app (or a sign-out) changes which servers can be asked.
  const [signIns, setSignIns] = useState(0);
  useEffect(() => services.auth.onSessionChange(() => setSignIns((n) => n + 1)), [services.auth]);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      void Promise.all(
        items.map(async (i) => {
          const session =
            i.entry.ref.type === 'c' &&
            i.serverId !== DEMO_PROFILE_ID &&
            !isShareServerId(i.serverId)
              ? services.auth.current(i.serverId)
              : undefined;
          if (!session) return undefined;
          const n = await Promise.race([
            services.admin
              .getActiveConnectionCount(session, i.entry.ref.dataSource, i.entry.ref.identifier)
              .catch(() => undefined),
            new Promise<undefined>((r) => setTimeout(() => r(undefined), IN_USE_CHECK_TIMEOUT_MS)),
          ]);
          return n === undefined ? undefined : ([itemKey(i), n] as const);
        }),
      ).then((pairs) => {
        if (live) setServerCounts(new Map(pairs.filter((p) => p !== undefined)));
      });
    }, 1500);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [items, services.auth, services.admin, sessionCount, activeId, signIns]);

  if (items.length === 0) return null;

  const targetOf = (i: QuickItem): SessionTarget => ({
    dataSource: i.entry.ref.dataSource,
    identifier: i.entry.ref.identifier,
    type: i.entry.ref.type,
    name: i.entry.name ?? '',
    protocol: i.entry.protocol ?? '',
  });
  const isOpen = (i: QuickItem) =>
    findOpenSession(sessions.state, i.serverId, targetOf(i)) !== undefined;

  const go = (i: QuickItem) => {
    const target = targetOf(i);
    // Already open in the app: go to it, ask, or open another, as the setting says.
    if (isOpen(i)) {
      sessions.open(i.serverId, i.serverName, target);
      return;
    }
    launch.request({
      serverId: i.serverId,
      identifier: i.entry.ref.identifier,
      dataSource: i.entry.ref.dataSource,
      type: i.entry.ref.type,
    });
    nav.open({ name: 'connections', serverId: i.serverId });
  };

  return (
    <section className="list-section quick-connect" aria-labelledby="quick-title">
      <h2 id="quick-title" className="section-title">
        <Icon name="clock" size="1rem" /> {strings.servers.recentTitle}
      </h2>
      <ul className="quick-grid">
        {items.map((i) => {
          const open = isOpen(i);
          const reported = serverCounts.get(itemKey(i));
          const inUse =
            reported === undefined
              ? 0
              : serverOnlyCount(reported, liveInAppCount(sessions.state, i.serverId, targetOf(i)));
          const base = strings.servers.recentConnect(i.entry.name ?? '', i.serverName);
          const label = [
            base,
            open ? strings.connections.openSessionLabel : '',
            inUse > 0 ? strings.connections.inUse(inUse) : '',
          ]
            .filter(Boolean)
            .join(', ');
          return (
            <li key={itemKey(i)}>
              <button type="button" className="quick-card" onClick={() => go(i)} aria-label={label}>
                {i.thumb ? (
                  <img className="quick-thumb" src={i.thumb} alt="" />
                ) : (
                  <span className="quick-thumb quick-thumb-empty">
                    <Icon name={protocolIcon(i.entry.protocol ?? '')} size="2rem" />
                  </span>
                )}
                {open || inUse > 0 ? (
                  <span className="quick-open">
                    {open ? <OpenBadge /> : null}
                    {inUse > 0 ? <InUseBadge count={inUse} /> : null}
                  </span>
                ) : null}
                <span className="quick-name">{i.entry.name}</span>
                <span className="quick-sub">
                  {[protocolLabel(i.entry.protocol ?? ''), i.serverName]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
