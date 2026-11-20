import { useId, useState } from 'react';
import type { SavedCombo } from '../../session/keys/ComboLibrary.ts';
import { ChromeButton } from './ChromeButton.tsx';
import { IconArrow, IconTrash } from './icons.tsx';
import {
  MAX_ROWS,
  availableTokens,
  parseToken,
  textToken,
  tokenLabel,
  tokenSpokenLabel,
  type KeyBarLayout,
} from './keyBarLayout.ts';
import { editRows, type KeyRowsEdit } from '../../session/keys/KeyLayout.ts';
import { sessionStrings } from './sessionStrings.ts';
import { Sheet } from './Sheet.tsx';

export interface KeyBarEditorProps {
  /** The rows being edited (a key set's rows). */
  readonly rows: KeyBarLayout;
  readonly title?: string;
  /** Saved combos (offered as keys, and for labels). */
  readonly combos?: readonly SavedCombo[];
  /** Legacy per-connection text combos (offered as keys). */
  readonly legacyCombos?: readonly string[];
  readonly onChange: (rows: string[][]) => void;
  /** Back to the set's template (omit to hide the button). */
  readonly onReset?: () => void;
  readonly onClose: () => void;
}

function optionLabel(tok: string, combos: readonly SavedCombo[]): string {
  const t = sessionStrings.keyBarEditor;
  const p = parseToken(tok);
  if (p?.kind === 'combo') return t.comboOption(tokenLabel(tok));
  if (p?.kind === 'saved') return t.savedOption(tokenLabel(tok, combos));
  return tokenSpokenLabel(tok, combos);
}

/**
 * KEY-7 / KEY-9: edit a key set's rows: choose a row, add keys (named keys, sticky
 * modifiers, Fn, preset and saved combos, or a key that types text), move or remove keys,
 * add, move and delete rows.
 */
export function KeyBarEditor({
  rows: rowsIn,
  title,
  combos = [],
  legacyCombos = [],
  onChange,
  onReset,
  onClose,
}: KeyBarEditorProps) {
  const rows = rowsIn.length > 0 ? rowsIn : [[]];
  const [row, setRow] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const tokens = availableTokens(legacyCombos, combos);
  const [toAdd, setToAdd] = useState(tokens[0] ?? 'Esc');
  const [text, setText] = useState('');
  const selectId = useId();
  const textId = useId();
  const activeRow = Math.min(row, rows.length - 1);

  const apply = (edit: KeyRowsEdit) => onChange(editRows(rows, edit));
  const t = sessionStrings.keyBarEditor;
  const textTok = text === '' ? null : textToken(text);

  return (
    <Sheet title={title ?? t.title} onClose={onClose} className="omg-sheet--tall">
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
                const spoken = tokenSpokenLabel(token, combos);
                return (
                  <span key={`${ki}:${token}`} className="omg-kbe-key">
                    <ChromeButton
                      className={isSel ? 'omg-key omg-key--locked' : 'omg-key'}
                      aria-label={isSel ? t.keySelected(spoken) : spoken}
                      aria-pressed={isSel}
                      onClick={() => {
                        setRow(ri);
                        setSelected(isSel ? null : ki);
                      }}
                    >
                      {tokenLabel(token, combos)}
                    </ChromeButton>
                    {isSel && (
                      <span className="omg-kbe-key__actions">
                        <ChromeButton
                          className="omg-btn--icon"
                          aria-label={t.moveLeft(spoken)}
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
                          aria-label={t.moveRight(spoken)}
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
                          aria-label={t.remove(spoken)}
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
                {optionLabel(tok, combos)}
              </option>
            ))}
          </select>
          <button type="submit" className="omg-btn omg-btn--primary">
            {sessionStrings.common.add}
          </button>
        </div>
      </form>
      <form
        className="omg-combo-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (textTok === null) return;
          apply({ type: 'add', row: activeRow, token: textTok });
          setText('');
        }}
      >
        <label htmlFor={textId} className="omg-label">
          {t.textLabel}
        </label>
        <div className="omg-combo-form__row">
          <input
            id={textId}
            className="omg-input"
            value={text}
            placeholder={t.textPlaceholder}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" className="omg-btn omg-btn--primary" disabled={textTok === null}>
            {t.addText}
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
        {onReset && (
          <ChromeButton
            className="omg-btn--ghost"
            onClick={() => {
              onReset();
              setRow(0);
              setSelected(null);
            }}
          >
            {t.reset}
          </ChromeButton>
        )}
        <ChromeButton className="omg-btn--primary" onClick={onClose}>
          {sessionStrings.common.done}
        </ChromeButton>
      </div>
    </Sheet>
  );
}
