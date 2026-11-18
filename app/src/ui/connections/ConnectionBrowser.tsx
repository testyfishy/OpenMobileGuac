import { useMemo, useState, type ReactNode } from 'react';
import type { Connection, ConnectionGroup, ConnectionTree } from '../../core/models/Connection.ts';
import type { ConnectionRef } from '../../core/storage/ProfileStore.ts';
import { EmptyState } from '../components/Feedback.tsx';
import { Icon } from '../components/Icon.tsx';
import { strings } from '../strings.ts';
import {
  groupHasContent,
  groupKey,
  isTreeEmpty,
  protocolIcon,
  protocolLabel,
  refKey,
  refOf,
  resolveRefs,
  searchConnections,
  type ConnectionMatch,
} from './treeView.ts';

export interface ConnectionBrowserProps {
  tree: ConnectionTree;
  query: string;
  favourites: readonly ConnectionRef[];
  recents: readonly ConnectionRef[];
  onConnect: (c: Connection) => void;
  onToggleFavourite: (c: Connection, favourite: boolean) => void;
  /** Hide data-source headings (e.g. the demo). */
  flat?: boolean;
}

const RECENTS_SHOWN = 5;

/** Connection tree with search, favourites and recents (CON-1…CON-3). */
export function ConnectionBrowser({
  tree,
  query,
  favourites,
  recents,
  onConnect,
  onToggleFavourite,
  flat,
}: ConnectionBrowserProps) {
  const c = strings.connections;
  const favKeys = useMemo(() => new Set(favourites.map(refKey)), [favourites]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const toggleGroup = (key: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const row = (m: ConnectionMatch, showPath: boolean, keyPrefix: string, depth = 0) => (
    <li
      key={`${keyPrefix}:${refKey(refOf(m.connection))}`}
      style={depth > 0 ? { paddingInlineStart: `${depth * 1.25}rem` } : undefined}
    >
      <ConnectionRow
        connection={m.connection}
        path={showPath ? m.path : undefined}
        favourite={favKeys.has(refKey(refOf(m.connection)))}
        onConnect={onConnect}
        onToggleFavourite={onToggleFavourite}
      />
    </li>
  );

  if (query.trim()) {
    const results = searchConnections(tree, query);
    if (results.length === 0) return <EmptyState icon="search" title={c.noResults(query.trim())} />;
    return (
      <ul className="list" aria-label={c.search}>
        {results.map((m) => row(m, true, 'q'))}
      </ul>
    );
  }

  if (isTreeEmpty(tree)) return <EmptyState icon="folder" title={c.empty} />;

  const favList = resolveRefs(tree, favourites);
  const recentList = resolveRefs(tree, recents).slice(0, RECENTS_SHOWN);
  const multiSource = !flat && tree.dataSources.filter((d) => groupHasContent(d.root)).length > 1;

  return (
    <>
      {favList.length > 0 ? (
        <Section title={c.favourites} icon="star">
          {favList.map((m) => row(m, true, 'f'))}
        </Section>
      ) : null}
      {recentList.length > 0 ? (
        <Section title={c.recents} icon="clock">
          {recentList.map((m) => row(m, true, 'r'))}
        </Section>
      ) : null}
      {tree.dataSources
        .filter((d) => groupHasContent(d.root))
        .map((d) => (
          <Section
            key={d.dataSource}
            title={multiSource ? c.dataSource(d.dataSource) : c.all}
            icon="folder"
          >
            <GroupChildren
              group={d.root}
              depth={0}
              expanded={expanded}
              onToggleGroup={toggleGroup}
              renderConnection={(conn, depth) =>
                row({ connection: conn, path: [] }, false, 't', depth)
              }
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
  expanded,
  onToggleGroup,
  renderConnection,
}: {
  group: ConnectionGroup;
  depth: number;
  expanded: ReadonlySet<string>;
  onToggleGroup: (key: string) => void;
  renderConnection: (c: Connection, depth: number) => ReactNode;
}) {
  return (
    <>
      {group.childConnectionGroups.filter(groupHasContent).map((g) => {
        const key = groupKey(g);
        const open = expanded.has(key);
        const label = open
          ? strings.connections.collapseGroup(g.name)
          : strings.connections.expandGroup(g.name);
        return (
          <li key={key}>
            <button
              type="button"
              className="row-main group-row"
              style={{ paddingInlineStart: `${0.75 + depth * 1.25}rem` }}
              aria-expanded={open}
              aria-label={label}
              onClick={() => onToggleGroup(key)}
            >
              <Icon name={open ? 'chevron-down' : 'chevron-right'} className="group-chevron" />
              <span className="row-icon row-icon-group">
                <Icon name="folder" />
              </span>
              <span className="row-text">
                <span className="row-title">{g.name}</span>
                {g.type === 'BALANCING' ? (
                  <span className="row-subtitle">{strings.connections.balancing}</span>
                ) : null}
              </span>
              {g.activeConnections > 0 ? <ActiveDot count={g.activeConnections} /> : null}
            </button>
            {open ? (
              <ul className="list nested">
                <GroupChildren
                  group={g}
                  depth={depth + 1}
                  expanded={expanded}
                  onToggleGroup={onToggleGroup}
                  renderConnection={renderConnection}
                />
              </ul>
            ) : null}
          </li>
        );
      })}
      {group.childConnections.map((conn) => renderConnection(conn, depth))}
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

function ConnectionRow({
  connection,
  path,
  favourite,
  onConnect,
  onToggleFavourite,
}: {
  connection: Connection;
  path: readonly string[] | undefined;
  favourite: boolean;
  onConnect: (c: Connection) => void;
  onToggleFavourite: (c: Connection, favourite: boolean) => void;
}) {
  const c = strings.connections;
  const subtitle = [
    protocolLabel(connection.protocol),
    ...(path && path.length ? [path.join(' › ')] : []),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="row">
      <button
        type="button"
        className="row-main"
        onClick={() => onConnect(connection)}
        aria-label={c.connect(connection.name)}
      >
        <span className={`row-icon row-icon-${connection.protocol.toLowerCase() || 'other'}`}>
          <Icon name={protocolIcon(connection.protocol)} />
        </span>
        <span className="row-text">
          <span className="row-title">{connection.name}</span>
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
          aria-label={
            favourite ? c.removeFavourite(connection.name) : c.addFavourite(connection.name)
          }
          title={favourite ? c.removeFavourite(connection.name) : c.addFavourite(connection.name)}
          onClick={() => onToggleFavourite(connection, !favourite)}
        >
          <Icon name={favourite ? 'star-filled' : 'star'} />
        </button>
      </div>
    </div>
  );
}
