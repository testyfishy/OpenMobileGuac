import { useId, useState } from 'react';
import { Dialog } from '../components/Dialog.tsx';
import { strings } from '../strings.ts';

/**
 * "<name> is already open" (MUL-1, setting "When a connection is already open" = Ask).
 * "Don't ask again" is passed to the chosen answer, which stores it; Cancel stores nothing.
 */
export function AlreadyOpenDialog({
  name,
  onGoToOpen,
  onOpenAnother,
  onCancel,
}: {
  name: string;
  onGoToOpen: (dontAskAgain: boolean) => void;
  onOpenAnother: (dontAskAgain: boolean) => void;
  onCancel: () => void;
}) {
  const s = strings.session;
  const id = useId();
  const [dontAsk, setDontAsk] = useState(false);
  return (
    <Dialog
      title={s.alreadyOpenTitle(name)}
      onCancel={onCancel}
      actions={
        <>
          <button type="button" className="btn" onClick={onCancel}>
            {strings.common.cancel}
          </button>
          <button
            type="button"
            className="btn"
            data-action="open-another"
            onClick={() => onOpenAnother(dontAsk)}
          >
            {s.alreadyOpenAnother}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            data-action="go-to-open"
            onClick={() => onGoToOpen(dontAsk)}
          >
            {s.alreadyOpenGoTo}
          </button>
        </>
      }
    >
      <p>{s.alreadyOpenBody}</p>
      <label className="check-row" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={dontAsk}
          onChange={(e) => setDontAsk(e.target.checked)}
        />
        <span>{s.alreadyOpenDontAsk}</span>
      </label>
    </Dialog>
  );
}
