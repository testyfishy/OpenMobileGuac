/**
 * KeyModel: X11 keysyms, sticky modifiers, text typing and key combos (SPEC KEY-2, KEY-3,
 * KEY-4). Pure TypeScript; produces ordered `{ keysym, pressed }` lists that the session
 * sends with the library's key events.
 *
 * Keysym values come from the X11 keysymdef standard and were cross-checked against the
 * `keyidentifier_keysym` table and `keysym_from_charcode` in upstream `Keyboard.js`
 * (apache/guacamole-client, tag 1.6.0). Differences from upstream `Keyboard.type()`:
 * - Iterates by code point (upstream steps per UTF-16 unit, so astral characters also send
 *   a stray keysym for the low surrogate).
 * - `\n`, `\r` and `\r\n` send Enter (0xFF0D) rather than Linefeed (0xFF0A).
 * - C0/C1 control characters other than Tab, Backspace, Escape and Delete are dropped.
 *
 * Sticky modifiers (KEY-3): tap = one-shot (applies to the next key only), second tap =
 * locked, third tap = off. One-shot modifiers are wrapped around the next key (pressed
 * just before it, released just after). Locked modifiers are pressed on the remote when
 * locked and released when unlocked, so held-modifier interactions such as Alt held while
 * tapping Tab, or Ctrl/Shift + click, work. Call `releaseAll()` on disconnect/blur.
 *
 * Letter case with modifiers: guacd adjusts Shift to match the keysym it receives. Its RDP
 * keymaps define every printable keysym with a required Shift state (e.g. `en-us-qwerty`:
 * `map -shift 0x02.. ~ "1234…"`, `map +shift 0x02.. ~ "!@#$…"`), and
 * `guac_rdp_keyboard_send_defined_key` presses or releases Shift to match before sending
 * the scancode (guacamole-server 1.6.0, `src/protocols/rdp/keyboard.c`). So the keysym, not
 * the held Shift, decides the character: keysym `1` with Shift held still types "1".
 * Therefore:
 * - while Ctrl/Alt/Super apply without Shift, ASCII letters are sent lowercase (Ctrl + "C"
 *   stays Ctrl+C, not Ctrl+Shift+C);
 * - while Shift applies (sticky or locked), letters are sent uppercase and the US-layout
 *   shifted symbol is sent for digits and punctuation (sticky Shift + "1" sends "!" with
 *   Shift held), via `shiftedCodePoint`. Text the soft keyboard already shifted ("!") is
 *   sent as is.
 */

export interface KeyEvent {
  readonly keysym: number;
  readonly pressed: boolean;
}

export type Modifier = 'Ctrl' | 'Alt' | 'Shift' | 'Super' | 'AltGr';

/** Order in which modifiers are pressed (released in reverse). */
export const MODIFIERS: readonly Modifier[] = ['Ctrl', 'Alt', 'Shift', 'Super', 'AltGr'];

export type ModifierState = 'off' | 'once' | 'locked';

// ---------------------------------------------------------------------------------------
// Keysym tables

export const KEYSYM = {
  BackSpace: 0xff08,
  Tab: 0xff09,
  Return: 0xff0d,
  Pause: 0xff13,
  Scroll_Lock: 0xff14,
  Sys_Req: 0xff15,
  Escape: 0xff1b,
  Home: 0xff50,
  Left: 0xff51,
  Up: 0xff52,
  Right: 0xff53,
  Down: 0xff54,
  Prior: 0xff55,
  Next: 0xff56,
  End: 0xff57,
  Print: 0xff61,
  Insert: 0xff63,
  Menu: 0xff67,
  Num_Lock: 0xff7f,
  F1: 0xffbe,
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
  ISO_Level3_Shift: 0xfe03,
  Delete: 0xffff,
} as const;

export const MODIFIER_KEYSYM: Readonly<Record<Modifier, number>> = {
  Ctrl: KEYSYM.Control_L,
  Alt: KEYSYM.Alt_L,
  Shift: KEYSYM.Shift_L,
  Super: KEYSYM.Super_L,
  AltGr: KEYSYM.ISO_Level3_Shift,
};

interface NamedKey {
  readonly name: string;
  readonly keysym: number;
  readonly aliases: readonly string[];
}

const NAMED: NamedKey[] = [
  { name: 'Ctrl', keysym: KEYSYM.Control_L, aliases: ['Control', 'Control_L', 'LCtrl', 'Ctl'] },
  { name: 'RCtrl', keysym: KEYSYM.Control_R, aliases: ['Control_R'] },
  { name: 'Alt', keysym: KEYSYM.Alt_L, aliases: ['Alt_L', 'LAlt', 'Option'] },
  { name: 'RAlt', keysym: KEYSYM.Alt_R, aliases: ['Alt_R'] },
  { name: 'Shift', keysym: KEYSYM.Shift_L, aliases: ['Shift_L', 'LShift'] },
  { name: 'RShift', keysym: KEYSYM.Shift_R, aliases: ['Shift_R'] },
  {
    name: 'Super',
    keysym: KEYSYM.Super_L,
    aliases: ['Super_L', 'Win', 'Windows', 'Cmd', 'Command'],
  },
  { name: 'RSuper', keysym: KEYSYM.Super_R, aliases: ['Super_R', 'RWin'] },
  { name: 'Meta', keysym: KEYSYM.Meta_L, aliases: ['Meta_L'] },
  { name: 'AltGr', keysym: KEYSYM.ISO_Level3_Shift, aliases: ['AltGraph', 'ISO_Level3_Shift'] },
  { name: 'Esc', keysym: KEYSYM.Escape, aliases: ['Escape'] },
  { name: 'Tab', keysym: KEYSYM.Tab, aliases: [] },
  { name: 'Enter', keysym: KEYSYM.Return, aliases: ['Return'] },
  { name: 'Backspace', keysym: KEYSYM.BackSpace, aliases: ['BackSpace', 'BS'] },
  { name: 'Delete', keysym: KEYSYM.Delete, aliases: ['Del'] },
  { name: 'Insert', keysym: KEYSYM.Insert, aliases: ['Ins'] },
  { name: 'Home', keysym: KEYSYM.Home, aliases: [] },
  { name: 'End', keysym: KEYSYM.End, aliases: [] },
  { name: 'PageUp', keysym: KEYSYM.Prior, aliases: ['PgUp', 'Prior'] },
  { name: 'PageDown', keysym: KEYSYM.Next, aliases: ['PgDn', 'Next'] },
  { name: 'Left', keysym: KEYSYM.Left, aliases: ['ArrowLeft'] },
  { name: 'Up', keysym: KEYSYM.Up, aliases: ['ArrowUp'] },
  { name: 'Right', keysym: KEYSYM.Right, aliases: ['ArrowRight'] },
  { name: 'Down', keysym: KEYSYM.Down, aliases: ['ArrowDown'] },
  {
    name: 'PrintScreen',
    keysym: KEYSYM.Print,
    aliases: ['PrtSc', 'PrtScn', 'PrintScr', 'Print', 'PrtScr'],
  },
  { name: 'SysRq', keysym: KEYSYM.Sys_Req, aliases: ['Sys_Req', 'SysReq'] },
  { name: 'Pause', keysym: KEYSYM.Pause, aliases: ['Break'] },
  { name: 'ScrollLock', keysym: KEYSYM.Scroll_Lock, aliases: ['Scroll_Lock', 'Scroll', 'ScrLk'] },
  { name: 'CapsLock', keysym: KEYSYM.Caps_Lock, aliases: ['Caps_Lock', 'Caps'] },
  { name: 'NumLock', keysym: KEYSYM.Num_Lock, aliases: ['Num_Lock'] },
  { name: 'Menu', keysym: KEYSYM.Menu, aliases: ['ContextMenu', 'Apps'] },
  { name: 'Space', keysym: 0x20, aliases: ['Spacebar'] },
  { name: 'Plus', keysym: 0x2b, aliases: [] },
  { name: 'Comma', keysym: 0x2c, aliases: [] },
];
for (let i = 1; i <= 24; i++) NAMED.push({ name: `F${i}`, keysym: KEYSYM.F1 + i - 1, aliases: [] });

const BY_LOWER = new Map<string, NamedKey>();
for (const k of NAMED) {
  BY_LOWER.set(k.name.toLowerCase(), k);
  for (const a of k.aliases) BY_LOWER.set(a.toLowerCase(), k);
}

/** Canonical names of all named keys (for UIs). */
export const KEY_NAMES: readonly string[] = NAMED.map((k) => k.name);

/** Keysym for a named key (case-insensitive, aliases allowed), or null. */
export function keysymForName(name: string): number | null {
  return BY_LOWER.get(name.trim().toLowerCase())?.keysym ?? null;
}

/** Canonical spelling of a named key, or null. */
export function canonicalKeyName(name: string): string | null {
  return BY_LOWER.get(name.trim().toLowerCase())?.name ?? null;
}

/**
 * X11 keysym for a Unicode code point, or null if it should not be sent.
 * Latin-1 printable characters map directly; other characters use the Unicode keysym
 * range `0x01000000 | codepoint`. A few control characters map to their function keys.
 */
export function keysymForCodePoint(cp: number): number | null {
  if (!Number.isInteger(cp) || cp < 0 || cp > 0x10ffff) return null;
  switch (cp) {
    case 0x08:
      return KEYSYM.BackSpace;
    case 0x09:
      return KEYSYM.Tab;
    case 0x0a:
    case 0x0d:
      return KEYSYM.Return;
    case 0x1b:
      return KEYSYM.Escape;
    case 0x7f:
      return KEYSYM.Delete;
    default:
      break;
  }
  if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) return null; // other control characters
  if (cp >= 0xd800 && cp <= 0xdfff) return null; // lone surrogates
  if (cp <= 0xff) return cp;
  return 0x01000000 | cp;
}

/** Split a string into code points, collapsing CRLF into a single "\n". */
function codePoints(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    if (cp === 0x0a && out[out.length - 1] === 0x0d) {
      out[out.length - 1] = 0x0a;
      continue;
    }
    out.push(cp);
  }
  return out;
}

function isAsciiLetter(cp: number): boolean {
  return (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a);
}

/** US-layout Shift pairs for digits and punctuation. */
const US_SHIFTED: Readonly<Record<string, string>> = {
  '`': '~',
  '1': '!',
  '2': '@',
  '3': '#',
  '4': '$',
  '5': '%',
  '6': '^',
  '7': '&',
  '8': '*',
  '9': '(',
  '0': ')',
  '-': '_',
  '=': '+',
  '[': '{',
  ']': '}',
  '\\': '|',
  ';': ':',
  "'": '"',
  ',': '<',
  '.': '>',
  '/': '?',
};

/**
 * The character Shift produces for `cp` (US layout): uppercase for ASCII letters, the
 * shifted symbol for digits and punctuation, `cp` itself otherwise.
 */
export function shiftedCodePoint(cp: number): number {
  if (isAsciiLetter(cp)) return cp & ~0x20;
  const shifted = US_SHIFTED[String.fromCharCode(cp)];
  return cp <= 0x7f && shifted !== undefined ? shifted.charCodeAt(0) : cp;
}

/** Adjust an ASCII character to the active modifiers (see file comment). */
function caseForModifiers(cp: number, mods: ReadonlySet<Modifier>): number {
  if (mods.has('Shift')) return shiftedCodePoint(cp);
  if (!isAsciiLetter(cp)) return cp;
  if (mods.has('Ctrl') || mods.has('Alt') || mods.has('Super')) return cp | 0x20; // lowercase
  return cp;
}

function tap(keysym: number): KeyEvent[] {
  return [
    { keysym, pressed: true },
    { keysym, pressed: false },
  ];
}

// ---------------------------------------------------------------------------------------
// Combos

/** One chord: keys pressed in order, released in reverse. Tokens are canonical names or single characters. */
export type Chord = readonly string[];

/** A combo is a sequence of chords, e.g. `Ctrl+K, Ctrl+C`. */
export interface Combo {
  readonly steps: readonly Chord[];
}

export type ComboParseResult =
  { readonly ok: true; readonly combo: Combo } | { readonly ok: false; readonly error: string };

/** Keysym for a combo token. Letters map to lowercase so guacd does not add Shift. */
export function keysymForComboToken(token: string): number | null {
  const named = keysymForName(token);
  if (named !== null) return named;
  const cps = [...token];
  if (cps.length !== 1) return null;
  const cp = token.codePointAt(0);
  if (cp === undefined) return null;
  const ks = keysymForCodePoint(isAsciiLetter(cp) ? cp | 0x20 : cp);
  return ks !== null && ks >= 0x20 && (ks <= 0xff || ks >= 0x01000000) ? ks : null;
}

function canonicalToken(token: string): string | null {
  const named = canonicalKeyName(token);
  if (named !== null) return named;
  if ([...token].length !== 1) return null;
  if (token === '+') return 'Plus';
  if (token === ',') return 'Comma';
  if (token === ' ') return 'Space';
  if (keysymForComboToken(token) === null) return null;
  return token.length === 1 && /[a-z]/.test(token) ? token.toUpperCase() : token;
}

/**
 * Parse `"Ctrl+Alt+Delete"`, `"Win"`, `"Ctrl+K, Ctrl+C"`. Names are case-insensitive and
 * aliases are accepted (Del, Esc, PrtSc, Win…). Whitespace is ignored. `+` and `,` as keys:
 * write `Plus` / `Comma`, or put them directly after a `+` (`"Ctrl++"`, `"Ctrl+,"`).
 */
export function parseCombo(text: string): ComboParseResult {
  const steps: string[][] = [];
  let keys: string[] = [];
  let cur = '';
  let danglingPlus = false;
  for (const c of text) {
    if (/\s/.test(c)) continue;
    if (c === '+') {
      if (cur === '') {
        cur = '+';
        danglingPlus = false;
      } else {
        keys.push(cur);
        cur = '';
        danglingPlus = true;
      }
      continue;
    }
    if (c === ',') {
      if (cur === '') {
        cur = ',';
        danglingPlus = false;
        continue;
      }
      keys.push(cur);
      steps.push(keys);
      keys = [];
      cur = '';
      danglingPlus = false;
      continue;
    }
    cur += c;
    danglingPlus = false;
  }
  if (danglingPlus) return { ok: false, error: 'Combo ends with "+"' };
  if (cur !== '') keys.push(cur);
  if (keys.length > 0) steps.push(keys);
  if (steps.length === 0) return { ok: false, error: 'Combo is empty' };

  const out: string[][] = [];
  for (const step of steps) {
    const chord: string[] = [];
    for (const token of step) {
      const canon = canonicalToken(token);
      if (canon === null) return { ok: false, error: `Unknown key "${token}"` };
      if (!chord.includes(canon)) chord.push(canon);
    }
    out.push(chord);
  }
  return { ok: true, combo: { steps: out } };
}

/** Canonical string form; `parseCombo(formatCombo(c))` round-trips. */
export function formatCombo(combo: Combo): string {
  return combo.steps.map((chord) => chord.map((k) => canonicalToken(k) ?? k).join('+')).join(', ');
}

/** Key events for a combo: each chord pressed in order and released in reverse. */
export function comboEvents(combo: Combo, held: ReadonlySet<number> = new Set()): KeyEvent[] {
  const out: KeyEvent[] = [];
  for (const chord of combo.steps) {
    const pressed: number[] = [];
    for (const token of chord) {
      const ks = keysymForComboToken(token);
      if (ks === null || held.has(ks) || pressed.includes(ks)) continue;
      out.push({ keysym: ks, pressed: true });
      pressed.push(ks);
    }
    for (let i = pressed.length - 1; i >= 0; i--) {
      const ks = pressed[i];
      if (ks !== undefined) out.push({ keysym: ks, pressed: false });
    }
  }
  return out;
}

function mustParse(text: string): Combo {
  const r = parseCombo(text);
  if (!r.ok) throw new Error(r.error);
  return r.combo;
}

export interface ComboPreset {
  readonly id: string;
  readonly label: string;
  readonly combo: Combo;
}

/** KEY-4 presets. */
export const COMBO_PRESETS: readonly ComboPreset[] = [
  { id: 'ctrl-alt-del', label: 'Ctrl+Alt+Del', combo: mustParse('Ctrl+Alt+Delete') },
  { id: 'alt-tab', label: 'Alt+Tab', combo: mustParse('Alt+Tab') },
  { id: 'alt-f4', label: 'Alt+F4', combo: mustParse('Alt+F4') },
  { id: 'win', label: 'Win', combo: mustParse('Super') },
  { id: 'win-d', label: 'Win+D', combo: mustParse('Super+D') },
  { id: 'ctrl-shift-esc', label: 'Ctrl+Shift+Esc', combo: mustParse('Ctrl+Shift+Esc') },
  { id: 'prtsc', label: 'PrtSc', combo: mustParse('PrintScreen') },
];

// ---------------------------------------------------------------------------------------
// KeyModel

export class KeyModel {
  private readonly mods = new Map<Modifier, ModifierState>(MODIFIERS.map((m) => [m, 'off']));

  getModifier(mod: Modifier): ModifierState {
    return this.mods.get(mod) ?? 'off';
  }

  modifiers(): Readonly<Record<Modifier, ModifierState>> {
    return {
      Ctrl: this.getModifier('Ctrl'),
      Alt: this.getModifier('Alt'),
      Shift: this.getModifier('Shift'),
      Super: this.getModifier('Super'),
      AltGr: this.getModifier('AltGr'),
    };
  }

  /** Key-bar tap on a modifier: off → once → locked → off. */
  tapModifier(mod: Modifier): KeyEvent[] {
    const keysym = MODIFIER_KEYSYM[mod];
    switch (this.getModifier(mod)) {
      case 'off':
        this.mods.set(mod, 'once');
        return [];
      case 'once':
        this.mods.set(mod, 'locked');
        return [{ keysym, pressed: true }];
      case 'locked':
        this.mods.set(mod, 'off');
        return [{ keysym, pressed: false }];
    }
  }

  /** Clear one-shot modifiers without sending anything (e.g. the user dismissed the bar). */
  clearOneShot(): void {
    for (const m of MODIFIERS) if (this.getModifier(m) === 'once') this.mods.set(m, 'off');
  }

  /** Release locked modifiers on the remote and clear all sticky state. */
  releaseAll(): KeyEvent[] {
    const out: KeyEvent[] = [];
    for (const m of [...MODIFIERS].reverse()) {
      if (this.getModifier(m) === 'locked')
        out.push({ keysym: MODIFIER_KEYSYM[m], pressed: false });
      this.mods.set(m, 'off');
    }
    return out;
  }

  /** Keysyms currently held on the remote by locked modifiers. */
  heldKeysyms(): Set<number> {
    const s = new Set<number>();
    for (const m of MODIFIERS) if (this.getModifier(m) === 'locked') s.add(MODIFIER_KEYSYM[m]);
    return s;
  }

  /**
   * Press and release a named key (or raw keysym) with active modifiers applied, then clear
   * one-shot modifiers. Pressing a modifier name here acts as a plain tap of that key.
   * Throws on an unknown name.
   */
  pressKey(key: string | number): KeyEvent[] {
    const keysym = typeof key === 'number' ? key : keysymForName(key);
    if (keysym === null) throw new RangeError(`Unknown key name: ${String(key)}`);
    return this.wrapOneShot([this.applyModifiers(keysym)]);
  }

  /**
   * A printable Latin-1 keysym adjusted for the sticky modifiers now active (Shift → shifted
   * symbol / uppercase, Ctrl/Alt/Super → lowercase letters). Other keysyms are unchanged.
   */
  applyModifiers(keysym: number): number {
    if (keysym < 0x20 || keysym > 0x7e) return keysym;
    return caseForModifiers(keysym, this.activeSet());
  }

  /**
   * Type text by code point. One-shot modifiers apply to the first character only (so
   * sticky Ctrl then "c" from the soft keyboard sends Ctrl+C); locked modifiers stay held.
   */
  typeText(text: string): KeyEvent[] {
    const out: KeyEvent[] = [];
    let first = true;
    for (const cp of codePoints(text)) {
      const active = first ? this.activeSet() : this.lockedSet();
      const ks = keysymForCodePoint(caseForModifiers(cp, active));
      if (ks === null) continue;
      if (first) {
        out.push(...this.wrapOneShot([ks]));
        first = false;
      } else {
        out.push(...tap(ks));
      }
    }
    return out;
  }

  /**
   * Run a combo. Combos are self-contained: they do not consume one-shot modifiers, and
   * keys already held by a locked modifier are neither pressed again nor released.
   */
  runCombo(combo: Combo): KeyEvent[] {
    return comboEvents(combo, this.heldKeysyms());
  }

  private activeSet(): Set<Modifier> {
    return new Set(MODIFIERS.filter((m) => this.getModifier(m) !== 'off'));
  }

  private lockedSet(): Set<Modifier> {
    return new Set(MODIFIERS.filter((m) => this.getModifier(m) === 'locked'));
  }

  /** Wrap keys with one-shot modifiers and clear them. */
  private wrapOneShot(keysyms: number[]): KeyEvent[] {
    const once = MODIFIERS.filter((m) => this.getModifier(m) === 'once').map(
      (m) => MODIFIER_KEYSYM[m],
    );
    const wrap = once.filter((ks) => !keysyms.includes(ks));
    const out: KeyEvent[] = [];
    for (const ks of wrap) out.push({ keysym: ks, pressed: true });
    for (const ks of keysyms) out.push(...tap(ks));
    for (let i = wrap.length - 1; i >= 0; i--) {
      const ks = wrap[i];
      if (ks !== undefined) out.push({ keysym: ks, pressed: false });
    }
    this.clearOneShot();
    return out;
  }
}
