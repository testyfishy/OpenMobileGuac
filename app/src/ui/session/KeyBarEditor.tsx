import { useId, useState } from 'react';
import { ChromeButton } from './ChromeButton.tsx';
import { IconArrow, IconTrash } from './icons.tsx';
import {
  MAX_ROWS,
  availableTokens,
  editKeyBarLayout,
  resolveKeyBarLayout,
  tokenLabel,
  tokenSpokenLabel,
  type KeyBarEdit,
  type KeyBarLayout,
} from './keyBarLayout.ts';
import { Sheet } from './Sheet.tsx';

export interface KeyBarEditorProps {
  readonly layout: KeyBarLayout | null;
  readonly customCombos: readonly string[];
  readonly onChange: (layout: string[][] | null) => void;
  readonly onClose: () => void;
}

/** KEY-7: reorder / add / remove keys and rows; reset to the built-in layout. */
export function KeyBarEditor({ layout, customCombos, onChange, onClose }: KeyBarEditorProps) {
  const rows = resolveKeyBarLayout(layout);
  const [row, setRow] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const tokens = availableTokens(customCombos);
  const [toAdd, setToAdd] = useState(tokens[0] ?? 'Esc');
  const selectId = useId();
  const activeRow = Math.min(row, rows.length - 1);

  const apply = (edit: KeyBarEdit) => onChange(editKeyBarLayout(layout, edit));

  return (
    <Sheet title="Edit key bar" onClose={onClose}>
      <p className="omg-muted">
        Tap a row to select it, tap a key to move or remove it. With Fn in the first row, the other
        rows show when Fn is on.
      </p>
      <ol className="omg-kbe-rows">
        {rows.map((r, ri) => (
          <li
            key={ri}
            className={ri === activeRow ? 'omg-kbe-row omg-kbe-row--on' : 'omg-kbe-row'}
            aria-label={`Row ${ri + 1}${ri === activeRow ? ', selected' : ''}`}
          >
            <div className="omg-kbe-row__head">
              <ChromeButton
                className="omg-btn--ghost omg-kbe-row__select"
                aria-pressed={ri === activeRow}
                onClick={() => {
                  setRow(ri);
                  setSelected(null);
                }}
              >
                Row {ri + 1}
              </ChromeButton>
              <ChromeButton
                className="omg-btn--icon"
                aria-label={`Move row ${ri + 1} up`}
                disabled={ri === 0}
                onClick={() => {
                  apply({ type: 'move-row', row: ri, delta: -1 });
                  setRow(ri - 1);
                }}
              >
                <IconArrow dir="up" />
              </ChromeButton>
              <ChromeButton
                className="omg-btn--icon"
                aria-label={`Move row ${ri + 1} down`}
                disabled={ri === rows.length - 1}
                onClick={() => {
                  apply({ type: 'move-row', row: ri, delta: 1 });
                  setRow(ri + 1);
                }}
              >
                <IconArrow dir="down" />
              </ChromeButton>
              <ChromeButton
                className="omg-btn--icon omg-btn--danger"
                aria-label={`Delete row ${ri + 1}`}
                disabled={rows.length <= 1}
                onClick={() => {
                  apply({ type: 'remove-row', row: ri });
                  setRow(0);
                  setSelected(null);
                }}
              >
                <IconTrash />
              </ChromeButton>
            </div>
            <div className="omg-kbe-keys">
              {r.length === 0 && <span className="omg-muted">Empty row</span>}
              {r.map((token, ki) => {
                const isSel = ri === activeRow && selected === ki;
                return (
                  <span key={`${ki}:${token}`} className="omg-kbe-key">
                    <ChromeButton
                      className={isSel ? 'omg-key omg-key--locked' : 'omg-key'}
                      aria-label={`${tokenSpokenLabel(token)}${isSel ? ', selected' : ''}`}
                      aria-pressed={isSel}
                      onClick={() => {
                        setRow(ri);
                        setSelected(isSel ? null : ki);
                      }}
                    >
                      {tokenLabel(token)}
                    </ChromeButton>
                    {isSel && (
                      <span className="omg-kbe-key__actions">
                        <ChromeButton
                          className="omg-btn--icon"
                          aria-label={`Move ${tokenSpokenLabel(token)} left`}
                          disabled={ki === 0}
                          onClick={() => {
                            apply({ type: 'move', row: ri, index: ki, delta: -1 });
                            setSelected(ki - 1);
                          }}
                        >
                          <IconArrow dir="left" />
                        </ChromeButton>
                        <ChromeButton
                          className="omg-btn--icon"
                          aria-label={`Move ${tokenSpokenLabel(token)} right`}
                          disabled={ki === r.length - 1}
                          onClick={() => {
                            apply({ type: 'move', row: ri, index: ki, delta: 1 });
                            setSelected(ki + 1);
                          }}
                        >
                          <IconArrow dir="right" />
                        </ChromeButton>
                        <ChromeButton
                          className="omg-btn--icon omg-btn--danger"
                          aria-label={`Remove ${tokenSpokenLabel(token)}`}
                          onClick={() => {
                            apply({ type: 'remove', row: ri, index: ki });
                            setSelected(null);
                          }}
                        >
                          <IconTrash />
                        </ChromeButton>
                      </span>
                    )}
                  </span>
                );
              })}
            </div>
          </li>
        ))}
      </ol>
      <form
        className="omg-combo-form"
        onSubmit={(e) => {
          e.preventDefault();
          apply({ type: 'add', row: activeRow, token: toAdd });
        }}
      >
        <label htmlFor={selectId} className="omg-label">
          Add to row {activeRow + 1}
        </label>
        <div className="omg-combo-form__row">
          <select
            id={selectId}
            className="omg-input"
            value={toAdd}
            onChange={(e) => setToAdd(e.target.value)}
          >
            {tokens.map((t) => (
              <option key={t} value={t}>
                {t.startsWith('combo:') ? `Combo: ${tokenLabel(t)}` : tokenSpokenLabel(t)}
              </option>
            ))}
          </select>
          <button type="submit" className="omg-btn omg-btn--primary">
            Add
          </button>
        </div>
      </form>
      <div className="omg-sheet__actions">
        <ChromeButton
          className="omg-btn--ghost"
          disabled={rows.length >= MAX_ROWS}
          onClick={() => {
            apply({ type: 'add-row' });
            setRow(rows.length);
            setSelected(null);
          }}
        >
          Add row
        </ChromeButton>
        <ChromeButton
          className="omg-btn--ghost"
          onClick={() => {
            onChange(null);
            setRow(0);
            setSelected(null);
          }}
        >
          Reset to default
        </ChromeButton>
        <ChromeButton className="omg-btn--primary" onClick={onClose}>
          Done
        </ChromeButton>
      </div>
    </Sheet>
  );
}
