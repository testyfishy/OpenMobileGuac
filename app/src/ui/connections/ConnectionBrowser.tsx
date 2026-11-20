import { useMemo, useRef, useState, type ReactNode, type TouchEvent } from 'react';
import type { Connection, ConnectionGroup, ConnectionTree } from '../../core/models/Connection.ts';
import type { ConnectionRef } from '../../core/storage/ProfileStore.ts';
import { useShowsEmptyGroups } from '../admin/AdminContext.ts';
import { AdminGroupButton } from '../admin/EntryPoints.tsx';
import { EmptyState } from '../components/Feedback.tsx';
import { Icon } from '../components/Icon.tsx';
import { strings } from '../strings.ts';
import {
  groupHasContent,
  groupKey,
  isBalancing,
  isTreeEmpty,
  protocolIcon,
  protocolLabel,
  refKey,
  refOf,
  resolveRefs,
  searchConnections,
  sortConnections,
  sortGroups,
  type ConnectionMatch,
  type SortMode,
} from './treeView.ts';

export interface ConnectionBrowserProps {
  tree: ConnectionTree;
  query: string;
  favourites: readonly ConnectionRef[];
  recents: readonly ConnectionRef[];
  onConnect: (c: Connection) => void;
  onToggleFavourite: (c: Connection, favourite: boolean) => void;
  /** CON-6: connect to a balancing group (`GUAC_TYPE=g`). */
  onConnectGroup?: (g: ConnectionGroup) => void;
  onDetails?: (m: ConnectionMatch) => void;
  sort?: SortMode;
  /** refKey → last use (ms), for the "recently used" sort. */
  lastUsed?: ReadonlyMap<string, number>;
  /** `c:ds:id` / `g:ds:id` of targets with an open session. */
  openKeys?: ReadonlySet<string>;
  /** refKey → thumbnail data URL (CON-4). */
  thumbnails?: ReadonlyMap<string, string>;
  /** Hide data-source headings (e.g. the demo). */
  flat?: boolean;
}

const RECENTS_SHOWN = 5;

/** Connection tree with search, favourites and recents (CON-1…CON-6). */
export function ConnectionBrowser({
  tree,
  query,
  favourites,
  recents,
  onConnect,
  onToggleFavourite,
  onConnectGroup,
  onDetails,
  sort = 'server',
  lastUsed,
  openKeys,
  thumbnails,
  flat,
}: ConnectionBrowserProps) {
  const c = strings.connections;
  // Connection management lists empty folders where the account may manage them.
  const showsEmpty = useShowsEmptyGroups();
  const keepGroup = (g: ConnectionGroup) => groupHasContent(g) || showsEmpty(g.dataSource);
  const keepSource = (root: ConnectionGroup) =>
    groupHasContent(root) || root.childConnectionGroups.some(keepGroup);
  const favKeys = useMemo(() => new Set(favourites.map(refKey)), [favourites]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const toggleGroup = (key: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const row = (
    m: ConnectionMatch,
    showPath: boolean,
    keyPrefix: string,
    depth = 0,
    thumb = false,
  ) => {
    const key = refKey(refOf(m.connection));
    return (
      <li
        key={`${keyPrefix}:${key}`}
        style={depth > 0 ? { paddingInlineStart: `${depth * 1.25}rem` } : undefined}
      >
        <ConnectionRow
          match={m}
          showPath={showPath}
          favourite={favKeys.has(key)}
          open={openKeys?.has(key) ?? false}
          thumbnail={thumb ? thumbnails?.get(key) : undefined}
          onConnect={onConnect}
          onToggleFavourite={onToggleFavourite}
          onDetails={onDetails}
        />
      </li>
    );
  };

  if (query.trim()) {
    const results = sortConnections(searchConnections(tree, query), sort, lastUsed);
    if (results.length === 0) return <EmptyState icon="search" title={c.noResults(query.trim())} />;
    return (
      <ul className="list" aria-label={c.search}>
        {results.map((m) => row(m, true, 'q'))}
      </ul>
    );
  }

  if (isTreeEmpty(tree) && !tree.dataSources.some((d) => keepSource(d.root)))
    return <EmptyState icon="folder" title={c.empty} />;

  const favList = resolveRefs(tree, favourites);
  const recentList = resolveRefs(tree, recents).slice(0, RECENTS_SHOWN);
  const multiSource = !flat && tree.dataSources.filter((d) => keepSource(d.root)).length > 1;

  return (
    <>
      {favList.length > 0 ? (
        <Section title={c.favourites} icon="star">
          {sortConnections(favList, sort === 'server' ? 'server' : sort, lastUsed).map((m) =>
            row(m, true, 'f'),
          )}
        </Section>
      ) : null}
      {recentList.length > 0 ? (
        <Section title={c.recents} icon="clock">
          {recentList.map((m) => row(m, true, 'r', 0, true))}
        </Section>
      ) : null}
      {tree.dataSources
        .filter((d) => keepSource(d.root))
        .map((d) => (
          <Section
            key={d.dataSource}
            title={multiSource ? c.dataSource(d.dataSource) : c.all}
            icon="folder"
          >
            <GroupChildren
              group={d.root}
              depth={0}
              path={[]}
              expanded={expanded}
              sort={sort}
              lastUsed={lastUsed}
              openKeys={openKeys}
              onToggleGroup={toggleGroup}
              onConnectGroup={onConnectGroup}
              keepGroup={keepGroup}
              renderConnection={(m, depth) => row(m, false, 't', depth)}
            />
          </Section>
        ))}
    </>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: 'star' | 'clock' | 'folder';
  children: ReactNode;
}) {
  return (
    <section className="list-section">
      <h2 className="section-title">
        <Icon name={icon} size="1rem" /> {title}
      </h2>
      <ul className="list">{children}</ul>
    </section>
  );
}

function GroupChildren({
  group,
  depth,
  path,
  expanded,
  sort,
  lastUsed,
  openKeys,
  onToggleGroup,
  onConnectGroup,
  keepGroup = groupHasContent,
  renderConnection,
}: {
  group: ConnectionGroup;
  depth: number;
  path: readonly string[];
  expanded: ReadonlySet<string>;
  sort: SortMode;
  lastUsed: ReadonlyMap<string, number> | undefined;
  openKeys: ReadonlySet<string> | undefined;
  onToggleGroup: (key: string) => void;
  onConnectGroup: ((g: ConnectionGroup) => void) | undefined;
  keepGroup?: (g: ConnectionGroup) => boolean;
  renderConnection: (m: ConnectionMatch, depth: number) => ReactNode;
}) {
  const connections = sortConnections(
    group.childConnections.map((connection) => ({ connection, path })),
    sort,
    lastUsed,
  );
  return (
    <>
      {sortGroups(group.childConnectionGroups.filter(keepGroup), sort).map((g) => {
        const key = groupKey(g);
        const open = expanded.has(key);
        const label = open
          ? strings.connections.collapseGroup(g.name)
          : strings.connections.expandGroup(g.name);
        const balancing = isBalancing(g);
        return (
          <li key={key}>
            <div className="group-line" style={{ paddingInlineStart: `${depth * 1.25}rem` }}>
              <button
                type="button"
                className="row-main group-row"
                aria-expanded={open}
                aria-label={label}
                onClick={() => onToggleGroup(key)}
              >
                <Icon name={open ? 'chevron-down' : 'chevron-right'} className="group-chevron" />
                <span className="row-icon row-icon-group">
                  <Icon name={balancing ? 'layers' : 'folder'} />
                </span>
                <span className="row-text">
                  <span className="row-title">{g.name}</span>
                  {balancing ? (
                    <span className="row-subtitle">{strings.connections.balancing}</span>
                  ) : null}
                </span>
                {g.activeConnections > 0 ? <ActiveDot count={g.activeConnections} /> : null}
                {openKeys?.has(`g:${g.dataSource}:${g.identifier}`) ? <OpenBadge /> : null}
              </button>
              {balancing && onConnectGroup ? (
                <button
                  type="button"
                  className="icon-btn group-connect"
                  onClick={() => onConnectGroup(g)}
                  aria-label={strings.connections.connectGroup(g.name)}
                  title={strings.connections.connectGroup(g.name)}
                >
                  <Icon name="play" />
                </button>
              ) : null}
              <AdminGroupButton group={g} />
            </div>
            {open ? (
              <ul className="list nested">
                <GroupChildren
                  group={g}
                  depth={depth + 1}
                  path={[...path, g.name]}
                  expanded={expanded}
                  sort={sort}
                  lastUsed={lastUsed}
                  openKeys={openKeys}
                  onToggleGroup={onToggleGroup}
                  onConnectGroup={onConnectGroup}
                  keepGroup={keepGroup}
                  renderConnection={renderConnection}
                />
              </ul>
            ) : null}
          </li>
        );
      })}
      {connections.map((m) => renderConnection(m, depth))}
    </>
  );
}

function ActiveDot({ count }: { count: number }) {
  return (
    <span className="active-dot" title={strings.connections.inUse(count)}>
      <span className="active-dot-mark" aria-hidden="true" />
      <span className="visually-hidden">{strings.connections.inUse(count)}</span>
    </span>
  );
}

function OpenBadge() {
  return <span className="badge badge-open">{strings.connections.openSessionBadge}</span>;
}

const SWIPE_OPEN_PX = 112;

function ConnectionRow({
  match,
  showPath,
  favourite,
  open,
  thumbnail,
  onConnect,
  onToggleFavourite,
  onDetails,
}: {
  match: ConnectionMatch;
  showPath: boolean;
  favourite: boolean;
  open: boolean;
  thumbnail: string | undefined;
  onConnect: (c: Connection) => void;
  onToggleFavourite: (c: Connection, favourite: boolean) => void;
  onDetails: ((m: ConnectionMatch) => void) | undefined;
}) {
  const c = strings.connections;
  const connection = match.connection;
  const path = showPath ? match.path : undefined;
  const subtitle = [
    protocolLabel(connection.protocol),
    ...(path && path.length ? [path.join(' › ')] : []),
  ]
    .filter(Boolean)
    .join(' · ');
  const swipe = useSwipe();
  const favLabel = favourite ? c.removeFavourite(connection.name) : c.addFavourite(connection.name);
  return (
    <div className="swipe-wrap">
      <div className="swipe-actions" aria-hidden={!swipe.revealed}>
        <button
          type="button"
          className="swipe-action swipe-action-fav"
          tabIndex={swipe.revealed ? 0 : -1}
          onClick={() => {
            swipe.close();
            onToggleFavourite(connection, !favourite);
          }}
          aria-label={favLabel}
        >
          <Icon name={favourite ? 'star-filled' : 'star'} />
        </button>
        {onDetails ? (
          <button
            type="button"
            className="swipe-action swipe-action-info"
            tabIndex={swipe.revealed ? 0 : -1}
            onClick={() => {
              swipe.close();
              onDetails(match);
            }}
            aria-label={c.details(connection.name)}
          >
            <Icon name="info" />
          </button>
        ) : null}
      </div>
      <div
        className="row swipe-row"
        style={{ transform: swipe.offset ? `translateX(${swipe.offset}px)` : undefined }}
        {...swipe.handlers}
      >
        <button
          type="button"
          className="row-main"
          onClick={() => {
            if (swipe.consumeClick()) return;
            onConnect(connection);
          }}
          aria-label={c.connect(connection.name)}
        >
          {thumbnail ? (
            <img className="row-thumb" src={thumbnail} alt="" width={64} height={40} />
          ) : (
            <span className={`row-icon row-icon-${connection.protocol.toLowerCase() || 'other'}`}>
              <Icon name={protocolIcon(connection.protocol)} />
            </span>
          )}
          <span className="row-text">
            <span className="row-title">
              {connection.name}
              {open ? <OpenBadge /> : null}
            </span>
            <span className="row-subtitle">
              {subtitle}
              {connection.activeConnections > 0 ? (
                <span className="in-use"> · {c.inUseShort}</span>
              ) : null}
            </span>
          </span>
          {connection.activeConnections > 0 ? (
            <ActiveDot count={connection.activeConnections} />
          ) : null}
        </button>
        <div className="row-trailing">
          <button
            type="button"
            className={favourite ? 'icon-btn star-on' : 'icon-btn'}
            aria-pressed={favourite}
            aria-label={favLabel}
            title={favLabel}
            onClick={() => onToggleFavourite(connection, !favourite)}
          >
            <Icon name={favourite ? 'star-filled' : 'star'} />
          </button>
          {onDetails ? (
            <button
              type="button"
              className="icon-btn"
              aria-label={c.details(connection.name)}
              title={c.details(connection.name)}
              onClick={() => onDetails(match)}
            >
              <Icon name="info" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Horizontal swipe to reveal row actions (touch only; the same actions are always
 * available as buttons). Vertical movement keeps scrolling the list.
 */
function useSwipe() {
  const start = useRef<{ x: number; y: number; base: number } | null>(null);
  const axis = useRef<'x' | 'y' | null>(null);
  const moved = useRef(false);
  const [offset, setOffset] = useState(0);
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    if (!t || e.touches.length !== 1) return;
    start.current = { x: t.clientX, y: t.clientY, base: offset };
    axis.current = null;
    moved.current = false;
  };
  const onTouchMove = (e: TouchEvent) => {
    const t = e.touches[0];
    const s = start.current;
    if (!t || !s) return;
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (axis.current === null && Math.hypot(dx, dy) > 8)
      axis.current = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (axis.current !== 'x') return;
    moved.current = true;
    const dir = document.documentElement.dir === 'rtl' ? -1 : 1;
    const next = Math.max(-SWIPE_OPEN_PX, Math.min(0, s.base + dx * dir));
    setOffset(next * dir);
  };
  const onTouchEnd = () => {
    if (axis.current === 'x')
      setOffset((o) => (Math.abs(o) > SWIPE_OPEN_PX / 2 ? Math.sign(o) * SWIPE_OPEN_PX : 0));
    start.current = null;
  };
  return {
    offset,
    revealed: offset !== 0,
    close: () => setOffset(0),
    /** A click right after a swipe (or on a revealed row) only closes the row. */
    consumeClick: () => {
      if (moved.current || offset !== 0) {
        moved.current = false;
        setOffset(0);
        return true;
      }
      return false;
    },
    handlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd },
  };
}
