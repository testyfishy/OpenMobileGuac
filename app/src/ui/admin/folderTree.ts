import type { PermissionSet } from '../../core/models/Admin.ts';
import {
  ROOT_GROUP_IDENTIFIER,
  type ConnectionGroup,
  type ConnectionTree,
} from '../../core/models/Connection.ts';
import { canPlaceIn } from './permissions.ts';

/**
 * The folder (parent group) picker. Pure. A group can never move into itself or one of its
 * descendants (the server refuses that; docs/protocol-notes.md §8.2), and the user can only
 * pick folders they may place objects in.
 */

export interface FolderOption {
  readonly identifier: string;
  /** Empty for the top level; the UI shows its own label. */
  readonly name: string;
  readonly depth: number;
  /** Names of the enclosing folders, outermost first. */
  readonly path: readonly string[];
  readonly disabled: boolean;
  readonly reason?: 'self' | 'descendant' | 'no-permission';
}

export function rootOf(tree: ConnectionTree, dataSource: string): ConnectionGroup | undefined {
  return tree.dataSources.find((d) => d.dataSource === dataSource)?.root;
}

export function findGroup(
  tree: ConnectionTree,
  dataSource: string,
  identifier: string,
): ConnectionGroup | undefined {
  const root = rootOf(tree, dataSource);
  if (!root) return undefined;
  if (identifier === ROOT_GROUP_IDENTIFIER || identifier === root.identifier) return root;
  const visit = (g: ConnectionGroup): ConnectionGroup | undefined => {
    for (const child of g.childConnectionGroups) {
      if (child.identifier === identifier) return child;
      const hit = visit(child);
      if (hit) return hit;
    }
    return undefined;
  };
  return visit(root);
}

/** The group and every group below it. */
export function subtreeIds(group: ConnectionGroup): Set<string> {
  const out = new Set<string>();
  const visit = (g: ConnectionGroup) => {
    out.add(g.identifier);
    g.childConnectionGroups.forEach(visit);
  };
  visit(group);
  return out;
}

/** What deleting a folder would also delete (as far as this account can see). */
export function countContents(group: ConnectionGroup): { connections: number; groups: number } {
  let connections = 0;
  let groups = 0;
  const visit = (g: ConnectionGroup) => {
    connections += g.childConnections.length;
    groups += g.childConnectionGroups.length;
    g.childConnectionGroups.forEach(visit);
  };
  visit(group);
  return { connections, groups };
}

/**
 * Every folder of a data source, depth first, top level first. `movingGroup` (an
 * identifier) disables itself and its descendants.
 */
export function folderOptions(
  tree: ConnectionTree,
  dataSource: string,
  permissions: PermissionSet,
  movingGroup?: string,
): FolderOption[] {
  const root = rootOf(tree, dataSource);
  if (!root) return [];
  const moving = movingGroup ? findGroup(tree, dataSource, movingGroup) : undefined;
  const blocked = moving ? subtreeIds(moving) : new Set<string>();
  const out: FolderOption[] = [
    { identifier: ROOT_GROUP_IDENTIFIER, name: '', depth: 0, path: [], disabled: false },
  ];
  const visit = (g: ConnectionGroup, depth: number, path: readonly string[]) => {
    for (const child of g.childConnectionGroups) {
      let reason: FolderOption['reason'];
      if (child.identifier === movingGroup) reason = 'self';
      else if (blocked.has(child.identifier)) reason = 'descendant';
      else if (!canPlaceIn(permissions, child.identifier)) reason = 'no-permission';
      out.push({
        identifier: child.identifier,
        name: child.name,
        depth,
        path,
        disabled: reason !== undefined,
        ...(reason ? { reason } : {}),
      });
      visit(child, depth + 1, [...path, child.name]);
    }
  };
  visit(root, 1, []);
  return out;
}

/** Whether `target` is a valid new parent for the group `moving`. */
export function canMoveGroupTo(
  tree: ConnectionTree,
  dataSource: string,
  moving: string,
  target: string,
): boolean {
  const g = findGroup(tree, dataSource, moving);
  if (!g) return false;
  return !subtreeIds(g).has(target);
}

/** Folder path ("A › B") of a group, for summaries. */
export function folderPath(tree: ConnectionTree, dataSource: string, identifier: string): string[] {
  const root = rootOf(tree, dataSource);
  if (!root || identifier === ROOT_GROUP_IDENTIFIER) return [];
  const visit = (g: ConnectionGroup, path: string[]): string[] | undefined => {
    for (const child of g.childConnectionGroups) {
      const next = [...path, child.name];
      if (child.identifier === identifier) return next;
      const hit = visit(child, next);
      if (hit) return hit;
    }
    return undefined;
  };
  return visit(root, []) ?? [];
}
