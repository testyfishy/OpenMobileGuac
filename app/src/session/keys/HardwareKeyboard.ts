/**
 * HardwareKeyboard: hardware `keydown` / `keyup` (as plain data) in, remote key events out
 * (SPEC KEY-6). Pure TypeScript, no DOM.
 *
 * Why not the vendored `Guacamole.Keyboard`: it also listens to `input` and composition
 * events on the element it is attached to, so attaching it where the hidden text field
 * lives would send soft-keyboard text twice (the field's `TextInputDiff` path already sends
 * it). Its two hardware-specific behaviours are ported instead:
 * - **Modifier resync** (`syncModifierStates`): when an event's modifier flags say Ctrl /
 *   Alt / Shift / Meta are up but we still hold them on the remote (a keyup lost while the
 *   app was switching windows), they are released before the key.
 * - **AltGr** (`release_simulated_altgr`): Windows reports AltGr as Ctrl + AltRight, other
 *   platforms as `AltGraph`. Upstream presses Ctrl+Alt on the remote and releases them just
 *   before a printable character. Here Ctrl and Alt presses are **lazy** instead: a
 *   Control/Alt keydown is held back until the next key shows what it is for:
 *   - a chord key (letter, digit, named key) or a mouse button (`flush()`): the modifier is
 *     pressed first, so Ctrl+C, Alt+Tab (held across several Tabs) and Ctrl+click work;
 *   - `AltGraph`, or a printable character typed with AltGr / Option (`@` on a German
 *     layout, `å` on macOS): the modifier is never sent, and the character keysym is sent
 *     alone (guacd's keymaps add AltGr themselves when the remote layout needs it);
 *   - released on its own: a press+release tap is sent then (Alt alone opens a Windows
 *     menu bar, Ctrl alone is used by some tools).
 *   So the remote never sees a spurious Ctrl+Alt before an AltGr character.
 * - **Meta chords**: Chrome and Safari send no keyup for a key pressed while Meta is held,
 *   so such keys are pressed and released at once (upstream treats them the same way).
 * - **Key repeat**: a repeated keydown of a key sent from keydown is sent as another press
 *   (no release), as upstream does; guacd turns that into remote autorepeat. Text keys
 *   repeat through the hidden field.
 * - **Lock keys**: Caps Lock / Num Lock / Scroll Lock pass through as ordinary keys. Upstream
 *   1.6.0 does not synchronise lock *state* (its ModifierState has no lock fields), and
 *   guacd's keymaps already pick definitions by the remote lock state when typing text, so
 *   no extra synchronisation is attempted.
 *
 * Routing: with the hidden field focused, plain printable characters, Enter and Backspace
 * are left to the field (`toField`), whose input event sends them; sending them here as
 * well would double-send. Everything else known is sent from keydown.
 */

import { KEYSYM, keysymForCodePoint, keysymForName, type KeyEvent } from './KeyModel.ts';

/** The KeyboardEvent fields needed (plain data so this stays DOM-free). */
export interface KeyEventLike {
  readonly key: string;
  readonly code: string;
  readonly keyCode: number;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly isComposing: boolean;
}

export interface HardwareKeyInput extends KeyEventLike {
  readonly type: 'down' | 'up';
  readonly shiftKey: boolean;
  readonly repeat: boolean;
  /** `getModifierState('AltGraph')`. */
  readonly altGraph: boolean;
}

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

export function isModifierKey(key: string): boolean {
  return (
    key === 'Control' ||
    key === 'Shift' ||
    key === 'Alt' ||
    key === 'Meta' ||
    key === 'OS' ||
    key === 'AltGraph'
  );
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
 * On Windows/Linux AltGr arrives as ctrlKey+altKey with a printable `key` (e.g. "@" on a
 * German layout), and macOS Option produces characters such as "å". Treat Alt + a
 * character that is not an ASCII letter or digit as text, not a chord.
 */
export function isAltGrText(e: KeyEventLike & { readonly altGraph?: boolean }): boolean {
  if ([...e.key].length !== 1 || e.metaKey) return false;
  if (e.altGraph === true) return true;
  if (!e.altKey) return false;
  return !/^[a-z0-9]$/i.test(e.key);
}

/**
 * Decide how to route a hardware keydown.
 *
 * @param fieldFocused whether the hidden text field has focus. Without it every key we know
 *   is sent from keydown (nothing else would see it).
 */
export function decideHardwareKey(
  e: KeyEventLike & { readonly altGraph?: boolean; readonly shiftKey?: boolean },
  fieldFocused: boolean,
): HardwareKeyDecision {
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
  // Letters under a chord: lowercase, or uppercase while Shift is physically held, because
  // guacd sets Shift to match the letter's case (Ctrl+Shift+T must stay Ctrl+Shift+T).
  let keysym = keysymForKey(e.key, e.code, chord);
  if (keysym === null) return { action: 'ignore' };
  if (chord && e.shiftKey === true && keysym >= 0x61 && keysym <= 0x7a) keysym &= ~0x20;
  return { action: 'send', keysym };
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

// ---------------------------------------------------------------------------------------

export interface HardwareKeyResult {
  /** Key events to send now, in order. */
  readonly events: KeyEvent[];
  /** The event is ours: prevent its default action. */
  readonly handled: boolean;
  /** Leave the event to the hidden field (do not prevent default). */
  readonly toField: boolean;
}

export interface HardwareKeyContext {
  readonly fieldFocused: boolean;
  /** Keysyms already held on the remote by other sources (locked sticky modifiers). */
  readonly heldElsewhere?: ReadonlySet<number>;
  /** Adjusts a printable keysym for sticky modifiers (KeyModel.applyModifiers). */
  readonly adjust?: (keysym: number) => number;
}

type ModGroup = 'ctrl' | 'alt' | 'shift' | 'meta';

interface HeldModifier {
  readonly keysym: number;
  readonly group: ModGroup;
  /** pending: held locally, not sent; sent: pressed on the remote; consumed: used as AltGr. */
  state: 'pending' | 'sent' | 'consumed';
}

const GROUP_OF: Readonly<Record<string, ModGroup>> = {
  Control: 'ctrl',
  Alt: 'alt',
  Shift: 'shift',
  Meta: 'meta',
  OS: 'meta',
};

const IGNORE: HardwareKeyResult = { events: [], handled: false, toField: false };

function flagFor(e: HardwareKeyInput, g: ModGroup): boolean {
  switch (g) {
    case 'ctrl':
      return e.ctrlKey;
    case 'alt':
      return e.altKey;
    case 'shift':
      return e.shiftKey;
    case 'meta':
      return e.metaKey;
  }
}

export class HardwareKeyboard {
  /** Modifier keys held, by `code` (or key when code is empty). */
  private readonly mods = new Map<string, HeldModifier>();
  /** Non-modifier keys pressed on the remote, by id: the key and synthesised modifiers. */
  private readonly keys = new Map<string, { keysym: number; synth: number[] }>();
  /** AltGraph key held (never sent). */
  private altGraphHeld = new Set<string>();

  /** Keysyms this keyboard holds on the remote. */
  held(): Set<number> {
    const s = new Set<number>();
    for (const m of this.mods.values()) if (m.state === 'sent') s.add(m.keysym);
    for (const k of this.keys.values()) {
      s.add(k.keysym);
      for (const ks of k.synth) s.add(ks);
    }
    return s;
  }

  /** Whether a lazy Ctrl/Alt is waiting to be resolved. */
  hasPending(): boolean {
    for (const m of this.mods.values()) if (m.state === 'pending') return true;
    return false;
  }

  /** Press lazy modifiers now (call before a mouse button press: Ctrl+click). */
  flush(): KeyEvent[] {
    const out: KeyEvent[] = [];
    for (const m of this.mods.values()) {
      if (m.state === 'pending') {
        m.state = 'sent';
        out.push({ keysym: m.keysym, pressed: true });
      }
    }
    return out;
  }

  /** Release everything held on the remote and forget all state (blur, hide, disconnect). */
  releaseAll(): KeyEvent[] {
    const out: KeyEvent[] = [];
    for (const k of this.keys.values()) {
      out.push({ keysym: k.keysym, pressed: false });
      for (const ks of [...k.synth].reverse()) out.push({ keysym: ks, pressed: false });
    }
    for (const m of this.mods.values()) {
      if (m.state === 'sent') out.push({ keysym: m.keysym, pressed: false });
    }
    this.keys.clear();
    this.mods.clear();
    this.altGraphHeld.clear();
    return out;
  }

  handle(e: HardwareKeyInput, ctx: HardwareKeyContext): HardwareKeyResult {
    return e.type === 'down' ? this.down(e, ctx) : this.up(e);
  }

  // -------------------------------------------------------------------------------------

  private id(e: HardwareKeyInput): string {
    return e.code || e.key;
  }

  private down(e: HardwareKeyInput, ctx: HardwareKeyContext): HardwareKeyResult {
    const id = this.id(e);
    if (e.key === 'AltGraph') {
      // Windows sends a phantom ControlLeft just before AltRight: never send it.
      for (const m of this.mods.values()) {
        if (m.group === 'ctrl' && m.state === 'pending') m.state = 'consumed';
      }
      this.altGraphHeld.add(id);
      return { events: [], handled: true, toField: false };
    }
    const group = GROUP_OF[e.key];
    if (group !== undefined) return this.modifierDown(e, id, group);

    const out: KeyEvent[] = [];
    this.resync(e, out);
    const altGrText = this.altGraphHeld.size > 0 || isAltGrText(e);
    if (altGrText && [...e.key].length === 1) {
      // AltGr / Option character: the lazy Ctrl/Alt were part of AltGr; take back any that
      // were already sent so the remote gets the bare character.
      for (const m of this.mods.values()) {
        if (m.group !== 'ctrl' && m.group !== 'alt') continue;
        if (m.state === 'sent') out.push({ keysym: m.keysym, pressed: false });
        m.state = 'consumed';
      }
      if (ctx.fieldFocused) return { events: out, handled: false, toField: true };
      const ks = keysymForKey(e.key, e.code, false);
      if (ks === null) return { events: out, handled: out.length > 0, toField: false };
      return this.pressKey(id, ks, [], e.repeat, out);
    }

    const d = decideHardwareKey(e, ctx.fieldFocused);
    if (d.action === 'ignore')
      return out.length > 0 ? { events: out, handled: false, toField: false } : IGNORE;
    // A real key: lazy and consumed modifiers that are still held apply to it.
    for (const m of this.mods.values()) {
      if (m.state !== 'sent' && flagFor(e, m.group)) {
        m.state = 'sent';
        out.push({ keysym: m.keysym, pressed: true });
      }
    }
    if (d.action === 'field') return { events: out, handled: false, toField: true };
    const heldNow = new Set([...this.held(), ...(ctx.heldElsewhere ?? [])]);
    const synth = e.repeat || this.keys.has(id) ? [] : missingModifierKeysyms(e, heldNow);
    const keysym = ctx.adjust ? ctx.adjust(d.keysym) : d.keysym;
    if (e.metaKey) {
      // Chrome/Safari send no keyup for keys pressed while Meta is held (upstream marks
      // them keyup-unreliable): press and release at once.
      for (const ks of synth) out.push({ keysym: ks, pressed: true });
      out.push({ keysym, pressed: true }, { keysym, pressed: false });
      for (const ks of [...synth].reverse()) out.push({ keysym: ks, pressed: false });
      return { events: out, handled: true, toField: false };
    }
    return this.pressKey(id, keysym, synth, e.repeat, out);
  }

  private pressKey(
    id: string,
    keysym: number,
    synth: number[],
    repeat: boolean,
    out: KeyEvent[],
  ): HardwareKeyResult {
    const existing = this.keys.get(id);
    if (existing && (repeat || existing.keysym === keysym)) {
      // Autorepeat: another press, no release.
      out.push({ keysym: existing.keysym, pressed: true });
      return { events: out, handled: true, toField: false };
    }
    if (existing) {
      // Missed keyup: release the old key first.
      out.push({ keysym: existing.keysym, pressed: false });
      for (const ks of [...existing.synth].reverse()) out.push({ keysym: ks, pressed: false });
    }
    for (const ks of synth) out.push({ keysym: ks, pressed: true });
    out.push({ keysym, pressed: true });
    this.keys.set(id, { keysym, synth });
    return { events: out, handled: true, toField: false };
  }

  private modifierDown(e: HardwareKeyInput, id: string, group: ModGroup): HardwareKeyResult {
    const keysym = keysymForKey(e.key, e.code, false);
    if (keysym === null) return IGNORE;
    if (this.mods.has(id)) return { events: [], handled: true, toField: false }; // repeat
    const lazy = group === 'ctrl' || group === 'alt';
    const out: KeyEvent[] = [];
    if (!lazy) {
      // Another modifier resolves lazy ones as modifiers (Ctrl+Shift+…, Alt+Shift).
      out.push(...this.flush());
      out.push({ keysym, pressed: true });
    }
    this.mods.set(id, { keysym, group, state: lazy ? 'pending' : 'sent' });
    return { events: out, handled: true, toField: false };
  }

  private up(e: HardwareKeyInput): HardwareKeyResult {
    const id = this.id(e);
    if (this.altGraphHeld.delete(id)) return { events: [], handled: true, toField: false };
    const mod = this.mods.get(id);
    if (mod) {
      this.mods.delete(id);
      if (mod.state === 'sent') {
        return { events: [{ keysym: mod.keysym, pressed: false }], handled: true, toField: false };
      }
      if (mod.state === 'pending') {
        // Tapped on its own: send the tap now.
        return {
          events: [
            { keysym: mod.keysym, pressed: true },
            { keysym: mod.keysym, pressed: false },
          ],
          handled: true,
          toField: false,
        };
      }
      return { events: [], handled: true, toField: false };
    }
    const k = this.keys.get(id);
    if (!k) return IGNORE;
    this.keys.delete(id);
    const out: KeyEvent[] = [{ keysym: k.keysym, pressed: false }];
    for (const ks of [...k.synth].reverse()) out.push({ keysym: ks, pressed: false });
    return { events: out, handled: true, toField: false };
  }

  /** Release remote modifiers whose flag the event reports as up (lost keyups). */
  private resync(e: HardwareKeyInput, out: KeyEvent[]): void {
    for (const [id, m] of [...this.mods]) {
      if (flagFor(e, m.group)) continue;
      if (m.state === 'sent') out.push({ keysym: m.keysym, pressed: false });
      this.mods.delete(id);
    }
  }
}
