import { useId, useState } from 'react';
import { Dialog } from '../components/Dialog.tsx';
import { strings } from '../strings.ts';
import { sinceLabel, type InUsePerson, type InUsePlan } from './inUse.ts';

type Prompt = Extract<InUsePlan, { kind: 'prompt' }>;

function personLine(p: InUsePerson, now: number): string {
  const s = strings.session;
  const since = sinceLabel(p.startDate, now);
  if (p.own) return s.inUseYou(since);
  return p.username ? s.inUseUser(p.username, since) : s.inUseSomeone(since);
}

function DontAsk({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <label className="check-row" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{strings.session.inUseDontAsk}</span>
    </label>
  );
}

/**
 * "<name> is already in use" (MUL-5, setting "Ask before connecting"): the server reports
 * active sessions on the connection. Buttons appear only when they can work (see
 * `planInUse`). "Don't ask again" goes with the chosen answer; Cancel stores nothing.
 */
export function InUseDialog({
  name,
  plan,
  now,
  busy,
  error,
  onExisting,
  onEnd,
  onAnother,
  onCancel,
}: {
  name: string;
  plan: Prompt;
  now: number;
  busy?: boolean;
  error?: string | undefined;
  onExisting: (dontAskAgain: boolean) => void;
  onEnd: (dontAskAgain: boolean) => void;
  onAnother: (dontAskAgain: boolean) => void;
  onCancel: () => void;
}) {
  const s = strings.session;
  const [dontAsk, setDontAsk] = useState(false);
  // Every session is listed: "End it" may end several, and none should be a surprise.
  const people = plan.people;
  return (
    <Dialog
      title={s.inUseTitle(name)}
      onCancel={onCancel}
      stackActions
      actions={
        <>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            {strings.common.cancel}
          </button>
          <button
            type="button"
            className={plan.existing ? 'btn' : 'btn btn-primary'}
            data-action="open-another"
            onClick={() => onAnother(dontAsk)}
            disabled={busy}
          >
            {s.inUseAnother}
          </button>
          {plan.end.length > 0 ? (
            <button
              type="button"
              className="btn btn-danger-ghost"
              data-action="end-and-start"
              onClick={() => onEnd(dontAsk)}
              disabled={busy}
            >
              {s.inUseEnd(plan.end.length)}
            </button>
          ) : null}
          {plan.existing ? (
            <button
              type="button"
              className="btn btn-primary"
              data-action="open-existing"
              onClick={() => onExisting(dontAsk)}
              disabled={busy}
            >
              {s.inUseOpenExisting}
            </button>
          ) : null}
        </>
      }
    >
      <p>{s.inUseBody(plan.count)}</p>
      {people.length > 0 ? (
        <ul className="in-use-people">
          {people.map((p, i) => (
            <li key={i}>{personLine(p, now)}</li>
          ))}
        </ul>
      ) : null}
      {plan.cannotJoin ? <p className="muted">{s.inUseCannotJoin}</p> : null}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      <DontAsk checked={dontAsk} onChange={setDontAsk} />
    </Dialog>
  );
}

/** "Connect to <name>?" (setting "Ask before connecting" = Always, connection not in use). */
export function ConnectConfirmDialog({
  name,
  checked,
  onConnect,
  onCancel,
}: {
  name: string;
  /** The server answered (so "no other session" is known). */
  checked: boolean;
  onConnect: (dontAskAgain: boolean) => void;
  onCancel: () => void;
}) {
  const s = strings.session;
  const [dontAsk, setDontAsk] = useState(false);
  return (
    <Dialog
      title={s.connectTitle(name)}
      onCancel={onCancel}
      actions={
        <>
          <button type="button" className="btn" onClick={onCancel}>
            {strings.common.cancel}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            data-action="connect"
            onClick={() => onConnect(dontAsk)}
          >
            {s.connectConfirm}
          </button>
        </>
      }
    >
      {checked ? <p>{s.connectBody}</p> : null}
      <DontAsk checked={dontAsk} onChange={setDontAsk} />
    </Dialog>
  );
}
