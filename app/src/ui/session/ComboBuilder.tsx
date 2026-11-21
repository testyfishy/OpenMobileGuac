import { useId, useReducer, useState } from 'react';
import {
  KEY_GROUPS,
  KEY_GROUP_KEYS,
  STEP_DELAY_CHOICES,
  draftFrom,
  draftToCombo,
  reduceComboDraft,
  stepsFromText,
  stepsToText,
  type ComboDraft,
  type ComboStep,
  type KeyGroup,
  type SavedCombo,
} from '../../session/keys/ComboLibrary.ts';
import { MODIFIERS } from '../../session/keys/KeyModel.ts';
import { ChromeButton } from './ChromeButton.tsx';
import { IconArrow, IconTrash } from './icons.tsx';
import { keyCapLabel } from './keyBarLayout.ts';
import { comboPreview } from './keySetNames.ts';
import { sessionStrings } from './sessionStrings.ts';
import { Sheet } from './Sheet.tsx';
import { SheetBackContext } from './sheetBack.ts';

export interface ComboBuilderProps {
  /** The combo to edit, or null for a new one. */
  readonly initial: SavedCombo | null;
  /** Id for the saved combo (the existing id when editing). */
  readonly id: string;
  readonly onSave: (combo: SavedCombo) => void;
  readonly onDelete?: () => void;
  /** Run the draft now (in a session). */
  readonly onTry?: (steps: readonly ComboStep[]) => void;
  readonly onClose: () => void;
  /** Unsaved work to start from (kept by the host after a Back). */
  readonly initialDraft?: ComboDraft | undefined;
  /** Back (one level, to the combo list), handing over the unsaved draft to keep. */
  readonly onBack?: (draft: ComboDraft) => void;
}

/**
 * KEY-9 combo editor: the typed form (`Ctrl+Alt+Del`, `Ctrl+K, Ctrl+C`) and a tap-to-build
 * editor over the same steps. Toggle modifiers, tap a key to append a step; reorder or
 * delete steps, set a pause after a step, name the combo.
 */
export function ComboBuilder({
  initial,
  id,
  onSave,
  onDelete,
  onTry,
  onClose,
  initialDraft,
  onBack,
}: ComboBuilderProps) {
  const c = sessionStrings.combos;
  const [draft, dispatch] = useReducer(
    reduceComboDraft,
    initial,
    (i: SavedCombo | null) => initialDraft ?? draftFrom(i),
  );
  const [group, setGroup] = useState<KeyGroup>('letters');
  const [text, setText] = useState(() => stepsToText(draft.steps));
  const [textError, setTextError] = useState<string | null>(null);
  const [textFocused, setTextFocused] = useState(false);
  const nameId = useId();
  const textId = useId();
  const combo = draftToCombo(draft, id);
  // The typed form follows the tap editor, except while the user is typing in it.
  const synced = stepsToText(draft.steps);
  const shownText = textFocused ? text : synced;

  const onText = (v: string) => {
    setText(v);
    if (v.trim() === '') {
      setTextError(null);
      dispatch({ type: 'text', steps: [] });
      return;
    }
    const r = stepsFromText(v, draft.steps);
    if (r.ok) {
      setTextError(null);
      dispatch({ type: 'text', steps: r.steps });
    } else {
      setTextError(r.error);
    }
  };

  const sheet = (
    <Sheet
      title={initial ? c.builderEditTitle : c.builderTitle}
      onClose={onClose}
      className="omg-sheet--tall"
    >
      <div className="omg-combo-form">
        <label htmlFor={nameId} className="omg-label">
          {c.name}
        </label>
        <input
          id={nameId}
          className="omg-input"
          value={draft.name}
          placeholder={c.namePlaceholder}
          autoComplete="off"
          onChange={(e) => dispatch({ type: 'name', name: e.target.value })}
        />
      </div>
      <div className="omg-combo-form">
        <label htmlFor={textId} className="omg-label">
          {c.typed}
        </label>
        <input
          id={textId}
          className="omg-input"
          value={shownText}
          placeholder={c.placeholder}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-invalid={textError !== null}
          onFocus={() => {
            setText(synced);
            setTextFocused(true);
          }}
          onBlur={() => {
            setTextFocused(false);
            setTextError(null);
          }}
          onChange={(e) => onText(e.target.value)}
        />
        <p className={textError ? 'omg-error' : 'omg-muted'}>{textError ?? c.typedHint}</p>
      </div>

      <h3 className="omg-label">{c.steps}</h3>
      {draft.steps.length === 0 ? (
        <p className="omg-muted">{c.noSteps}</p>
      ) : (
        <ol className="omg-combo-list omg-combo-steps">
          {draft.steps.map((s, i) => (
            <li key={`${i}:${s.keys.join('+')}`} className="omg-combo-list__item">
              <span className="omg-combo-step__keys">
                <span className="omg-muted">{c.step(i + 1)}</span>
                {s.keys.map((k) => (
                  <ChromeButton
                    key={k}
                    className="omg-key omg-key--small"
                    aria-label={c.removeKey(keyCapLabel(k), i + 1)}
                    title={c.removeKey(keyCapLabel(k), i + 1)}
                    onClick={() => dispatch({ type: 'remove-key', index: i, key: k })}
                  >
                    {keyCapLabel(k)}
                  </ChromeButton>
                ))}
              </span>
              {i < draft.steps.length - 1 && (
                <select
                  className="omg-input omg-input--small"
                  aria-label={c.pauseAfter(i + 1)}
                  value={String(s.delayMs ?? 0)}
                  onChange={(e) =>
                    dispatch({ type: 'delay', index: i, ms: Number(e.target.value) })
                  }
                >
                  {STEP_DELAY_CHOICES.map((ms) => (
                    <option key={ms} value={String(ms)}>
                      {ms === 0 ? c.noPause : c.pauseMs(ms)}
                    </option>
                  ))}
                </select>
              )}
              <ChromeButton
                className="omg-btn--icon"
                aria-label={c.moveStepUp(i + 1)}
                disabled={i === 0}
                onClick={() => dispatch({ type: 'move-step', index: i, delta: -1 })}
              >
                <IconArrow dir="up" />
              </ChromeButton>
              <ChromeButton
                className="omg-btn--icon"
                aria-label={c.moveStepDown(i + 1)}
                disabled={i === draft.steps.length - 1}
                onClick={() => dispatch({ type: 'move-step', index: i, delta: 1 })}
              >
                <IconArrow dir="down" />
              </ChromeButton>
              <ChromeButton
                className="omg-btn--icon omg-btn--danger"
                aria-label={c.removeStep(i + 1)}
                onClick={() => dispatch({ type: 'remove-step', index: i })}
              >
                <IconTrash />
              </ChromeButton>
            </li>
          ))}
        </ol>
      )}
      <p className="omg-muted" aria-live="polite" data-combo-preview="">
        {draft.steps.length > 0 ? c.preview(comboPreview(draft.steps)) : c.syntax}
      </p>

      <h3 className="omg-label">{c.hold}</h3>
      <div className="omg-combo-mods" role="group" aria-label={c.hold}>
        {MODIFIERS.map((m) => (
          <ChromeButton
            key={m}
            className={
              draft.mods.includes(m)
                ? 'omg-key omg-key--mod omg-key--locked'
                : 'omg-key omg-key--mod'
            }
            aria-pressed={draft.mods.includes(m)}
            onClick={() => dispatch({ type: 'toggle-mod', mod: m })}
          >
            {keyCapLabel(m)}
          </ChromeButton>
        ))}
        <ChromeButton
          className="omg-btn--ghost omg-btn--small"
          disabled={draft.mods.length === 0}
          onClick={() => dispatch({ type: 'mods-step' })}
        >
          {c.modsStep}
        </ChromeButton>
      </div>
      <label className="omg-label omg-label--row">
        <input
          type="checkbox"
          checked={draft.keepMods}
          onChange={(e) => dispatch({ type: 'keep-mods', on: e.target.checked })}
        />
        {c.keepMods}
      </label>

      <div className="omg-segmented omg-combo-groups" role="tablist">
        {KEY_GROUPS.map((g) => (
          <ChromeButton
            key={g}
            role="tab"
            aria-selected={group === g}
            className={group === g ? 'omg-seg omg-seg--on' : 'omg-seg'}
            onClick={() => setGroup(g)}
          >
            {c.groups[g]}
          </ChromeButton>
        ))}
      </div>
      <div className="omg-combo-keys" role="group" aria-label={c.groups[group]}>
        {KEY_GROUP_KEYS[group].map((k) => (
          <ChromeButton
            key={k}
            className="omg-key"
            aria-label={sessionStrings.keyBar.spoken[k] ?? k}
            onClick={() => dispatch({ type: 'key', key: k })}
          >
            {keyCapLabel(k)}
          </ChromeButton>
        ))}
      </div>

      <div className="omg-sheet__actions">
        {onTry && (
          <ChromeButton
            className="omg-btn--ghost"
            disabled={draft.steps.length === 0}
            onClick={() => onTry(draft.steps)}
          >
            {c.tryIt}
          </ChromeButton>
        )}
        <ChromeButton
          className="omg-btn--ghost"
          disabled={draft.steps.length === 0}
          onClick={() => dispatch({ type: 'clear' })}
        >
          {c.clearSteps}
        </ChromeButton>
        {onDelete && (
          <ChromeButton className="omg-btn--ghost omg-btn--danger" onClick={onDelete}>
            {c.deleteCombo}
          </ChromeButton>
        )}
        <ChromeButton
          className="omg-btn--primary"
          disabled={combo === null}
          onClick={() => {
            if (combo) onSave(combo);
          }}
        >
          {c.save}
        </ChromeButton>
      </div>
    </Sheet>
  );
  return onBack ? (
    <SheetBackContext.Provider value={() => onBack(draft)}>{sheet}</SheetBackContext.Provider>
  ) : (
    sheet
  );
}
