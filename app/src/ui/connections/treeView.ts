import type { Connection, ConnectionGroup, ConnectionTree } from '../../core/models/Connection.ts';
import type { ConnectionRef } from '../../core/storage/ProfileStore.ts';
import type { IconName } from '../components/Icon.tsx';
import type { SessionTarget } from '../nav/navigation.ts';
import { strings } from '../strings.ts';

/** Pure helpers for the connection browser (CON-1…CON-3). */

export interface ConnectionMatch {
  readonly connection: Connection;
  /** Names of the enclosing groups, outermost first (the root group is omitted). */
  readonly path: readonly string[];
}

export function refOf(c: Pick<Connection, 'dataSource' | 'identifier'>): ConnectionRef {
  return { dataSource: c.dataSource, identifier: c.identifier, type: 'c' };
}

export function refKey(ref: ConnectionRef): string {
  return `${ref.type}:${ref.dataSource}:${ref.identifier}`;
}

export function groupKey(g: Pick<ConnectionGroup, 'dataSource' | 'identifier'>): string {
  return `g:${g.dataSource}:${g.identifier}`;
}

/** Folds case and accents so "cafe" matches "Café". */
export function foldForSearch(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

/** Every connection with its group path, depth first in server order. */
export function allConnections(tree: ConnectionTree): ConnectionMatch[] {
  const out: ConnectionMatch[] = [];
  const visit = (group: ConnectionGroup, path: readonly string[]): void => {
    for (const c of group.childConnections) out.push({ connection: c, path });
    for (const g of group.childConnectionGroups) visit(g, [...path, g.name]);
  };
  for (const ds of tree.dataSources) visit(ds.root, []);
  return out;
}

/**
 * Search (CON-2): every whitespace-separated term must appear in the connection's name, its
 * protocol, or one of its group names. Case- and accent-insensitive. Empty query → `[]`.
 */
export function searchConnections(tree: ConnectionTree, query: string): ConnectionMatch[] {
  const terms = foldForSearch(query)
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (terms.length === 0) return [];
  return allConnections(tree).filter(({ connection, path }) => {
    const hay = foldForSearch([connection.name, connection.protocol, ...path].join(' '));
    return terms.every((t) => hay.includes(t));
  });
}

/**
 * Looks up stored refs (favourites, recents) in the current tree, keeping the refs' order
 * and dropping ones the server no longer lists.
 */
export function resolveRefs(
  tree: ConnectionTree,
  refs: readonly ConnectionRef[],
): ConnectionMatch[] {
  const index = new Map<string, ConnectionMatch>();
  for (const m of allConnections(tree)) index.set(refKey(refOf(m.connection)), m);
  const out: ConnectionMatch[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const key = refKey(ref);
    const m = index.get(key);
    if (m && !seen.has(key)) {
      seen.add(key);
      out.push(m);
    }
  }
  return out;
}

export function isTreeEmpty(tree: ConnectionTree): boolean {
  return allConnections(tree).length === 0;
}

/** Whether a group (or anything inside it) has visible content. */
export function groupHasContent(group: ConnectionGroup): boolean {
  return (
    group.childConnections.length > 0 || group.childConnectionGroups.some((g) => groupHasContent(g))
  );
}

export function protocolIcon(protocol: string): IconName {
  switch (protocol.toLowerCase()) {
    case 'ssh':
    case 'telnet':
      return 'terminal';
    case 'kubernetes':
      return 'cube';
    default:
      return 'monitor';
  }
}

export function protocolLabel(protocol: string): string {
  const key = protocol.toLowerCase();
  return (
    strings.protocols[key] ??
    (protocol ? protocol.toUpperCase() : (strings.protocols['other'] ?? 'Remote'))
  );
}

// ---- targets, sorting, lookup (CON-5, CON-6, sort options) ------------------------------

export function targetOf(c: Connection): SessionTarget {
  return {
    dataSource: c.dataSource,
    identifier: c.identifier,
    type: 'c',
    name: c.name,
    protocol: c.protocol,
  };
}

/** A balancing group is connected to with `GUAC_TYPE=g`; the server picks a member. */
export function targetOfGroup(g: ConnectionGroup): SessionTarget {
  const protocols = new Set(
    allConnections({ dataSources: [{ dataSource: g.dataSource, root: g }] }).map(
      (m) => m.connection.protocol,
    ),
  );
  return {
    dataSource: g.dataSource,
    identifier: g.identifier,
    type: 'g',
    name: g.name,
    protocol: protocols.size === 1 ? ([...protocols][0] ?? '') : '',
  };
}

export function isBalancing(g: ConnectionGroup): boolean {
  return g.type === 'BALANCING';
}

/** Every group (any depth) with its path, outermost first. */
export function allGroups(
  tree: ConnectionTree,
): { group: ConnectionGroup; path: readonly string[] }[] {
  const out: { group: ConnectionGroup; path: readonly string[] }[] = [];
  const visit = (group: ConnectionGroup, path: readonly string[]): void => {
    for (const g of group.childConnectionGroups) {
      out.push({ group: g, path });
      visit(g, [...path, g.name]);
    }
  };
  for (const ds of tree.dataSources) visit(ds.root, []);
  return out;
}

/** Resolves a link's connection (or balancing group) in the tree. */
export function findTarget(
  tree: ConnectionTree,
  identifier: string,
  dataSource: string | undefined,
  type: 'c' | 'g',
): SessionTarget | undefined {
  if (type === 'g') {
    const hit = allGroups(tree).find(
      ({ group }) =>
        group.identifier === identifier &&
        (dataSource === undefined || group.dataSource === dataSource),
    );
    return hit ? targetOfGroup(hit.group) : undefined;
  }
  const hit = allConnections(tree).find(
    ({ connection }) =>
      connection.identifier === identifier &&
      (dataSource === undefined || connection.dataSource === dataSource),
  );
  return hit ? targetOf(hit.connection) : undefined;
}

export type SortMode = 'server' | 'name' | 'protocol' | 'recent';

const collator = (): Intl.Collator =>
  new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/**
 * Sorts connections for display. `server` keeps the server's order; `recent` puts recently
 * used ones first (newest first) and the rest by name. Stable.
 */
export function sortConnections<T extends { readonly connection: Connection }>(
  items: readonly T[],
  mode: SortMode,
  lastUsed: ReadonlyMap<string, number> = new Map(),
): T[] {
  if (mode === 'server') return [...items];
  const c = collator();
  const byName = (a: T, b: T) => c.compare(a.connection.name, b.connection.name);
  const sorted = [...items];
  if (mode === 'name') return sorted.sort(byName);
  if (mode === 'protocol') {
    return sorted.sort(
      (a, b) =>
        c.compare(protocolLabel(a.connection.protocol), protocolLabel(b.connection.protocol)) ||
        byName(a, b),
    );
  }
  const at = (x: T) => lastUsed.get(refKey(refOf(x.connection))) ?? -1;
  return sorted.sort((a, b) => at(b) - at(a) || byName(a, b));
}

/** Sorts groups by name unless the server order is wanted. */
export function sortGroups(groups: readonly ConnectionGroup[], mode: SortMode): ConnectionGroup[] {
  if (mode === 'server') return [...groups];
  const c = collator();
  return [...groups].sort((a, b) => c.compare(a.name, b.name));
}
