import type { Connection, ConnectionGroup } from '../../core/models/Connection.ts';
import { ROOT_GROUP_IDENTIFIER } from '../../core/models/Connection.ts';
import { InfoBanner } from '../components/Feedback.tsx';
import { Icon } from '../components/Icon.tsx';
import { IconButton } from '../components/Screen.tsx';
import { useAdmin } from './AdminContext.ts';
import { adminStrings } from './adminStrings.ts';
import {
  canCloneConnection,
  canDeleteConnection,
  canEditConnection,
  canManageConnection,
  canManageGroup,
  canViewSessions,
} from './permissions.ts';

/**
 * The small, additive hooks into the connection browser. Each renders nothing unless the
 * signed-in account may manage the item (docs/protocol-notes.md §8.3).
 */

/**
 * Header buttons: Active sessions (server-wide list, when permitted) and "+" (New connection
 * / New folder). Both live here so the connection screen mounts a single entry point.
 */
export function AdminAddButton() {
  const admin = useAdmin();
  if (!admin) return null;
  const { connection, group } = admin.canCreateIn;
  const sessions = [...admin.permissions.values()].some(canViewSessions);
  const add = connection.length > 0 || group.length > 0;
  if (!sessions && !add) return null;
  return (
    <>
      {sessions ? (
        <IconButton
          icon="pulse"
          label={adminStrings.sessions.allButton}
          onClick={() => admin.open({ type: 'sessions' })}
        />
      ) : null}
      {add ? (
        <IconButton
          icon="plus"
          label={adminStrings.add}
          onClick={() => admin.open({ type: 'add-menu' })}
        />
      ) : null}
    </>
  );
}

/** Shown after a 403: explains why the management options disappeared. */
export function AdminNotice() {
  const admin = useAdmin();
  if (!admin?.deniedNotice) return null;
  return <InfoBanner tone="warning">{adminStrings.denied.banner}</InfoBanner>;
}

/** A "…" button on a folder row that opens the folder's management menu. */
export function AdminGroupButton({ group }: { group: ConnectionGroup }) {
  const admin = useAdmin();
  const perms = admin?.permissions.get(group.dataSource);
  if (!admin || !perms || !canManageGroup(perms, group.identifier)) return null;
  const label = adminStrings.folderActions(group.name);
  return (
    <button
      type="button"
      className="icon-btn adm-group-btn"
      aria-label={label}
      title={label}
      onClick={() =>
        admin.open({ type: 'group-menu', dataSource: group.dataSource, id: group.identifier })
      }
    >
      <Icon name="edit" />
    </button>
  );
}

/** Edit / Clone / Move / Delete / Activity in a connection's details sheet. */
export function AdminConnectionActions({
  connection,
  onAction,
}: {
  connection: Connection;
  /** Called before an action opens (e.g. to close the details sheet). */
  onAction: () => void;
}) {
  const admin = useAdmin();
  const perms = admin?.permissions.get(connection.dataSource);
  if (!admin || !perms || !canManageConnection(perms, connection.identifier)) return null;
  const a = adminStrings;
  const ds = connection.dataSource;
  const id = connection.identifier;
  const go = (fn: () => void) => () => {
    onAction();
    fn();
  };
  return (
    <section className="adm-actions" aria-label={a.manageTitle}>
      <h3 className="subsection-title">{a.manageTitle}</h3>
      <div className="adm-action-grid">
        {canEditConnection(perms, id) ? (
          <button
            type="button"
            className="btn"
            onClick={go(() => admin.open({ type: 'edit-connection', dataSource: ds, id }))}
          >
            <Icon name="edit" /> {a.edit}
          </button>
        ) : null}
        {canCloneConnection(perms, id) ? (
          <button
            type="button"
            className="btn"
            onClick={go(() => admin.open({ type: 'clone-connection', dataSource: ds, id }))}
          >
            <Icon name="copy" /> {a.clone}
          </button>
        ) : null}
        {canEditConnection(perms, id) ? (
          <button
            type="button"
            className="btn"
            onClick={go(() =>
              admin.open({
                type: 'move',
                kind: 'connection',
                dataSource: ds,
                id,
                name: connection.name,
                parent: connection.parentIdentifier ?? ROOT_GROUP_IDENTIFIER,
              }),
            )}
          >
            <Icon name="folder" /> {a.move}
          </button>
        ) : null}
        <button
          type="button"
          className="btn"
          onClick={go(() =>
            admin.open({ type: 'activity', dataSource: ds, id, name: connection.name }),
          )}
        >
          <Icon name="pulse" /> {a.activity}
        </button>
        {canDeleteConnection(perms, id) ? (
          <button
            type="button"
            className="btn btn-danger-ghost"
            onClick={go(() =>
              admin.open({
                type: 'delete',
                kind: 'connection',
                dataSource: ds,
                id,
                name: connection.name,
              }),
            )}
          >
            <Icon name="trash" /> {a.delete}
          </button>
        ) : null}
      </div>
    </section>
  );
}
