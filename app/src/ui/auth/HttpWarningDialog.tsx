import { useId, useState } from 'react';
import { Dialog } from '../components/Dialog.tsx';
import { strings } from '../strings.ts';

/** Shown before credentials go to a plain-http server (allowed, but informed). */
export function HttpWarningDialog({
  host,
  onCancel,
  onProceed,
}: {
  host: string;
  onCancel: () => void;
  onProceed: (dontShowAgain: boolean) => void;
}) {
  const w = strings.httpWarning;
  const [dontShow, setDontShow] = useState(false);
  const id = useId();
  return (
    <Dialog
      title={w.title}
      tone="warning"
      onCancel={onCancel}
      actions={
        <>
          <button type="button" className="btn" onClick={onCancel}>
            {strings.common.cancel}
          </button>
          <button type="button" className="btn btn-warning" onClick={() => onProceed(dontShow)}>
            {w.proceed}
          </button>
        </>
      }
    >
      <p>{w.body(host)}</p>
      <label className="check-row" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={dontShow}
          onChange={(e) => setDontShow(e.target.checked)}
        />
        <span>{w.dontShowAgain}</span>
      </label>
    </Dialog>
  );
}
