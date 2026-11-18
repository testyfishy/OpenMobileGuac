/**
 * X11 keysyms as sent by `Guacamole.Keyboard` (`key,<keysym>,<pressed>`), and helpers to
 * turn them into text and labels. Printable characters follow `keysym_from_charcode` in the
 * vendored `Keyboard.js`: U+0020..U+00FF are sent as the code point itself and anything
 * from U+0100 up as `0x01000000 | codepoint`.
 */

export const Keysym = {
  BackSpace: 0xff08,
  Tab: 0xff09,
  Return: 0xff0d,
  Escape: 0xff1b,
  Delete: 0xffff,
  Home: 0xff50,
  Left: 0xff51,
  Up: 0xff52,
  Right: 0xff53,
  Down: 0xff54,
  PageUp: 0xff55,
  PageDown: 0xff56,
  End: 0xff57,
  Insert: 0xff63,
  KP_Enter: 0xff8d,
  Shift_L: 0xffe1,
  Shift_R: 0xffe2,
  Control_L: 0xffe3,
  Control_R: 0xffe4,
  Caps_Lock: 0xffe5,
  Meta_L: 0xffe7,
  Meta_R: 0xffe8,
  Alt_L: 0xffe9,
  Alt_R: 0xffea,
  Super_L: 0xffeb,
  Super_R: 0xffec,
  AltGr: 0xfe03,
} as const;

export type Modifier = 'Ctrl' | 'Alt' | 'AltGr' | 'Shift' | 'Meta' | 'Super';

const MODIFIERS: ReadonlyMap<number, Modifier> = new Map<number, Modifier>([
  [Keysym.Control_L, 'Ctrl'],
  [Keysym.Control_R, 'Ctrl'],
  [Keysym.Alt_L, 'Alt'],
  [Keysym.Alt_R, 'Alt'],
  [Keysym.AltGr, 'AltGr'],
  [Keysym.Shift_L, 'Shift'],
  [Keysym.Shift_R, 'Shift'],
  [Keysym.Meta_L, 'Meta'],
  [Keysym.Meta_R, 'Meta'],
  [Keysym.Super_L, 'Super'],
  [Keysym.Super_R, 'Super'],
]);

/** Display order for modifier labels. */
export const MODIFIER_ORDER: readonly Modifier[] = [
  'Ctrl',
  'Alt',
  'AltGr',
  'Shift',
  'Meta',
  'Super',
];

export function modifierOf(keysym: number): Modifier | undefined {
  return MODIFIERS.get(keysym);
}

/** The modifiers held, in display order, given the set of pressed keysyms. */
export function heldModifiers(pressed: Iterable<number>): Modifier[] {
  const held = new Set<Modifier>();
  for (const k of pressed) {
    const m = MODIFIERS.get(k);
    if (m) held.add(m);
  }
  return MODIFIER_ORDER.filter((m) => held.has(m));
}

/** The character a keysym types, or `null` for non-printing keys. */
export function keysymToText(keysym: number): string | null {
  if ((keysym >= 0x20 && keysym <= 0x7e) || (keysym >= 0xa0 && keysym <= 0xff)) {
    return String.fromCodePoint(keysym);
  }
  if (keysym >= 0x01000020 && keysym <= 0x0110ffff) {
    const cp = keysym & 0x00ffffff;
    if ((cp >= 0x7f && cp <= 0x9f) || (cp >= 0xd800 && cp <= 0xdfff)) return null;
    return String.fromCodePoint(cp);
  }
  return null;
}

const NAMES: ReadonlyMap<number, string> = new Map<number, string>([
  [Keysym.BackSpace, 'Backspace'],
  [Keysym.Tab, 'Tab'],
  [Keysym.Return, 'Enter'],
  [Keysym.KP_Enter, 'Enter (keypad)'],
  [Keysym.Escape, 'Esc'],
  [Keysym.Delete, 'Delete'],
  [Keysym.Insert, 'Insert'],
  [Keysym.Home, 'Home'],
  [Keysym.End, 'End'],
  [Keysym.Left, 'Left'],
  [Keysym.Right, 'Right'],
  [Keysym.Up, 'Up'],
  [Keysym.Down, 'Down'],
  [Keysym.PageUp, 'Page Up'],
  [Keysym.PageDown, 'Page Down'],
  [Keysym.Caps_Lock, 'Caps Lock'],
  [0xff13, 'Pause'],
  [0xff14, 'Scroll Lock'],
  [0xff15, 'Sys Req'],
  [0xff61, 'Print'],
  [0xff67, 'Menu'],
  [0xff7f, 'Num Lock'],
  [0x20, 'Space'],
]);

/** A short human-readable name, e.g. `Delete`, `F5`, `a`, `é`, `0xff9f`. */
export function keysymName(keysym: number): string {
  const named = NAMES.get(keysym);
  if (named) return named;
  const mod = MODIFIERS.get(keysym);
  if (mod) return mod;
  if (keysym >= 0xffbe && keysym <= 0xffe0) return `F${keysym - 0xffbe + 1}`;
  const text = keysymToText(keysym);
  if (text !== null) return text;
  return '0x' + keysym.toString(16);
}

/** Lower-cased Latin letter for Ctrl shortcuts (`a` for both 0x61 and 0x41). */
export function shortcutLetter(keysym: number): string | null {
  if (keysym >= 0x41 && keysym <= 0x5a) return String.fromCharCode(keysym + 0x20);
  if (keysym >= 0x61 && keysym <= 0x7a) return String.fromCharCode(keysym);
  return null;
}
