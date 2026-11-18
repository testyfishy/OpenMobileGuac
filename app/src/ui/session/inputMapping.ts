/**
 * Pure mappings between DOM input events and the session models / Guacamole wire format.
 * Kept free of DOM types (plain shapes in, plain shapes out) so they can be unit-tested
 * without a browser.
 */

import type { MouseState } from '../../session/pointer/PointerModel.ts';
import type { PointerKind } from '../../session/gesture/GestureRecognizer.ts';
import { KEYSYM, keysymForCodePoint, keysymForName } from '../../session/keys/KeyModel.ts';

// ---------------------------------------------------------------------------------------
// Mouse

/** The template accepted by `new Guacamole.Mouse.State(template)` (Mouse.js). */
export interface GuacMouseStateTemplate {
  x: number;
  y: number;
  left: boolean;
  middle: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
}

/** Copy a model state into the library's template shape (integer remote pixels). */
export function toGuacMouseTemplate(s: MouseState): GuacMouseStateTemplate {
  return {
    x: Math.floor(s.x),
    y: Math.floor(s.y),
    left: s.left,
    middle: s.middle,
    right: s.right,
    up: s.up,
    down: s.down,
  };
}

/** Guacamole's `mouse` instruction button mask (Client.js `sendMouseState`). */
export function guacButtonMask(s: MouseState): number {
  return (
    (s.left ? 1 : 0) | (s.middle ? 2 : 0) | (s.right ? 4 : 0) | (s.up ? 8 : 0) | (s.down ? 16 : 0)
  );
}

/**
 * `PointerEvent.buttons` bit field (1 = primary, 2 = secondary, 4 = auxiliary/middle) to
 * named buttons. Note the order differs from Guacamole's mask (middle 2, right 4).
 */
export function pointerButtons(buttons: number): {
  left: boolean;
  middle: boolean;
  right: boolean;
} {
  const b = Number.isFinite(buttons) ? buttons : 0;
  return { left: (b & 1) !== 0, right: (b & 2) !== 0, middle: (b & 4) !== 0 };
}

export function pointerKind(pointerType: string): PointerKind {
  if (pointerType === 'mouse') return 'mouse';
  if (pointerType === 'pen') return 'pen';
  return 'touch';
}

/** WheelEvent.deltaMode → pixels. Line = 16 px, page = 0.9 × viewport height (approx.). */
export function wheelDeltaPx(delta: number, deltaMode: number, pageHeightPx: number): number {
  if (!Number.isFinite(delta)) return 0;
  if (deltaMode === 1) return delta * 16;
  if (deltaMode === 2) return delta * Math.max(1, pageHeightPx) * 0.9;
  return delta;
}

// ---------------------------------------------------------------------------------------
// Hardware keyboard

/** The KeyboardEvent fields the decision needs. */
export interface KeyEventLike {
  readonly key: string;
  readonly code: string;
  readonly keyCode: number;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly isComposing: boolean;
}

/**
 * What to do with a hardware `keydown`:
 * - `ignore`: not ours (IME/composition, soft-keyboard pseudo keys, unknown).
 * - `field`: let it reach the focused hidden text field, whose `input` event will send it
 *   through `TextInputDiff` (plain printable characters, Enter, Backspace). Sending it here
 *   as well would double-send.
 * - `send`: send `keysym` from keydown (and its release from keyup) and prevent the default.
 */
export type HardwareKeyDecision =
  | { readonly action: 'ignore' }
  | { readonly action: 'field' }
  | { readonly action: 'send'; readonly keysym: number };

/** Keysyms for `KeyboardEvent.key` values that are not single characters. */
const KEY_NAME_KEYSYM: Readonly<Record<string, number>> = {
  Escape: KEYSYM.Escape,
  Tab: KEYSYM.Tab,
  Enter: KEYSYM.Return,
  Backspace: KEYSYM.BackSpace,
  Delete: KEYSYM.Delete,
  Insert: KEYSYM.Insert,
  Home: KEYSYM.Home,
  End: KEYSYM.End,
  PageUp: KEYSYM.Prior,
  PageDown: KEYSYM.Next,
  ArrowLeft: KEYSYM.Left,
  ArrowUp: KEYSYM.Up,
  ArrowRight: KEYSYM.Right,
  ArrowDown: KEYSYM.Down,
  PrintScreen: KEYSYM.Print,
  Pause: KEYSYM.Pause,
  ScrollLock: KEYSYM.Scroll_Lock,
  CapsLock: KEYSYM.Caps_Lock,
  NumLock: KEYSYM.Num_Lock,
  ContextMenu: KEYSYM.Menu,
  AltGraph: KEYSYM.ISO_Level3_Shift,
};

/** Keysym for a modifier key, distinguishing left/right by `code`. */
function modifierKeysym(key: string, code: string): number | null {
  const right = code.endsWith('Right');
  switch (key) {
    case 'Control':
      return right ? KEYSYM.Control_R : KEYSYM.Control_L;
    case 'Shift':
      return right ? KEYSYM.Shift_R : KEYSYM.Shift_L;
    case 'Alt':
      return right ? KEYSYM.Alt_R : KEYSYM.Alt_L;
    case 'Meta':
    case 'OS':
      return right ? KEYSYM.Super_R : KEYSYM.Super_L;
    default:
      return null;
  }
}

/** Keysym for a `KeyboardEvent.key` value, or null. Letters are lowercased under chords. */
export function keysymForKey(key: string, code: string, lowercaseLetters: boolean): number | null {
  const mod = modifierKeysym(key, code);
  if (mod !== null) return mod;
  const named = KEY_NAME_KEYSYM[key];
  if (named !== undefined) return named;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) return keysymForName(key);
  const chars = [...key];
  if (chars.length !== 1) return null;
  let cp = key.codePointAt(0);
  if (cp === undefined) return null;
  if (lowercaseLetters && ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a))) cp |= 0x20;
  return keysymForCodePoint(cp);
}

/**
 * Decide how to route a hardware keydown.
 *
 * @param fieldFocused whether the hidden text field has focus. Without it every key we know
 *   is sent from keydown (nothing else would see it).
 */
export function decideHardwareKey(e: KeyEventLike, fieldFocused: boolean): HardwareKeyDecision {
  // IME composition and soft-keyboard pseudo events (Android reports keyCode 229 and
  // key "Unidentified"/"Process"); the field's input events carry the text.
  if (e.isComposing || e.keyCode === 229 || e.key === 'Unidentified' || e.key === 'Process') {
    return { action: 'ignore' };
  }
  if (e.key === 'Dead') return { action: 'ignore' };
  const chord = (e.ctrlKey || e.metaKey || e.altKey) && !isAltGrText(e);
  const single = [...e.key].length === 1;
  if (fieldFocused && !chord && (single || e.key === 'Enter' || e.key === 'Backspace')) {
    return { action: 'field' };
  }
  const keysym = keysymForKey(e.key, e.code, chord);
  if (keysym === null) return { action: 'ignore' };
  return { action: 'send', keysym };
}

/**
 * On Windows/Linux AltGr arrives as ctrlKey+altKey with a printable `key` (e.g. "@" on a
 * German layout), and macOS Option produces characters such as "å". Treat Alt + a
 * character that is not an ASCII letter or digit as text, not a chord.
 */
function isAltGrText(e: KeyEventLike): boolean {
  if (!e.altKey || e.metaKey || [...e.key].length !== 1) return false;
  return !/^[a-z0-9]$/i.test(e.key);
}

/**
 * Modifiers a chord needs that are not currently held on the remote. Some keyboards and
 * automation tools deliver `Ctrl+A` as a single keydown with `ctrlKey` set and no separate
 * Control keydown; the returned (left-hand) keysyms are pressed before the key and released
 * after it. Shift is only synthesised for keys sent from keydown (named keys / chords).
 */
export function missingModifierKeysyms(
  e: Pick<KeyEventLike, 'ctrlKey' | 'altKey' | 'metaKey'> & { readonly shiftKey: boolean },
  held: ReadonlySet<number>,
): number[] {
  const out: number[] = [];
  const need = (flag: boolean, left: number, right: number) => {
    if (flag && !held.has(left) && !held.has(right)) out.push(left);
  };
  need(e.ctrlKey, KEYSYM.Control_L, KEYSYM.Control_R);
  need(e.altKey, KEYSYM.Alt_L, KEYSYM.Alt_R);
  need(e.shiftKey, KEYSYM.Shift_L, KEYSYM.Shift_R);
  need(e.metaKey, KEYSYM.Super_L, KEYSYM.Super_R);
  return out;
}
