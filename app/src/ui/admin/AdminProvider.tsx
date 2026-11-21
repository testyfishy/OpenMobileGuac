import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PermissionSet } from '../../core/models/Admin.ts';
import type { AuthSession } from '../../core/models/AuthSession.ts';
import type { ConnectionTree } from '../../core/models/Connection.ts';
import { useServices } from '../services/context.ts';
import { AdminContext, type AdminAction, type AdminContextValue } from './AdminContext.ts';
import {
  onConnectionEditRequest,
  publishAdminPermissions,
  takeConnectionEdit,
} from './adminBridge.ts';
import {
  canCreateConnection,
  canCreateGroup,
  canManage,
  withoutRootUpdate,
} from './permissions.ts';
import './admin.css';

// The editors are only needed once someone manages something: keep them out of the main chunk.
const AdminLayer = lazy(() => import('./AdminLayer.tsx').then((m) => ({ default: m.AdminLayer })));

/**
 * Connection management for one signed-in server (docs/protocol-notes.md §8). Loads the
 * effective permissions of every data source in the tree and offers management only where
 * they grant something. Renders the editors and sheets above its children.
 *
 * Nothing here persists: drafts (which may hold passwords) live in component state only and
 * are dropped when an editor closes.
 */
export function AdminProvider({
  session,
  tree,
  reloadKey = 0,
  onChanged,
  children,
}: {
  session: AuthSession | undefined;
  tree: ConnectionTree | undefined;
  /** Changes on a loud refresh (the user asked): permissions are read again. */
  reloadKey?: number;
  onChanged: () => void;
  children: ReactNode;
}) {
  const { admin: api, adminBackground } = useServices();
  const [perms, setPerms] = useState<ReadonlyMap<string, PermissionSet>>(new Map());
  const [denied, setDenied] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState(false);
  const [action, setAction] = useState<AdminAction | null>(null);

  // Load permissions once per sign-in and set of data sources, and again on a loud refresh
  // (which also clears any 403 state). Not on the quiet reload after returning from a session:
  // that only updates the "In use" badges. As a background request, it never delays the list.
  const sourcesKey = tree ? JSON.stringify(tree.dataSources.map((d) => d.dataSource)) : undefined;
  useEffect(() => {
    if (!session || sourcesKey === undefined) return undefined;
    let live = true;
    const sources = JSON.parse(sourcesKey) as string[];
    void Promise.all(
      sources.map((ds) =>
        adminBackground.getEffectivePermissions(session, ds).then(
          (p) => [ds, withoutRootUpdate(p)] as const,
          // Not supported, refused or unreachable: no management in that data source.
          () => undefined,
        ),
      ),
    ).then((results) => {
      if (!live) return;
      const next = new Map<string, PermissionSet>();
      for (const r of results) if (r && canManage(r[1])) next.set(r[0], r[1]);
      setPerms(next);
      setDenied(new Set());
      setNotice(false);
    });
    return () => {
      live = false;
    };
  }, [adminBackground, session, sourcesKey, reloadKey]);

  const markDenied = useCallback((ds: string) => {
    setDenied((d) => new Set([...d, ds]));
    setNotice(true);
  }, []);

  const close = useCallback(() => setAction(null), []);

  // "Edit this connection" from an open session (Session info).
  const token = session?.token;
  useEffect(() => {
    if (!token) return undefined;
    publishAdminPermissions(token, perms);
    const take = () => {
      const req = takeConnectionEdit(token, (ds) => perms.has(ds));
      if (req) setAction({ type: 'edit-connection', ...req });
    };
    take();
    return onConnectionEditRequest(take);
  }, [token, perms]);

  const value = useMemo<AdminContextValue | null>(() => {
    if (!session || !tree) return null;
    const visible = new Map([...perms].filter(([ds]) => !denied.has(ds)));
    return {
      session,
      tree,
      api,
      permissions: visible,
      canCreateIn: {
        connection: [...visible].filter(([, p]) => canCreateConnection(p)).map(([ds]) => ds),
        group: [...visible].filter(([, p]) => canCreateGroup(p)).map(([ds]) => ds),
      },
      deniedNotice: notice,
      open: setAction,
      close,
      markDenied,
      changed: onChanged,
    };
  }, [session, tree, perms, denied, notice, api, close, markDenied, onChanged]);

  if (!value) return <>{children}</>;
  return (
    <AdminContext.Provider value={value}>
      {children}
      {action ? (
        <Suspense fallback={null}>
          <AdminLayer action={action} />
        </Suspense>
      ) : null}
    </AdminContext.Provider>
  );
}
