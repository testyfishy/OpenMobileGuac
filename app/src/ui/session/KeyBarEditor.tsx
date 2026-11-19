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
import { sessionStrings } from './sessionStrings.ts';
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
  const t = sessionStrings.keyBarEditor;

  return (
    <Sheet title={t.title} onClose={onClose}>
      <p className="omg-muted">{t.intro}</p>
      <ol className="omg-kbe-rows">
        {rows.map((r, ri) => (
          <li
            key={ri}
            className={ri === activeRow ? 'omg-kbe-row omg-kbe-row--on' : 'omg-kbe-row'}
            aria-label={ri === activeRow ? t.rowSelected(ri + 1) : t.row(ri + 1)}
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
                {t.row(ri + 1)}
              </ChromeButton>
              <ChromeButton
                className="omg-btn--icon"
                aria-label={t.moveRowUp(ri + 1)}
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
                aria-label={t.moveRowDown(ri + 1)}
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
                aria-label={t.deleteRow(ri + 1)}
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
              {r.length === 0 && <span className="omg-muted">{t.emptyRow}</span>}
              {r.map((token, ki) => {
                const isSel = ri === activeRow && selected === ki;
                return (
                  <span key={`${ki}:${token}`} className="omg-kbe-key">
                    <ChromeButton
                      className={isSel ? 'omg-key omg-key--locked' : 'omg-key'}
                      aria-label={
                        isSel ? t.keySelected(tokenSpokenLabel(token)) : tokenSpokenLabel(token)
                      }
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
                          aria-label={t.moveLeft(tokenSpokenLabel(token))}
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
                          aria-label={t.moveRight(tokenSpokenLabel(token))}
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
                          aria-label={t.remove(tokenSpokenLabel(token))}
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
          {t.addToRow(activeRow + 1)}
        </label>
        <div className="omg-combo-form__row">
          <select
            id={selectId}
            className="omg-input"
            value={toAdd}
            onChange={(e) => setToAdd(e.target.value)}
          >
            {tokens.map((tok) => (
              <option key={tok} value={tok}>
                {tok.startsWith('combo:') ? t.comboOption(tokenLabel(tok)) : tokenSpokenLabel(tok)}
              </option>
            ))}
          </select>
          <button type="submit" className="omg-btn omg-btn--primary">
            {sessionStrings.common.add}
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
          {t.addRow}
        </ChromeButton>
        <ChromeButton
          className="omg-btn--ghost"
          onClick={() => {
            onChange(null);
            setRow(0);
            setSelected(null);
          }}
        >
          {t.reset}
        </ChromeButton>
        <ChromeButton className="omg-btn--primary" onClick={onClose}>
          {sessionStrings.common.done}
        </ChromeButton>
      </div>
    </Sheet>
  );
}
