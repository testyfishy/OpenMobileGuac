import { Suspense, lazy, useId, useState } from 'react';
import type { KeyLibrary } from '../../session/keys/KeySets.ts';
import { Spinner } from '../components/Feedback.tsx';
import { Icon } from '../components/Icon.tsx';
import { Sheet } from '../components/Sheet.tsx';
import type { ResolvedSessionSettings, SessionSettings } from '../session/settings.ts';
import type { ListEditor } from '../session/settingsSchema.ts';
import { sessionStrings } from '../session/sessionStrings.ts';
import './sessionDefaults.css';
import {
  MAX_TOOLBAR_ITEMS,
  availableToolbarActions,
  editToolbarItems,
  resolveToolbarItems,
  type ToolbarAction,
} from '../session/toolbarItems.ts';
import { strings } from '../strings.ts';

// The key set manager and combo editor are the session's own components (lazy, with the
// session styles), so Settings and the session edit the key library the same way.
const KeysEditorHost = lazy(() => import('../session/KeysEditorHost.tsx'));

export interface KeyLibraryProps {
  readonly library: KeyLibrary;
  readonly onLibrary: (next: KeyLibrary) => void;
  readonly saveFile?: (fileName: string, text: string) => Promise<boolean>;
}

/**
 * Editors for the list-valued session defaults in Settings: toolbar buttons (app-shell
 * styled, sharing the pure reducer with the in-session editor), key sets and saved combos
 * (the in-session components).
 */
export function SessionListEditor({
  editor,
  values,
  onChange,
  keys,
  onClose,
}: {
  editor: ListEditor;
  values: ResolvedSessionSettings;
  onChange: (patch: Partial<SessionSettings>) => void;
  keys: KeyLibraryProps;
  onClose: () => void;
}) {
  switch (editor) {
    case 'toolbar':
      return (
        <ToolbarItemsSheet
          items={values.toolbarItems}
          onChange={(items) => onChange({ toolbarItems: items })}
          onClose={onClose}
        />
      );
    case 'keySets':
    case 'combos':
      return (
        <Suspense fallback={<Spinner label={strings.session.loading} />}>
          <KeysEditorHost
            editor={editor}
            library={keys.library}
            onLibrary={keys.onLibrary}
            defaultSet={values.keySet}
            onDefaultSet={(id) => onChange({ keySet: id })}
            {...(keys.saveFile ? { saveFile: keys.saveFile } : {})}
            onClose={onClose}
          />
        </Suspense>
      );
  }
}

function MoveButtons({
  name,
  index,
  count,
  onMove,
  onRemove,
  up,
  down,
  remove,
}: {
  name: string;
  index: number;
  count: number;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  up: (n: string) => string;
  down: (n: string) => string;
  remove: (n: string) => string;
}) {
  return (
    <span className="row-trailing">
      <button
        type="button"
        className="icon-btn"
        aria-label={up(name)}
        disabled={index === 0}
        onClick={() => onMove(-1)}
      >
        <Icon name="up" />
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label={down(name)}
        disabled={index === count - 1}
        onClick={() => onMove(1)}
      >
        <Icon name="down" />
      </button>
      <button type="button" className="icon-btn" aria-label={remove(name)} onClick={onRemove}>
        <Icon name="trash" />
      </button>
    </span>
  );
}

function ToolbarItemsSheet({
  items,
  onChange,
  onClose,
}: {
  items: readonly string[] | null;
  onChange: (items: string[] | null) => void;
  onClose: () => void;
}) {
  const t = sessionStrings.toolbarEditor;
  const names = sessionStrings.toolbar.names;
  const list = resolveToolbarItems(items);
  const available = availableToolbarActions(items);
  const [pick, setPick] = useState<ToolbarAction | ''>('');
  const choice = pick !== '' && available.includes(pick) ? pick : (available[0] ?? '');
  const selectId = useId();
  return (
    <Sheet title={t.title} onClose={onClose}>
      <p className="muted">{t.intro}</p>
      {list.length === 0 ? <p className="muted">{t.onlyMore}</p> : null}
      <ol className="list edit-list">
        {list.map((id, i) => (
          <li key={id} className="row edit-row">
            <span className="row-text">{names[id]}</span>
            <MoveButtons
              name={names[id]}
              index={i}
              count={list.length}
              onMove={(delta) =>
                onChange(editToolbarItems(items, { type: 'move', index: i, delta }))
              }
              onRemove={() => onChange(editToolbarItems(items, { type: 'remove', index: i }))}
              up={t.moveUp}
              down={t.moveDown}
              remove={t.remove}
            />
          </li>
        ))}
      </ol>
      {available.length > 0 ? (
        <div className="field">
          <label htmlFor={selectId} className="field-label">
            {t.add}
          </label>
          <div className="inline-form">
            <select
              id={selectId}
              className="field-input"
              value={choice}
              onChange={(e) => setPick(e.target.value as ToolbarAction)}
            >
              {available.map((id) => (
                <option key={id} value={id}>
                  {names[id]}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-primary"
              disabled={choice === '' || list.length >= MAX_TOOLBAR_ITEMS}
              onClick={() => {
                if (choice !== '') onChange(editToolbarItems(items, { type: 'add', id: choice }));
              }}
            >
              <Icon name="plus" /> {sessionStrings.common.add}
            </button>
          </div>
        </div>
      ) : null}
      <div className="form-actions">
        <button type="button" className="btn" onClick={() => onChange(null)}>
          {t.reset}
        </button>
        <button type="button" className="btn btn-primary" onClick={onClose}>
          {strings.common.done}
        </button>
      </div>
    </Sheet>
  );
}
