import { useState } from 'react';
import type { Modifier, ModifierState } from '../../session/keys/KeyModel.ts';
import { ChromeButton } from './ChromeButton.tsx';
import { IconArrow, IconChevronDown } from './icons.tsx';
import {
  parseToken,
  tokenLabel,
  tokenSpokenLabel,
  visibleRows,
  type KeyBarLayout,
} from './keyBarLayout.ts';

export interface KeyBarProps {
  readonly modifiers: Readonly<Record<Modifier, ModifierState>>;
  readonly layout: KeyBarLayout;
  readonly onKey: (name: string) => void;
  readonly onModifier: (mod: Modifier) => void;
  readonly onCombo: (text: string) => void;
  /** Omit to hide the collapse chevron (split layout keeps the bar). */
  readonly onCollapse?: () => void;
}

const MOD_STATE_TEXT: Record<ModifierState, string> = {
  off: 'off',
  once: 'on for the next key',
  locked: 'locked',
};

const ARROWS: Readonly<Record<string, 'left' | 'up' | 'down' | 'right'>> = {
  Left: 'left',
  Up: 'up',
  Down: 'down',
  Right: 'right',
};

const WIDE = new Set(['Home', 'End', 'PageUp', 'PageDown', 'Space', 'Insert', 'PrintScreen']);

/**
 * Extra key bar (KEY-3, KEY-5, KEY-7): docked above the soft keyboard, or at the bottom when
 * the keyboard is hidden. Rows come from the user's layout (see keyBarLayout.ts). Sticky
 * modifiers: tap = next key only, tap again = locked, again = off.
 */
export function KeyBar({ modifiers, layout, onKey, onModifier, onCombo, onCollapse }: KeyBarProps) {
  const [fnOn, setFnOn] = useState(false);
  const rows = visibleRows(layout, fnOn);
  const lastIndex = rows.length - 1;
  return (
    <div className="omg-keybar" role="toolbar" aria-label="Extra keys">
      {rows.map((row, ri) => (
        <div
          key={`${ri}:${row.join(',')}`}
          className={ri === lastIndex ? 'omg-keybar__row' : 'omg-keybar__row omg-keybar__row--f'}
        >
          {row.map((token, ki) => {
            const t = parseToken(token);
            if (!t) return null;
            const key = `${ki}:${token}`;
            if (t.kind === 'modifier') {
              const state = modifiers[t.mod];
              return (
                <ChromeButton
                  key={key}
                  className={`omg-key omg-key--mod omg-key--${state}`}
                  aria-label={`${tokenSpokenLabel(token)}, ${MOD_STATE_TEXT[state]}`}
                  aria-pressed={state === 'off' ? false : state === 'locked' ? true : 'mixed'}
                  onClick={() => onModifier(t.mod)}
                >
                  {tokenLabel(token)}
                  <span className="omg-key__lock" aria-hidden="true" />
                </ChromeButton>
              );
            }
            if (t.kind === 'fn') {
              return (
                <ChromeButton
                  key={key}
                  className={
                    fnOn ? 'omg-key omg-key--toggle omg-key--locked' : 'omg-key omg-key--toggle'
                  }
                  aria-label={tokenSpokenLabel(token)}
                  aria-pressed={fnOn}
                  onClick={() => setFnOn((v) => !v)}
                >
                  Fn
                </ChromeButton>
              );
            }
            if (t.kind === 'combo') {
              return (
                <ChromeButton
                  key={key}
                  className="omg-key omg-key--combo"
                  aria-label={tokenSpokenLabel(token)}
                  onClick={() => onCombo(t.text)}
                >
                  {t.text}
                </ChromeButton>
              );
            }
            const arrow = ARROWS[t.name];
            return (
              <ChromeButton
                key={key}
                className={WIDE.has(t.name) ? 'omg-key omg-key--wide' : 'omg-key'}
                aria-label={tokenSpokenLabel(token)}
                onClick={() => onKey(t.name)}
              >
                {arrow ? <IconArrow dir={arrow} /> : tokenLabel(token)}
              </ChromeButton>
            );
          })}
          {ri === lastIndex && onCollapse && (
            <ChromeButton className="omg-key" aria-label="Hide extra keys" onClick={onCollapse}>
              <IconChevronDown />
            </ChromeButton>
          )}
        </div>
      ))}
    </div>
  );
}
