import { useId, useState } from 'react';
import { ChromeButton } from './ChromeButton.tsx';
import { IconArrow, IconTrash } from './icons.tsx';
import { buildSessionActions, type SessionActionContext } from './sessionActions.tsx';
import { sessionStrings } from './sessionStrings.ts';
import { Sheet } from './Sheet.tsx';
import {
  MAX_TOOLBAR_ITEMS,
  TOOLBAR_STYLES,
  availableToolbarActions,
  editToolbarItems,
  resolveToolbarItems,
  type ToolbarAction,
  type ToolbarItemsEdit,
  type ToolbarStyle,
} from './toolbarItems.ts';

export interface ToolbarEditorProps {
  readonly items: readonly string[] | null;
  readonly style: ToolbarStyle;
  readonly labels: 'auto' | 'always' | 'never';
  readonly context: SessionActionContext;
  readonly onItems: (items: string[] | null) => void;
  readonly onStyle: (style: ToolbarStyle) => void;
  readonly onLabels: (labels: 'auto' | 'always' | 'never') => void;
  readonly onClose: () => void;
}

/** Choose the toolbar style and which buttons are in the row, in what order. */
export function ToolbarEditor(p: ToolbarEditorProps) {
  const list = resolveToolbarItems(p.items);
  const actions = buildSessionActions(p.context);
  const available = availableToolbarActions(p.items);
  const [toAdd, setToAdd] = useState<ToolbarAction | ''>(available[0] ?? '');
  const selectId = useId();
  const t = sessionStrings.toolbarEditor;
  const o = sessionStrings.options;
  const names = sessionStrings.toolbar.names;
  const apply = (edit: ToolbarItemsEdit) => p.onItems(editToolbarItems(p.items, edit));
  const addChoice = available.includes(toAdd as ToolbarAction) ? toAdd : (available[0] ?? '');

  return (
    <Sheet title={t.title} onClose={p.onClose}>
      <div className="omg-field">
        <span className="omg-label">{o.toolbarStyle}</span>
        <div className="omg-segmented" role="radiogroup" aria-label={o.toolbarStyle}>
          {TOOLBAR_STYLES.map((s) => (
            <ChromeButton
              key={s}
              role="radio"
              aria-checked={s === p.style}
              className={s === p.style ? 'omg-seg omg-seg--on' : 'omg-seg'}
              onClick={() => p.onStyle(s)}
            >
              {o.toolbarStyles[s]}
            </ChromeButton>
          ))}
        </div>
        <p className="omg-muted">{o.toolbarStyleHint}</p>
      </div>
      <div className="omg-field">
        <span className="omg-label">{o.toolbarLabels}</span>
        <div className="omg-segmented" role="radiogroup" aria-label={o.toolbarLabels}>
          {(['auto', 'always', 'never'] as const).map((v) => (
            <ChromeButton
              key={v}
              role="radio"
              aria-checked={v === p.labels}
              className={v === p.labels ? 'omg-seg omg-seg--on' : 'omg-seg'}
              onClick={() => p.onLabels(v)}
            >
              {o.toolbarLabelOptions[v]}
            </ChromeButton>
          ))}
        </div>
      </div>

      <p className="omg-muted omg-tbe-intro">
        {t.intro} {o.savedForConnection}
      </p>
      {list.length === 0 && <p className="omg-muted">{t.onlyMore}</p>}
      <ol className="omg-combo-list omg-tbe-list">
        {list.map((id, i) => {
          const name = names[id];
          return (
            <li key={id} className="omg-combo-list__item omg-tbe-item">
              <span className="omg-tbe-item__icon" aria-hidden="true">
                {actions[id].icon}
              </span>
              <span className="omg-tbe-item__label">{name}</span>
              <ChromeButton
                className="omg-btn--icon"
                aria-label={t.moveUp(name)}
                disabled={i === 0}
                onClick={() => apply({ type: 'move', index: i, delta: -1 })}
              >
                <IconArrow dir="up" />
              </ChromeButton>
              <ChromeButton
                className="omg-btn--icon"
                aria-label={t.moveDown(name)}
                disabled={i === list.length - 1}
                onClick={() => apply({ type: 'move', index: i, delta: 1 })}
              >
                <IconArrow dir="down" />
              </ChromeButton>
              <ChromeButton
                className="omg-btn--icon omg-btn--danger"
                aria-label={t.remove(name)}
                onClick={() => apply({ type: 'remove', index: i })}
              >
                <IconTrash />
              </ChromeButton>
            </li>
          );
        })}
      </ol>
      {available.length > 0 && (
        <form
          className="omg-combo-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (addChoice !== '') apply({ type: 'add', id: addChoice });
          }}
        >
          <label htmlFor={selectId} className="omg-label">
            {t.add}
          </label>
          <div className="omg-combo-form__row">
            <select
              id={selectId}
              className="omg-input"
              value={addChoice}
              onChange={(e) => setToAdd(e.target.value as ToolbarAction)}
            >
              {available.map((id) => (
                <option key={id} value={id}>
                  {names[id]}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="omg-btn omg-btn--primary"
              disabled={list.length >= MAX_TOOLBAR_ITEMS}
            >
              {sessionStrings.common.add}
            </button>
          </div>
          {list.length >= MAX_TOOLBAR_ITEMS && (
            <p className="omg-muted">{t.full(MAX_TOOLBAR_ITEMS)}</p>
          )}
        </form>
      )}
      <div className="omg-sheet__actions">
        <ChromeButton className="omg-btn--ghost" onClick={() => p.onItems(null)}>
          {t.reset}
        </ChromeButton>
        <ChromeButton className="omg-btn--primary" onClick={p.onClose}>
          {sessionStrings.common.done}
        </ChromeButton>
      </div>
    </Sheet>
  );
}
