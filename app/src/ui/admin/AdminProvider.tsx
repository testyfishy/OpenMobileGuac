import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PermissionSet } from '../../core/models/Admin.ts';
import type { AuthSession } from '../../core/models/AuthSession.ts';
import type { ConnectionTree } from '../../core/models/Connection.ts';
import { useServices } from '../services/context.ts';
import { AdminContext, type AdminAction, type AdminContextValue } from './AdminContext.ts';
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
  onChanged,
  children,
}: {
  session: AuthSession | undefined;
  tree: ConnectionTree | undefined;
  onChanged: () => void;
  children: ReactNode;
}) {
  const { admin: api } = useServices();
  const [perms, setPerms] = useState<ReadonlyMap<string, PermissionSet>>(new Map());
  const [denied, setDenied] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState(false);
  const [action, setAction] = useState<AdminAction | null>(null);

  // Reload permissions whenever the tree is (re)loaded; a refresh also clears any 403 state.
  useEffect(() => {
    if (!session || !tree) return undefined;
    let live = true;
    const sources = tree.dataSources.map((d) => d.dataSource);
    void Promise.all(
      sources.map((ds) =>
        api.getEffectivePermissions(session, ds).then(
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
  }, [api, session, tree]);

  const markDenied = useCallback((ds: string) => {
    setDenied((d) => new Set([...d, ds]));
    setNotice(true);
  }, []);

  const close = useCallback(() => setAction(null), []);

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
