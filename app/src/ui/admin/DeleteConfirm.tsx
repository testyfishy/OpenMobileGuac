import { useState } from 'react';
import { isGuacApiError } from '../../core/api/errors.ts';
import { Dialog } from '../components/Dialog.tsx';
import { useToast } from '../components/toastContext.ts';
import { describeError, type UiError } from '../errors/errorMessages.ts';
import { haptic } from '../services/native.ts';
import { strings } from '../strings.ts';
import { useAdmin } from './AdminContext.ts';
import { adminStrings } from './adminStrings.ts';
import { countContents, findGroup } from './folderTree.ts';

/**
 * Confirms a permanent delete on the server. For a folder it says that its contents go too
 * (the database cascades; docs/protocol-notes.md §8.2) and counts what this account sees.
 */
export function DeleteConfirm({
  kind,
  dataSource,
  id,
  name,
  onCancel,
  onDeleted,
}: {
  kind: 'connection' | 'group';
  dataSource: string;
  id: string;
  name: string;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const admin = useAdmin();
  const toast = useToast();
  const r = adminStrings.remove;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | undefined>(undefined);
  if (!admin) return null;
  const group = kind === 'group' ? findGroup(admin.tree, dataSource, id) : undefined;
  const counts = group ? countContents(group) : { connections: 0, groups: 0 };

  const run = async () => {
    setBusy(true);
    setError(undefined);
    try {
      if (kind === 'connection') await admin.api.deleteConnection(admin.session, dataSource, id);
      else await admin.api.deleteGroup(admin.session, dataSource, id);
      haptic('success');
      toast.show(adminStrings.deleted(name));
      admin.changed();
      onDeleted();
    } catch (err) {
      haptic('error');
      if (isGuacApiError(err, 'permission-denied')) admin.markDenied(dataSource);
      setError(describeError(err));
      setBusy(false);
    }
  };

  return (
    <Dialog
      tone="danger"
      title={kind === 'connection' ? r.titleConnection(name) : r.titleFolder(name)}
      onCancel={busy ? () => undefined : onCancel}
      actions={
        <>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            {strings.common.cancel}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => void run()}
            disabled={busy}
          >
            {busy ? r.deleting : r.confirm}
          </button>
        </>
      }
    >
      <p>
        {kind === 'connection' ? r.bodyConnection : r.bodyFolder(counts.connections, counts.groups)}
      </p>
      {error ? (
        <p className="field-error" role="alert">
          {error.title}
          {error.detail ? ` ${error.detail}` : ''}
        </p>
      ) : null}
    </Dialog>
  );
}
