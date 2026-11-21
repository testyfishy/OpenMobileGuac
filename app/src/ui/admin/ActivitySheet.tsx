import { useCallback, useEffect, useState } from 'react';
import { isGuacApiError } from '../../core/api/errors.ts';
import {
  EMPTY_PERMISSIONS,
  type ActiveConnection,
  type HistoryEntry,
} from '../../core/models/Admin.ts';
import { Dialog } from '../components/Dialog.tsx';
import { ErrorBanner, Spinner } from '../components/Feedback.tsx';
import { Sheet } from '../components/Sheet.tsx';
import { useToast } from '../components/toastContext.ts';
import { describeError, type UiError } from '../errors/errorMessages.ts';
import { haptic } from '../services/native.ts';
import { strings } from '../strings.ts';
import { useAdmin } from './AdminContext.ts';
import { adminStrings } from './adminStrings.ts';
import { canKill } from './permissions.ts';

const HISTORY_SHOWN = 15;

/**
 * Who is using a connection now (with Disconnect where permitted) and its recent history
 * (docs/protocol-notes.md §8.5).
 */
export function ActivitySheet({
  dataSource,
  id,
  name,
  onClose,
}: {
  dataSource: string;
  id: string;
  name: string;
  onClose: () => void;
}) {
  const admin = useAdmin();
  const toast = useToast();
  const s = adminStrings.sessions;
  const [active, setActive] = useState<ActiveConnection[] | 'unavailable' | undefined>(undefined);
  const [history, setHistory] = useState<HistoryEntry[] | 'unavailable' | undefined>(undefined);
  const [confirm, setConfirm] = useState<ActiveConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | undefined>(undefined);
  const [version, setVersion] = useState(0);
  const session = admin?.session;
  const api = admin?.api;

  const load = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    if (!api || !session) return undefined;
    let live = true;
    void api.listActiveConnections(session, dataSource).then(
      (list) => live && setActive(list.filter((x) => x.connectionIdentifier === id)),
      () => live && setActive('unavailable'),
    );
    void api.getConnectionHistory(session, dataSource, id).then(
      (list) => live && setHistory(list.slice(0, HISTORY_SHOWN)),
      () => live && setHistory('unavailable'),
    );
    return () => {
      live = false;
    };
  }, [api, session, dataSource, id, version]);

  if (!admin) return null;
  const perms = admin.permissions.get(dataSource) ?? EMPTY_PERMISSIONS;
  const when = (ms: number | undefined) => (ms === undefined ? '' : new Date(ms).toLocaleString());

  const kill = async (a: ActiveConnection) => {
    setBusy(true);
    setError(undefined);
    try {
      await admin.api.killActiveConnections(admin.session, dataSource, [a.identifier]);
      haptic('success');
      toast.show(s.disconnected);
      setConfirm(null);
      load();
      admin.changed();
    } catch (err) {
      haptic('error');
      if (isGuacApiError(err, 'permission-denied')) admin.markDenied(dataSource);
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={s.title(name)} onClose={onClose}>
      {error && !confirm ? <ErrorBanner error={error} /> : null}
      <h3 className="subsection-title">{s.active}</h3>
      {active === undefined ? <Spinner label={adminStrings.loading} /> : null}
      {active === 'unavailable' ? <p className="muted">{s.unavailable}</p> : null}
      {Array.isArray(active) && active.length === 0 ? <p className="muted">{s.noActive}</p> : null}
      {Array.isArray(active) && active.length > 0 ? (
        <ul className="list adm-activity">
          {active.map((x) => (
            <li key={x.identifier} className="row adm-activity-row">
              <span className="row-text">
                <span className="row-title">{x.username || s.anonymous}</span>
                <span className="row-subtitle">
                  {[
                    x.startDate ? s.since(when(x.startDate)) : '',
                    x.remoteHost ? s.from(x.remoteHost) : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              {canKill(perms, x.identifier) ? (
                <button
                  type="button"
                  className="btn btn-small btn-danger-ghost"
                  onClick={() => {
                    setError(undefined);
                    setConfirm(x);
                  }}
                >
                  {s.disconnect}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <h3 className="subsection-title">{s.history}</h3>
      {history === undefined ? <Spinner label={adminStrings.loading} /> : null}
      {history === 'unavailable' ? <p className="muted">{s.unavailable}</p> : null}
      {Array.isArray(history) && history.length === 0 ? (
        <p className="muted">{s.noHistory}</p>
      ) : null}
      {Array.isArray(history) && history.length > 0 ? (
        <ul className="plain-list adm-history">
          {history.map((h, i) => (
            <li key={`${h.startDate ?? 0}-${i}`}>
              <strong>{h.username || s.anonymous}</strong> · {when(h.startDate)}
              {' · '}
              {h.active || h.endDate === undefined
                ? s.ongoing
                : s.duration(
                    Math.max(0, Math.round(((h.endDate ?? 0) - (h.startDate ?? 0)) / 60000)),
                  )}
              {h.remoteHost ? ` · ${s.from(h.remoteHost)}` : ''}
            </li>
          ))}
        </ul>
      ) : null}

      {confirm ? (
        <Dialog
          tone="danger"
          title={s.disconnectTitle(confirm.username || s.anonymous)}
          onCancel={() => setConfirm(null)}
          actions={
            <>
              <button
                type="button"
                className="btn"
                onClick={() => setConfirm(null)}
                disabled={busy}
              >
                {strings.common.cancel}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void kill(confirm)}
                disabled={busy}
              >
                {s.disconnect}
              </button>
            </>
          }
        >
          <p>{s.disconnectBody}</p>
          {/* In the dialog: behind its backdrop the reason would not be seen. */}
          {error ? <ErrorBanner error={error} /> : null}
        </Dialog>
      ) : null}
    </Sheet>
  );
}
