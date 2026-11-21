import { EMPTY_PERMISSIONS } from '../../core/models/Admin.ts';
import { ROOT_GROUP_IDENTIFIER } from '../../core/models/Connection.ts';
import { Icon, type IconName } from '../components/Icon.tsx';
import { Sheet } from '../components/Sheet.tsx';
import { ActivitySheet } from './ActivitySheet.tsx';
import { SessionsSheet } from './SessionsSheet.tsx';
import { useAdmin, type AdminAction } from './AdminContext.ts';
import { adminStrings } from './adminStrings.ts';
import { ConnectionEditor } from './ConnectionEditor.tsx';
import { DeleteConfirm } from './DeleteConfirm.tsx';
import { findGroup } from './folderTree.ts';
import { GroupEditor } from './GroupEditor.tsx';
import { MoveSheet } from './MoveSheet.tsx';
import {
  canCreateConnection,
  canCreateGroup,
  canDeleteGroup,
  canEditGroup,
  canPlaceIn,
} from './permissions.ts';

/** Renders whichever editor, sheet or dialog the current management action calls for. */
export function AdminLayer({ action }: { action: AdminAction }) {
  const admin = useAdmin();
  if (!admin) return null;
  const close = admin.close;
  switch (action.type) {
    case 'add-menu':
      return <AddMenu />;
    case 'new-connection':
      return (
        <ConnectionEditor
          mode="create"
          dataSource={action.dataSource}
          parent={action.parent}
          onClose={close}
        />
      );
    case 'edit-connection':
      return (
        <ConnectionEditor
          mode="edit"
          dataSource={action.dataSource}
          id={action.id}
          onClose={close}
        />
      );
    case 'clone-connection':
      return (
        <ConnectionEditor
          mode="clone"
          dataSource={action.dataSource}
          id={action.id}
          onClose={close}
        />
      );
    case 'new-group':
      return (
        <GroupEditor
          mode="create"
          dataSource={action.dataSource}
          parent={action.parent}
          onClose={close}
        />
      );
    case 'edit-group':
      return (
        <GroupEditor mode="edit" dataSource={action.dataSource} id={action.id} onClose={close} />
      );
    case 'group-menu':
      return <GroupMenu dataSource={action.dataSource} id={action.id} />;
    case 'sessions':
      return <SessionsSheet onClose={close} />;
    case 'move':
      return (
        <MoveSheet
          kind={action.kind}
          dataSource={action.dataSource}
          id={action.id}
          name={action.name}
          parent={action.parent}
          onClose={close}
        />
      );
    case 'delete':
      return (
        <DeleteConfirm
          kind={action.kind}
          dataSource={action.dataSource}
          id={action.id}
          name={action.name}
          onCancel={close}
          onDeleted={close}
        />
      );
    case 'activity':
      return (
        <ActivitySheet
          dataSource={action.dataSource}
          id={action.id}
          name={action.name}
          onClose={close}
        />
      );
  }
}

function MenuButton({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={
        danger ? 'btn btn-block adm-menu-btn btn-danger-ghost' : 'btn btn-block adm-menu-btn'
      }
      onClick={onClick}
    >
      <Icon name={icon} /> {label}
    </button>
  );
}

function AddMenu() {
  const admin = useAdmin();
  if (!admin) return null;
  const a = adminStrings;
  return (
    <Sheet title={a.addTitle} onClose={admin.close}>
      <div className="form-actions">
        {admin.canCreateIn.connection.length > 0 ? (
          <MenuButton
            icon="monitor"
            label={a.newConnection}
            onClick={() => admin.open({ type: 'new-connection' })}
          />
        ) : null}
        {admin.canCreateIn.group.length > 0 ? (
          <MenuButton
            icon="folder"
            label={a.newFolder}
            onClick={() => admin.open({ type: 'new-group' })}
          />
        ) : null}
      </div>
    </Sheet>
  );
}

function GroupMenu({ dataSource, id }: { dataSource: string; id: string }) {
  const admin = useAdmin();
  if (!admin) return null;
  const a = adminStrings;
  const group = findGroup(admin.tree, dataSource, id);
  const perms = admin.permissions.get(dataSource) ?? EMPTY_PERMISSIONS;
  if (!group) return null;
  const placeable = canPlaceIn(perms, id);
  return (
    <Sheet title={group.name} onClose={admin.close}>
      <div className="form-actions">
        {placeable && canCreateConnection(perms) ? (
          <MenuButton
            icon="monitor"
            label={a.newConnectionHere}
            onClick={() => admin.open({ type: 'new-connection', dataSource, parent: id })}
          />
        ) : null}
        {placeable && canCreateGroup(perms) ? (
          <MenuButton
            icon="folder"
            label={a.newFolderHere}
            onClick={() => admin.open({ type: 'new-group', dataSource, parent: id })}
          />
        ) : null}
        {canEditGroup(perms, id) ? (
          <>
            <MenuButton
              icon="edit"
              label={a.editFolder}
              onClick={() => admin.open({ type: 'edit-group', dataSource, id })}
            />
            <MenuButton
              icon="up"
              label={a.move}
              onClick={() =>
                admin.open({
                  type: 'move',
                  kind: 'group',
                  dataSource,
                  id,
                  name: group.name,
                  parent: group.parentIdentifier ?? ROOT_GROUP_IDENTIFIER,
                })
              }
            />
          </>
        ) : null}
        {canDeleteGroup(perms, id) ? (
          <MenuButton
            icon="trash"
            danger
            label={a.delete}
            onClick={() =>
              admin.open({ type: 'delete', kind: 'group', dataSource, id, name: group.name })
            }
          />
        ) : null}
      </div>
    </Sheet>
  );
}
