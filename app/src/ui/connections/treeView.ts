import type { Connection, ConnectionGroup, ConnectionTree } from '../../core/models/Connection.ts';
import type { ConnectionRef } from '../../core/storage/ProfileStore.ts';
import type { IconName } from '../components/Icon.tsx';
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
