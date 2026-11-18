import { useState, type ReactNode } from 'react';
import type { Modifier, ModifierState } from '../../session/keys/KeyModel.ts';
import { ChromeButton } from './ChromeButton.tsx';
import { IconArrow, IconChevronDown } from './icons.tsx';

export interface KeyBarProps {
  readonly modifiers: Readonly<Record<Modifier, ModifierState>>;
  readonly onKey: (name: string) => void;
  readonly onModifier: (mod: Modifier) => void;
  readonly onCollapse: () => void;
}

const STICKY: { mod: Modifier; label: string }[] = [
  { mod: 'Ctrl', label: 'Ctrl' },
  { mod: 'Alt', label: 'Alt' },
  { mod: 'Shift', label: 'Shift' },
  { mod: 'Super', label: 'Win' },
];

const MOD_STATE_TEXT: Record<ModifierState, string> = {
  off: 'off',
  once: 'on for the next key',
  locked: 'locked',
};

function Key({
  label,
  name,
  onKey,
  wide,
  children,
}: {
  label: string;
  name: string;
  onKey: (name: string) => void;
  wide?: boolean;
  children?: ReactNode;
}) {
  return (
    <ChromeButton
      className={wide ? 'omg-key omg-key--wide' : 'omg-key'}
      aria-label={label}
      onClick={() => onKey(name)}
    >
      {children ?? label}
    </ChromeButton>
  );
}

/**
 * Extra key bar (KEY-3, KEY-5): docked above the soft keyboard, or at the bottom when the
 * keyboard is hidden. Sticky modifiers: tap = next key only, tap again = locked, again = off.
 */
export function KeyBar({ modifiers, onKey, onModifier, onCollapse }: KeyBarProps) {
  const [showF, setShowF] = useState(false);
  return (
    <div className="omg-keybar" role="toolbar" aria-label="Extra keys">
      {showF && (
        <div className="omg-keybar__row omg-keybar__row--f">
          {Array.from({ length: 12 }, (_, i) => `F${i + 1}`).map((f) => (
            <Key key={f} label={f} name={f} onKey={onKey} />
          ))}
        </div>
      )}
      <div className="omg-keybar__row">
        <Key label="Esc" name="Esc" onKey={onKey} />
        <Key label="Tab" name="Tab" onKey={onKey} />
        {STICKY.map(({ mod, label }) => {
          const state = modifiers[mod];
          return (
            <ChromeButton
              key={mod}
              className={`omg-key omg-key--mod omg-key--${state}`}
              aria-label={`${label}, ${MOD_STATE_TEXT[state]}`}
              aria-pressed={state === 'off' ? false : state === 'locked' ? true : 'mixed'}
              onClick={() => onModifier(mod)}
            >
              {label}
              <span className="omg-key__lock" aria-hidden="true" />
            </ChromeButton>
          );
        })}
        <Key label="Left arrow" name="Left" onKey={onKey}>
          <IconArrow dir="left" />
        </Key>
        <Key label="Up arrow" name="Up" onKey={onKey}>
          <IconArrow dir="up" />
        </Key>
        <Key label="Down arrow" name="Down" onKey={onKey}>
          <IconArrow dir="down" />
        </Key>
        <Key label="Right arrow" name="Right" onKey={onKey}>
          <IconArrow dir="right" />
        </Key>
        <Key label="Home" name="Home" onKey={onKey} wide />
        <Key label="End" name="End" onKey={onKey} wide />
        <Key label="Page up" name="PageUp" onKey={onKey} wide>
          PgUp
        </Key>
        <Key label="Page down" name="PageDown" onKey={onKey} wide>
          PgDn
        </Key>
        <Key label="Delete" name="Delete" onKey={onKey}>
          Del
        </Key>
        <ChromeButton
          className={showF ? 'omg-key omg-key--toggle omg-key--locked' : 'omg-key omg-key--toggle'}
          aria-label="Function keys F1 to F12"
          aria-pressed={showF}
          onClick={() => setShowF((v) => !v)}
        >
          Fn
        </ChromeButton>
        <ChromeButton className="omg-key" aria-label="Hide extra keys" onClick={onCollapse}>
          <IconChevronDown />
        </ChromeButton>
      </div>
    </div>
  );
}
