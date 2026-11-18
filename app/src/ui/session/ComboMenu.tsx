import { useId, useState } from 'react';
import type { Combo } from '../../session/keys/KeyModel.ts';
import { ChromeButton } from './ChromeButton.tsx';
import { comboMenuEntries, reduceComboList, validateCombo } from './combos.ts';
import { IconArrow, IconTrash } from './icons.tsx';
import { Sheet } from './Sheet.tsx';

export interface ComboMenuProps {
  readonly customCombos: readonly string[];
  readonly onRun: (combo: Combo, label: string) => void;
  readonly onChangeCombos: (list: string[]) => void;
  readonly onTypeClipboard: () => void;
  readonly onClose: () => void;
}

/** KEY-4: presets plus user combos (add, delete, reorder), and "type clipboard" (CLP-3). */
export function ComboMenu({
  customCombos,
  onRun,
  onChangeCombos,
  onTypeClipboard,
  onClose,
}: ComboMenuProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const errorId = useId();
  const entries = comboMenuEntries(customCombos);
  const preview = draft.trim() === '' ? null : validateCombo(draft);

  const add = () => {
    const r = reduceComboList(customCombos, { type: 'add', text: draft });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setError(null);
    setDraft('');
    onChangeCombos(r.list);
  };

  return (
    <Sheet title={editing ? 'Edit key combos' : 'Key combos'} onClose={onClose}>
      {!editing && (
        <>
          <div className="omg-combo-grid">
            {entries.map((e) => (
              <ChromeButton
                key={e.key}
                className="omg-combo"
                onClick={() => {
                  onRun(e.combo, e.label);
                  onClose();
                }}
              >
                {e.label}
              </ChromeButton>
            ))}
          </div>
          <div className="omg-sheet__actions">
            <ChromeButton
              className="omg-btn--ghost"
              onClick={() => {
                onTypeClipboard();
                onClose();
              }}
            >
              Type clipboard as keystrokes
            </ChromeButton>
            <ChromeButton className="omg-btn--ghost" onClick={() => setEditing(true)}>
              Edit my combos
            </ChromeButton>
          </div>
        </>
      )}
      {editing && (
        <>
          {customCombos.length === 0 && (
            <p className="omg-muted">No custom combos yet. Add one below.</p>
          )}
          <ol className="omg-combo-list">
            {customCombos.map((c, i) => (
              <li key={`${i}:${c}`} className="omg-combo-list__item">
                <span className="omg-combo-list__label">{c}</span>
                <ChromeButton
                  className="omg-btn--icon"
                  aria-label={`Move ${c} up`}
                  disabled={i === 0}
                  onClick={() =>
                    onChangeCombos(
                      reduceComboList(customCombos, { type: 'move', index: i, delta: -1 }).list,
                    )
                  }
                >
                  <IconArrow dir="up" />
                </ChromeButton>
                <ChromeButton
                  className="omg-btn--icon"
                  aria-label={`Move ${c} down`}
                  disabled={i === customCombos.length - 1}
                  onClick={() =>
                    onChangeCombos(
                      reduceComboList(customCombos, { type: 'move', index: i, delta: 1 }).list,
                    )
                  }
                >
                  <IconArrow dir="down" />
                </ChromeButton>
                <ChromeButton
                  className="omg-btn--icon omg-btn--danger"
                  aria-label={`Delete ${c}`}
                  onClick={() =>
                    onChangeCombos(reduceComboList(customCombos, { type: 'remove', index: i }).list)
                  }
                >
                  <IconTrash />
                </ChromeButton>
              </li>
            ))}
          </ol>
          <form
            className="omg-combo-form"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <label htmlFor={inputId} className="omg-label">
              New combo
            </label>
            <div className="omg-combo-form__row">
              <input
                id={inputId}
                className="omg-input"
                value={draft}
                placeholder="e.g. Ctrl+Shift+T or Ctrl+K, Ctrl+C"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                aria-invalid={error !== null}
                aria-describedby={errorId}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setError(null);
                }}
              />
              <button type="submit" className="omg-btn omg-btn--primary" disabled={!preview?.ok}>
                Add
              </button>
            </div>
            <p
              id={errorId}
              className={error || (preview && !preview.ok) ? 'omg-error' : 'omg-muted'}
            >
              {error ??
                (preview
                  ? preview.ok
                    ? `Will send: ${preview.canonical}`
                    : preview.error
                  : 'Use + between keys held together, a comma between steps.')}
            </p>
          </form>
          <div className="omg-sheet__actions">
            <ChromeButton className="omg-btn--ghost" onClick={() => setEditing(false)}>
              Done
            </ChromeButton>
          </div>
        </>
      )}
    </Sheet>
  );
}
