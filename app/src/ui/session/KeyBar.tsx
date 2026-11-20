import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { SavedCombo } from '../../session/keys/ComboLibrary.ts';
import type { Modifier, ModifierState } from '../../session/keys/KeyModel.ts';
import { ChromeButton } from './ChromeButton.tsx';
import { IconArrow, IconChevronDown, IconKeySets, IconKeyboardHide } from './icons.tsx';
import {
  parseToken,
  tokenLabel,
  tokenSpokenLabel,
  visibleRows,
  type KeyBarLayout,
} from './keyBarLayout.ts';
import { sessionStrings } from './sessionStrings.ts';

export interface KeyBarProps {
  readonly modifiers: Readonly<Record<Modifier, ModifierState>>;
  readonly layout: KeyBarLayout;
  readonly onKey: (name: string) => void;
  readonly onModifier: (mod: Modifier) => void;
  readonly onCombo: (text: string) => void;
  /** A `text:` key: type the text. */
  readonly onText?: (text: string) => void;
  /** A `saved:` key: run the saved combo. */
  readonly onSaved?: (id: string) => void;
  /** Saved combos, for the labels of `saved:` keys. */
  readonly combos?: readonly SavedCombo[];
  /** KEY-9 set switcher: the active set's name; tap = next set, long press = the list. */
  readonly setName?: string;
  readonly onNextSet?: () => void;
  readonly onPickSet?: () => void;
  /** A sideways swipe at a row's scroll end: -1 previous set, +1 next set. */
  readonly onSwipeSet?: (delta: -1 | 1) => void;
  /** Omit to hide the collapse chevron (split layout keeps the bar). */
  readonly onCollapse?: () => void;
  /** The soft keyboard is up: show the pinned "hide keyboard" button. */
  readonly keyboardActive?: boolean;
  readonly onHideKeyboard?: () => void;
  /** A downward swipe on the bar: hide the keyboard (or, with it hidden, the bar). */
  readonly onSwipeDown?: () => void;
}

const ARROWS: Readonly<Record<string, 'left' | 'up' | 'down' | 'right'>> = {
  Left: 'left',
  Up: 'up',
  Down: 'down',
  Right: 'right',
};

const WIDE = new Set(['Home', 'End', 'PageUp', 'PageDown', 'Space', 'Insert', 'PrintScreen']);

/** Downward travel (px) that counts as a dismiss swipe, and the most sideways drift. */
const SWIPE_PX = 36;
/** Sideways travel (px) that switches the set (only when the row did not scroll). */
const SET_SWIPE_PX = 56;
const LONG_PRESS_MS = 500;

/**
 * Extra key bar (KEY-3, KEY-5, KEY-7, KEY-9): docked above the soft keyboard, or at the
 * bottom when the keyboard is hidden. Rows come from the active key set. Sticky modifiers:
 * tap = next key only, tap again = locked, again = off. The rows scroll sideways; the set
 * switcher, "hide keyboard" and "hide extra keys" are pinned at the right edge. A downward
 * swipe hides the keyboard (opt-out); a sideways swipe at a row's end switches the set
 * (opt-in).
 */
export function KeyBar({
  modifiers,
  layout,
  onKey,
  onModifier,
  onCombo,
  onText,
  onSaved,
  combos = [],
  setName,
  onNextSet,
  onPickSet,
  onSwipeSet,
  onCollapse,
  keyboardActive,
  onHideKeyboard,
  onSwipeDown,
}: KeyBarProps) {
  const [fnOn, setFnOn] = useState(false);
  const rows = visibleRows(layout, fnOn);
  const lastIndex = rows.length - 1;
  const s = sessionStrings.keyBar;
  const swipe = useRef<{
    id: number;
    x: number;
    y: number;
    done: boolean;
    row: HTMLElement | null;
    scroll: number;
  } | null>(null);
  const suppressClick = useRef(false);
  const longPress = useRef<{ timer: ReturnType<typeof setTimeout> | null; fired: boolean }>({
    timer: null,
    fired: false,
  });

  // The finger (or mouse) may leave the bar while swiping: follow it on the window.
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((!onSwipeDown && !onSwipeSet) || !e.isPrimary) return;
    const row = (e.target as HTMLElement).closest<HTMLElement>('.omg-keybar__row');
    swipe.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      done: false,
      row,
      scroll: row?.scrollLeft ?? 0,
    };
    const check = (ev: PointerEvent, atEnd: boolean) => {
      const sw = swipe.current;
      if (!sw || sw.id !== ev.pointerId || sw.done) return;
      const dy = ev.clientY - sw.y;
      const dxs = ev.clientX - sw.x;
      const dx = Math.abs(dxs);
      if (onSwipeDown && dy > SWIPE_PX && dy > dx * 1.5) {
        sw.done = true;
        suppressClick.current = true;
        onSwipeDown();
        return;
      }
      // Sideways: only on release, and only if the row did not scroll (it was at its end).
      if (atEnd && onSwipeSet && dx > SET_SWIPE_PX && dx > Math.abs(dy) * 1.5) {
        const scrolled = Math.abs((sw.row?.scrollLeft ?? 0) - sw.scroll) > 2;
        if (!scrolled) {
          sw.done = true;
          suppressClick.current = true;
          onSwipeSet(dxs < 0 ? 1 : -1);
        }
      }
    };
    const move = (ev: PointerEvent) => check(ev, false);
    const end = (ev: PointerEvent) => {
      if (ev.type === 'pointerup') check(ev, true);
      swipe.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      // The click (if any) follows pointerup in the same task; drop the flag after it.
      if (suppressClick.current) setTimeout(() => (suppressClick.current = false), 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  const clearLongPress = () => {
    const lp = longPress.current;
    if (lp.timer) clearTimeout(lp.timer);
    lp.timer = null;
  };

  const switcher =
    onNextSet && setName !== undefined ? (
      <ChromeButton
        className="omg-key omg-key--set"
        aria-label={s.switchSet(setName)}
        title={setName}
        data-set-switch=""
        onPointerDown={() => {
          const lp = longPress.current;
          lp.fired = false;
          clearLongPress();
          if (onPickSet) {
            lp.timer = setTimeout(() => {
              lp.fired = true;
              lp.timer = null;
              onPickSet();
            }, LONG_PRESS_MS);
          }
        }}
        onPointerUp={clearLongPress}
        onPointerCancel={clearLongPress}
        onPointerLeave={clearLongPress}
        onContextMenu={(e) => {
          e.preventDefault();
          const lp = longPress.current;
          if (onPickSet && !lp.fired) {
            clearLongPress();
            lp.fired = true;
            onPickSet();
          }
          // A long press may end without a click: forget it shortly after.
          setTimeout(() => (lp.fired = false), 600);
        }}
        onClick={() => {
          if (longPress.current.fired) {
            longPress.current.fired = false;
            return;
          }
          onNextSet();
        }}
      >
        <IconKeySets />
        <span className="omg-key__set-name">{setName}</span>
      </ChromeButton>
    ) : null;

  return (
    <div
      className="omg-keybar"
      role="toolbar"
      aria-label={s.label}
      data-swipe={onSwipeDown ? 'on' : 'off'}
      onPointerDown={onPointerDown}
      onClickCapture={(e) => {
        if (suppressClick.current) {
          e.stopPropagation();
          e.preventDefault();
        }
      }}
    >
      <div className="omg-keybar__rows">
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
                    aria-label={s.modifier(tokenSpokenLabel(token), s.modifierStates[state])}
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
                    {tokenLabel(token)}
                  </ChromeButton>
                );
              }
              if (t.kind === 'text') {
                return (
                  <ChromeButton
                    key={key}
                    className="omg-key omg-key--text"
                    aria-label={tokenSpokenLabel(token)}
                    onClick={() => onText?.(t.text)}
                  >
                    {tokenLabel(token)}
                  </ChromeButton>
                );
              }
              if (t.kind === 'saved') {
                // A key whose saved combo was deleted is not shown.
                if (!combos.some((c) => c.id === t.id)) return null;
                return (
                  <ChromeButton
                    key={key}
                    className="omg-key omg-key--combo"
                    aria-label={tokenSpokenLabel(token, combos)}
                    onClick={() => onSaved?.(t.id)}
                  >
                    {tokenLabel(token, combos)}
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
          </div>
        ))}
      </div>
      {(switcher || onCollapse || (keyboardActive && onHideKeyboard)) && (
        <div className="omg-keybar__pinned">
          {switcher}
          {keyboardActive && onHideKeyboard && (
            <ChromeButton
              className="omg-key omg-key--hide-kb"
              aria-label={s.hideKeyboard}
              title={s.hideKeyboard}
              onClick={onHideKeyboard}
            >
              <IconKeyboardHide />
            </ChromeButton>
          )}
          {onCollapse && (
            <ChromeButton
              className="omg-key omg-key--collapse"
              aria-label={s.hide}
              title={s.hide}
              onClick={onCollapse}
            >
              <IconChevronDown />
            </ChromeButton>
          )}
        </div>
      )}
    </div>
  );
}
