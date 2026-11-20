import type { PermissionSet } from '../../core/models/Admin.ts';
import { canEditConnection } from './permissions.ts';

/**
 * A small bridge between an open session (outside any `AdminProvider`) and the connection
 * management of its server, for Session info's "Edit this connection" (Quality helper,
 * AUDIT §4.4). Keyed by the session token, kept in memory only.
 */

const permissions = new Map<string, ReadonlyMap<string, PermissionSet>>();
let pending: { token: string; dataSource: string; id: string } | null = null;
const listeners = new Set<() => void>();

/** `AdminProvider`: the permissions it loaded for a signed-in session. */
export function publishAdminPermissions(
  token: string,
  perms: ReadonlyMap<string, PermissionSet>,
): void {
  permissions.set(token, perms);
}

/** Whether the signed-in user may edit this connection (as far as the app has loaded). */
export function mayEditConnection(token: string, dataSource: string, id: string): boolean {
  const p = permissions.get(token)?.get(dataSource);
  return p !== undefined && canEditConnection(p, id);
}

/** Ask the server's `AdminProvider` to open the connection editor. */
export function requestConnectionEdit(token: string, dataSource: string, id: string): void {
  pending = { token, dataSource, id };
  for (const l of listeners) l();
}

/**
 * `AdminProvider`: take a pending request for its session once it can serve it (its
 * permissions for that data source are loaded); otherwise leave it pending.
 */
export function takeConnectionEdit(
  token: string,
  canServe: (dataSource: string) => boolean,
): { dataSource: string; id: string } | null {
  if (!pending || pending.token !== token || !canServe(pending.dataSource)) return null;
  const p = pending;
  pending = null;
  return { dataSource: p.dataSource, id: p.id };
}

export function onConnectionEditRequest(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
