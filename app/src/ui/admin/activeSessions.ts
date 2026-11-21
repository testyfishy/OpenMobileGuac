import type { ActiveConnection, PermissionSet } from '../../core/models/Admin.ts';
import type { ConnectionTree } from '../../core/models/Connection.ts';
import type { SessionTarget } from '../nav/navigation.ts';
import { findTarget } from '../connections/treeView.ts';
import { canJoin, canKill } from './permissions.ts';

/**
 * The server-wide active sessions list (web client: Settings › Active Sessions,
 * `guacSettingsSessions.js`): one row per active connection with user, connection, start
 * time and remote host, newest first. Pure.
 */
export interface ActiveSessionRow {
  readonly dataSource: string;
  readonly active: ActiveConnection;
  /** The connection's name from the tree; undefined when the tree does not have it. */
  readonly connectionName: string | undefined;
  /** Where Join goes (the connection with `join` set), or undefined when not offered. */
  readonly joinTarget: SessionTarget | undefined;
  readonly canKill: boolean;
}

export function activeSessionRows(
  tree: ConnectionTree,
  lists: readonly { readonly dataSource: string; readonly items: readonly ActiveConnection[] }[],
  permissions: ReadonlyMap<string, PermissionSet>,
): ActiveSessionRow[] {
  const rows: ActiveSessionRow[] = [];
  for (const { dataSource, items } of lists) {
    const perms = permissions.get(dataSource);
    for (const a of items) {
      const target =
        a.connectionIdentifier !== undefined
          ? findTarget(tree, a.connectionIdentifier, dataSource, 'c')
          : undefined;
      rows.push({
        dataSource,
        active: a,
        connectionName: target?.name,
        // Joining needs the connection's protocol and settings, so only connections the
        // tree knows; the tunnel itself is opened with `GUAC_TYPE=a` and the active id.
        joinTarget:
          target && canJoin(a.connectable) ? { ...target, join: a.identifier } : undefined,
        canKill: perms !== undefined && canKill(perms, a.identifier),
      });
    }
  }
  return rows.sort((x, y) => (y.active.startDate ?? 0) - (x.active.startDate ?? 0));
}
