import {
  ObjectPermission,
  SystemPermission,
  type ObjectPermissionMap,
  type PermissionSet,
} from '../../core/models/Admin.ts';
import { ROOT_GROUP_IDENTIFIER } from '../../core/models/Connection.ts';

/**
 * Permission gating for the management UI, mirroring the web client
 * (docs/protocol-notes.md §8.3: `userPageService.js`, `guacSettingsConnections.js`,
 * `ManagementPermissions.js`). Pure. The server still checks everything; a 403 hides the UI.
 */

function has(map: ObjectPermissionMap, id: string, type: string): boolean {
  return map.get(id)?.has(type) ?? false;
}

function hasAny(map: ObjectPermissionMap, types: readonly string[]): boolean {
  for (const [, set] of map) for (const t of types) if (set.has(t)) return true;
  return false;
}

/** Upstream ignores UPDATE on ROOT before deciding anything. */
export function withoutRootUpdate(p: PermissionSet): PermissionSet {
  const root = p.connectionGroups.get(ROOT_GROUP_IDENTIFIER);
  if (!root?.has(ObjectPermission.UPDATE)) return p;
  const groups = new Map(p.connectionGroups);
  const kept = new Set(root);
  kept.delete(ObjectPermission.UPDATE);
  groups.set(ROOT_GROUP_IDENTIFIER, kept);
  return { ...p, connectionGroups: groups };
}

export function isAdmin(p: PermissionSet): boolean {
  return p.system.has(SystemPermission.ADMINISTER);
}

export function canCreateConnection(p: PermissionSet): boolean {
  return isAdmin(p) || p.system.has(SystemPermission.CREATE_CONNECTION);
}

export function canCreateGroup(p: PermissionSet): boolean {
  return isAdmin(p) || p.system.has(SystemPermission.CREATE_CONNECTION_GROUP);
}

/** Whether to offer management in this data source at all. */
export function canManage(raw: PermissionSet): boolean {
  const p = withoutRootUpdate(raw);
  const types = [ObjectPermission.UPDATE, ObjectPermission.DELETE, ObjectPermission.ADMINISTER];
  return (
    canCreateConnection(p) ||
    canCreateGroup(p) ||
    hasAny(p.connections, types) ||
    hasAny(p.connectionGroups, types)
  );
}

/** Edit (and read parameters of) a connection: ADMINISTER or UPDATE on it. */
export function canEditConnection(p: PermissionSet, id: string): boolean {
  return isAdmin(p) || has(p.connections, id, ObjectPermission.UPDATE);
}

export function canDeleteConnection(p: PermissionSet, id: string): boolean {
  return isAdmin(p) || has(p.connections, id, ObjectPermission.DELETE);
}

/**
 * Clone needs create permission (upstream `canCloneObject`) and the source's parameters,
 * which the server only returns with UPDATE or ADMINISTER.
 */
export function canCloneConnection(p: PermissionSet, id: string): boolean {
  return canCreateConnection(p) && canEditConnection(p, id);
}

export function canEditGroup(p: PermissionSet, id: string): boolean {
  if (id === ROOT_GROUP_IDENTIFIER) return false;
  return isAdmin(p) || has(p.connectionGroups, id, ObjectPermission.UPDATE);
}

export function canDeleteGroup(p: PermissionSet, id: string): boolean {
  if (id === ROOT_GROUP_IDENTIFIER) return false;
  return isAdmin(p) || has(p.connectionGroups, id, ObjectPermission.DELETE);
}

/**
 * Whether objects may be placed in this group: the top level always (the database models it
 * as a null parent and never checks it), otherwise ADMINISTER or UPDATE on the group
 * (`ModeledChildDirectoryObjectService.canUpdateModifiedParents`).
 */
export function canPlaceIn(p: PermissionSet, groupId: string): boolean {
  if (groupId === ROOT_GROUP_IDENTIFIER) return true;
  return isAdmin(p) || has(p.connectionGroups, groupId, ObjectPermission.UPDATE);
}

/** Disconnect an active connection: ADMINISTER, or DELETE on that active connection. */
export function canKill(p: PermissionSet, activeId: string): boolean {
  return isAdmin(p) || has(p.activeConnections, activeId, ObjectPermission.DELETE);
}

/** Anything to show in a group's management menu. */
export function canManageGroup(p: PermissionSet, id: string): boolean {
  return (
    canEditGroup(p, id) ||
    canDeleteGroup(p, id) ||
    (canPlaceIn(p, id) && (canCreateConnection(p) || canCreateGroup(p)))
  );
}

/** Anything to show for a connection. */
export function canManageConnection(p: PermissionSet, id: string): boolean {
  return canEditConnection(p, id) || canDeleteConnection(p, id) || canCloneConnection(p, id);
}
