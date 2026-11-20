import { useState } from 'react';
import { isGuacApiError } from '../../core/api/errors.ts';
import { EMPTY_PERMISSIONS } from '../../core/models/Admin.ts';
import { ErrorBanner } from '../components/Feedback.tsx';
import { Sheet } from '../components/Sheet.tsx';
import { useToast } from '../components/toastContext.ts';
import { describeError, type UiError } from '../errors/errorMessages.ts';
import { haptic } from '../services/native.ts';
import { useAdmin } from './AdminContext.ts';
import { adminStrings } from './adminStrings.ts';
import { FolderList } from './FolderPicker.tsx';
import { folderOptions } from './folderTree.ts';

/**
 * Move a connection or folder. The API call loads the object first and PUTs it back whole
 * with the new parent, so no parameter or attribute is lost (docs/protocol-notes.md §8.1).
 */
export function MoveSheet({
  kind,
  dataSource,
  id,
  name,
  parent,
  onClose,
}: {
  kind: 'connection' | 'group';
  dataSource: string;
  id: string;
  name: string;
  parent: string;
  onClose: () => void;
}) {
  const admin = useAdmin();
  const toast = useToast();
  const p = adminStrings.picker;
  const [target, setTarget] = useState(parent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | undefined>(undefined);
  if (!admin) return null;
  const perms = admin.permissions.get(dataSource) ?? EMPTY_PERMISSIONS;
  const options = folderOptions(admin.tree, dataSource, perms, kind === 'group' ? id : undefined);

  const move = async () => {
    setBusy(true);
    setError(undefined);
    try {
      if (kind === 'connection')
        await admin.api.moveConnection(admin.session, dataSource, id, target);
      else await admin.api.moveGroup(admin.session, dataSource, id, target);
      haptic('success');
      toast.show(adminStrings.moved(name));
      admin.changed();
      onClose();
    } catch (err) {
      haptic('error');
      if (isGuacApiError(err, 'permission-denied')) admin.markDenied(dataSource);
      setError(describeError(err));
      setBusy(false);
    }
  };

  return (
    <Sheet title={p.moveTitle(name)} onClose={busy ? () => undefined : onClose}>
      {error ? <ErrorBanner error={error} /> : null}
      <FolderList options={options} selected={target} current={parent} onPick={setTarget} />
      <div className="form-actions sheet-footer-btn">
        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={busy || target === parent}
          onClick={() => void move()}
        >
          {busy ? p.moving : p.moveHere}
        </button>
      </div>
    </Sheet>
  );
}
