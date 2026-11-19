import { useId, useState } from 'react';
import type { Combo } from '../../session/keys/KeyModel.ts';
import { ChromeButton } from './ChromeButton.tsx';
import { comboMenuEntries, reduceComboList, validateCombo } from './combos.ts';
import { IconArrow, IconTrash } from './icons.tsx';
import { sessionStrings } from './sessionStrings.ts';
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
  const t = sessionStrings.combos;

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
    <Sheet title={editing ? t.editTitle : t.title} onClose={onClose}>
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
              {t.typeClipboard}
            </ChromeButton>
            <ChromeButton className="omg-btn--ghost" onClick={() => setEditing(true)}>
              {t.editMine}
            </ChromeButton>
          </div>
        </>
      )}
      {editing && (
        <>
          {customCombos.length === 0 && <p className="omg-muted">{t.noneYet}</p>}
          <ol className="omg-combo-list">
            {customCombos.map((c, i) => (
              <li key={`${i}:${c}`} className="omg-combo-list__item">
                <span className="omg-combo-list__label">{c}</span>
                <ChromeButton
                  className="omg-btn--icon"
                  aria-label={t.moveUp(c)}
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
                  aria-label={t.moveDown(c)}
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
                  aria-label={t.remove(c)}
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
              {t.newCombo}
            </label>
            <div className="omg-combo-form__row">
              <input
                id={inputId}
                className="omg-input"
                value={draft}
                placeholder={t.placeholder}
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
                {sessionStrings.common.add}
              </button>
            </div>
            <p
              id={errorId}
              className={error || (preview && !preview.ok) ? 'omg-error' : 'omg-muted'}
            >
              {error ??
                (preview ? (preview.ok ? t.willSend(preview.canonical) : preview.error) : t.syntax)}
            </p>
          </form>
          <div className="omg-sheet__actions">
            <ChromeButton className="omg-btn--ghost" onClick={() => setEditing(false)}>
              {sessionStrings.common.done}
            </ChromeButton>
          </div>
        </>
      )}
    </Sheet>
  );
}
