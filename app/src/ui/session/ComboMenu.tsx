import { useState } from 'react';
import {
  stepsFromText,
  stepsToText,
  type ComboStep,
  type SavedCombo,
} from '../../session/keys/ComboLibrary.ts';
import { COMBO_PRESETS } from '../../session/keys/KeyModel.ts';
import type { KeyLibraryAction } from '../../session/keys/KeySets.ts';
import { ChromeButton } from './ChromeButton.tsx';
import { ComboBuilder } from './ComboBuilder.tsx';
import { comboPreview } from './keySetNames.ts';
import { IconArrow, IconTrash } from './icons.tsx';
import { sessionStrings } from './sessionStrings.ts';
import { Sheet } from './Sheet.tsx';

export interface ComboMenuProps {
  /** Saved combos (the app's key library). */
  readonly combos: readonly SavedCombo[];
  /** Legacy text combos stored on this connection by an older version. */
  readonly legacy?: readonly string[];
  /** Run a combo (omit outside a session: the sheet opens in edit mode). */
  readonly onRun?: (steps: readonly ComboStep[], label: string) => void;
  readonly onLibrary: (action: KeyLibraryAction) => void;
  /** A fresh id for a new combo. */
  readonly newId: () => string;
  readonly onTypeClipboard?: () => void;
  readonly onClose: () => void;
}

type Mode = { kind: 'run' } | { kind: 'edit' } | { kind: 'build'; combo: SavedCombo | null };

/**
 * KEY-4 / KEY-9: run presets, saved combos and legacy combos; manage the saved combos
 * (new, edit with the combo builder, reorder, delete); "type clipboard" (CLP-3).
 */
export function ComboMenu({
  combos,
  legacy = [],
  onRun,
  onLibrary,
  newId,
  onTypeClipboard,
  onClose,
}: ComboMenuProps) {
  const [mode, setMode] = useState<Mode>(onRun ? { kind: 'run' } : { kind: 'edit' });
  const t = sessionStrings.combos;
  const savedTexts = new Set(combos.map((c) => stepsToText(c.steps)));
  const legacyLeft = legacy
    .map((text) => {
      const r = stepsFromText(text);
      return r.ok ? { text: stepsToText(r.steps), steps: r.steps } : null;
    })
    .filter(
      (x): x is { text: string; steps: ComboStep[] } => x !== null && !savedTexts.has(x.text),
    );

  if (mode.kind === 'build') {
    const editing = mode.combo;
    return (
      <ComboBuilder
        initial={editing}
        id={editing?.id ?? newId()}
        onSave={(combo) => {
          onLibrary({ type: 'save-combo', combo });
          setMode({ kind: 'edit' });
        }}
        {...(editing
          ? {
              onDelete: () => {
                onLibrary({ type: 'delete-combo', id: editing.id });
                setMode({ kind: 'edit' });
              },
            }
          : {})}
        {...(onRun
          ? { onTry: (steps: readonly ComboStep[]) => onRun(steps, comboPreview(steps)) }
          : {})}
        onClose={() => setMode({ kind: 'edit' })}
      />
    );
  }

  const run = (steps: readonly ComboStep[], label: string) => {
    onRun?.(steps, label);
    onClose();
  };

  return (
    <Sheet title={mode.kind === 'edit' ? t.editTitle : t.title} onClose={onClose}>
      {mode.kind === 'run' && (
        <>
          <h3 className="omg-label">{t.presets}</h3>
          <div className="omg-combo-grid">
            {COMBO_PRESETS.map((p) => (
              <ChromeButton
                key={p.id}
                className="omg-combo"
                onClick={() =>
                  run(
                    p.combo.steps.map((keys) => ({ keys })),
                    p.label,
                  )
                }
              >
                {p.label}
              </ChromeButton>
            ))}
          </div>
          {combos.length > 0 && (
            <>
              <h3 className="omg-label">{t.mine}</h3>
              <div className="omg-combo-grid">
                {combos.map((c) => (
                  <ChromeButton
                    key={c.id}
                    className="omg-combo"
                    title={comboPreview(c.steps)}
                    onClick={() => run(c.steps, c.name)}
                  >
                    {c.name}
                  </ChromeButton>
                ))}
              </div>
            </>
          )}
          {legacyLeft.length > 0 && (
            <>
              <h3 className="omg-label">{t.legacyTitle}</h3>
              <div className="omg-combo-grid">
                {legacyLeft.map((l) => (
                  <ChromeButton
                    key={l.text}
                    className="omg-combo"
                    onClick={() => run(l.steps, l.text)}
                  >
                    {l.text}
                  </ChromeButton>
                ))}
              </div>
            </>
          )}
          <div className="omg-sheet__actions">
            {onTypeClipboard && (
              <ChromeButton
                className="omg-btn--ghost"
                onClick={() => {
                  onTypeClipboard();
                  onClose();
                }}
              >
                {t.typeClipboard}
              </ChromeButton>
            )}
            <ChromeButton className="omg-btn--ghost" onClick={() => setMode({ kind: 'edit' })}>
              {t.editMine}
            </ChromeButton>
          </div>
        </>
      )}
      {mode.kind === 'edit' && (
        <>
          {combos.length === 0 && <p className="omg-muted">{t.noneYet}</p>}
          <ol className="omg-combo-list">
            {combos.map((c, i) => (
              <li key={c.id} className="omg-combo-list__item" data-combo-id={c.id}>
                <ChromeButton
                  className="omg-btn--ghost omg-combo-list__label"
                  aria-label={t.editCombo(c.name)}
                  onClick={() => setMode({ kind: 'build', combo: c })}
                >
                  <span>{c.name}</span>
                  <span className="omg-muted"> {comboPreview(c.steps)}</span>
                </ChromeButton>
                <ChromeButton
                  className="omg-btn--icon"
                  aria-label={t.moveUp(c.name)}
                  disabled={i === 0}
                  onClick={() => onLibrary({ type: 'move-combo', id: c.id, delta: -1 })}
                >
                  <IconArrow dir="up" />
                </ChromeButton>
                <ChromeButton
                  className="omg-btn--icon"
                  aria-label={t.moveDown(c.name)}
                  disabled={i === combos.length - 1}
                  onClick={() => onLibrary({ type: 'move-combo', id: c.id, delta: 1 })}
                >
                  <IconArrow dir="down" />
                </ChromeButton>
                <ChromeButton
                  className="omg-btn--icon omg-btn--danger"
                  aria-label={t.remove(c.name)}
                  onClick={() => onLibrary({ type: 'delete-combo', id: c.id })}
                >
                  <IconTrash />
                </ChromeButton>
              </li>
            ))}
          </ol>
          {legacyLeft.length > 0 && (
            <>
              <h3 className="omg-label">{t.legacyTitle}</h3>
              <p className="omg-muted">{t.legacyHint}</p>
              <ul className="omg-combo-list">
                {legacyLeft.map((l) => (
                  <li key={l.text} className="omg-combo-list__item">
                    <span className="omg-combo-list__label">{l.text}</span>
                    <ChromeButton
                      className="omg-btn--ghost omg-btn--small"
                      aria-label={t.saveToMine(l.text)}
                      onClick={() =>
                        onLibrary({
                          type: 'save-combo',
                          combo: { id: newId(), name: l.text, steps: l.steps },
                        })
                      }
                    >
                      {t.save}
                    </ChromeButton>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="omg-sheet__actions">
            <ChromeButton
              className="omg-btn--primary"
              onClick={() => setMode({ kind: 'build', combo: null })}
            >
              {t.newButton}
            </ChromeButton>
            <ChromeButton
              className="omg-btn--ghost"
              onClick={() => (onRun ? setMode({ kind: 'run' }) : onClose())}
            >
              {sessionStrings.common.done}
            </ChromeButton>
          </div>
        </>
      )}
    </Sheet>
  );
}
