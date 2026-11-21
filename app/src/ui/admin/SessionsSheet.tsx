import { useCallback, useEffect, useState } from 'react';
import { isGuacApiError } from '../../core/api/errors.ts';
import type { ActiveConnection } from '../../core/models/Admin.ts';
import { Dialog } from '../components/Dialog.tsx';
import { ErrorBanner, Spinner } from '../components/Feedback.tsx';
import { Sheet } from '../components/Sheet.tsx';
import { useToast } from '../components/toastContext.ts';
import { describeError, type UiError } from '../errors/errorMessages.ts';
import { useNav } from '../nav/NavContext.ts';
import { hostOf } from '../servers/serverForm.ts';
import { useServerProfile } from '../servers/useServers.ts';
import { haptic } from '../services/native.ts';
import { useSessions } from '../sessions/SessionsContext.ts';
import { strings } from '../strings.ts';
import { activeSessionRows, type ActiveSessionRow } from './activeSessions.ts';
import { useAdmin } from './AdminContext.ts';
import { adminStrings } from './adminStrings.ts';
import { canViewSessions } from './permissions.ts';

/** The server whose connection list is open (the admin layer lives inside it). */
function useCurrentServerId(): string | undefined {
  const nav = useNav();
  for (let i = nav.state.stack.length - 1; i >= 0; i--) {
    const r = nav.state.stack[i]?.route;
    if (r?.name === 'connections') return r.serverId;
  }
  return undefined;
}

type Loaded = { dataSource: string; items: ActiveConnection[] }[];

/**
 * Every active session on the server (all managed data sources), with Join and Disconnect
 * (docs/protocol-notes.md §8.5). Join opens the active connection (`GUAC_TYPE=a`).
 */
export function SessionsSheet({ onClose }: { onClose: () => void }) {
  const admin = useAdmin();
  const sessions = useSessions();
  const toast = useToast();
  const serverId = useCurrentServerId();
  const lookup = useServerProfile(serverId);
  const s = adminStrings.sessions;
  const [lists, setLists] = useState<Loaded | 'unavailable' | undefined>(undefined);
  const [confirmKill, setConfirmKill] = useState<ActiveSessionRow | null>(null);
  const [confirmJoin, setConfirmJoin] = useState<ActiveSessionRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | undefined>(undefined);
  const [version, setVersion] = useState(0);
  const api = admin?.api;
  const session = admin?.session;
  const permissions = admin?.permissions;

  const load = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    if (!api || !session || !permissions) return undefined;
    let live = true;
    const sources = [...permissions].filter(([, p]) => canViewSessions(p)).map(([ds]) => ds);
    void Promise.allSettled(
      sources.map((ds) =>
        api.listActiveConnections(session, ds).then((items) => ({ dataSource: ds, items })),
      ),
    ).then((results) => {
      if (!live) return;
      const ok = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
      setLists(ok.length === 0 && results.length > 0 ? 'unavailable' : ok);
    });
    return () => {
      live = false;
    };
  }, [api, session, permissions, version]);

  if (!admin) return null;
  const rows = Array.isArray(lists) ? activeSessionRows(admin.tree, lists, admin.permissions) : [];
  const when = (ms: number | undefined) => (ms === undefined ? '' : new Date(ms).toLocaleString());
  const user = (r: ActiveSessionRow) => r.active.username || s.anonymous;
  const connection = (r: ActiveSessionRow) => r.connectionName ?? s.unknownConnection;
  const serverName =
    lookup.status === 'ready' ? lookup.profile.name || hostOf(lookup.profile.baseUrl) : '';

  const kill = async (r: ActiveSessionRow) => {
    setBusy(true);
    setError(undefined);
    try {
      await admin.api.killActiveConnections(admin.session, r.dataSource, [r.active.identifier]);
      haptic('success');
      toast.show(s.disconnected);
      setConfirmKill(null);
      load();
      admin.changed();
    } catch (err) {
      haptic('error');
      if (isGuacApiError(err, 'permission-denied')) admin.markDenied(r.dataSource);
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const join = (r: ActiveSessionRow) => {
    const target = r.joinTarget;
    if (!target || serverId === undefined) return;
    setConfirmJoin(null);
    onClose();
    sessions.open(serverId, serverName, {
      ...target,
      name: s.joinedName(target.name, user(r)),
    });
  };

  return (
    <Sheet title={s.allTitle} onClose={onClose}>
      <p className="muted">{s.allIntro}</p>
      {error ? <ErrorBanner error={error} /> : null}
      {lists === undefined ? <Spinner label={adminStrings.loading} /> : null}
      {lists === 'unavailable' ? <p className="muted">{s.unavailable}</p> : null}
      {Array.isArray(lists) && rows.length === 0 ? <p className="muted">{s.noActive}</p> : null}
      {rows.length > 0 ? (
        <ul className="list adm-activity">
          {rows.map((r) => (
            <li key={`${r.dataSource}/${r.active.identifier}`} className="row adm-activity-row">
              <span className="row-text">
                <span className="row-title">
                  {user(r)} · {connection(r)}
                </span>
                <span className="row-subtitle">
                  {[
                    r.active.startDate ? s.since(when(r.active.startDate)) : '',
                    r.active.remoteHost ? s.from(r.active.remoteHost) : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              {r.joinTarget && serverId !== undefined ? (
                <button type="button" className="btn btn-small" onClick={() => setConfirmJoin(r)}>
                  {s.join}
                </button>
              ) : null}
              {r.canKill ? (
                <button
                  type="button"
                  className="btn btn-small btn-danger-ghost"
                  onClick={() => setConfirmKill(r)}
                >
                  {s.disconnect}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {Array.isArray(lists) ? (
        <button type="button" className="btn" onClick={load}>
          {s.refresh}
        </button>
      ) : null}

      {confirmJoin ? (
        <Dialog
          title={s.joinTitle(user(confirmJoin), connection(confirmJoin))}
          onCancel={() => setConfirmJoin(null)}
          actions={
            <>
              <button type="button" className="btn" onClick={() => setConfirmJoin(null)}>
                {strings.common.cancel}
              </button>
              <button type="button" className="btn btn-primary" onClick={() => join(confirmJoin)}>
                {s.join}
              </button>
            </>
          }
        >
          <p>{s.joinBody}</p>
        </Dialog>
      ) : null}

      {confirmKill ? (
        <Dialog
          tone="danger"
          title={s.disconnectTitle(user(confirmKill))}
          onCancel={() => setConfirmKill(null)}
          actions={
            <>
              <button
                type="button"
                className="btn"
                onClick={() => setConfirmKill(null)}
                disabled={busy}
              >
                {strings.common.cancel}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void kill(confirmKill)}
                disabled={busy}
              >
                {s.disconnect}
              </button>
            </>
          }
        >
          <p>{s.disconnectBody}</p>
        </Dialog>
      ) : null}
    </Sheet>
  );
}
