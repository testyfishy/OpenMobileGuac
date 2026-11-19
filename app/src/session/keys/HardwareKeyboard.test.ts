import { describe, expect, it } from 'vitest';
import {
  HardwareKeyboard,
  type HardwareKeyInput,
  type HardwareKeyContext,
} from './HardwareKeyboard.ts';
import { KEYSYM, KeyModel, type KeyEvent } from './KeyModel.ts';

const CTRL = KEYSYM.Control_L;
const ALT = KEYSYM.Alt_L;
const SHIFT = KEYSYM.Shift_L;

function ev(events: readonly KeyEvent[]): string[] {
  return events.map((e) => `${e.pressed ? '+' : '-'}${e.keysym.toString(16)}`);
}
const d = (ks: number) => `+${ks.toString(16)}`;
const u = (ks: number) => `-${ks.toString(16)}`;

interface Flags {
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
  altGraph?: boolean;
  repeat?: boolean;
}

function key(type: 'down' | 'up', k: string, code: string, f: Flags = {}): HardwareKeyInput {
  return {
    type,
    key: k,
    code,
    keyCode: 0,
    ctrlKey: f.ctrl ?? false,
    altKey: f.alt ?? false,
    shiftKey: f.shift ?? false,
    metaKey: f.meta ?? false,
    altGraph: f.altGraph ?? false,
    repeat: f.repeat ?? false,
    isComposing: false,
  };
}

const NO_FIELD: HardwareKeyContext = { fieldFocused: false };
const FIELD: HardwareKeyContext = { fieldFocused: true };

function run(
  steps: HardwareKeyInput[],
  ctx: HardwareKeyContext = NO_FIELD,
  hk = new HardwareKeyboard(),
) {
  const out: KeyEvent[] = [];
  const results = steps.map((s) => {
    const r = hk.handle(s, ctx);
    out.push(...r.events);
    return r;
  });
  return { out: ev(out), results, hk };
}

describe('HardwareKeyboard (KEY-6)', () => {
  it('Ctrl+C: the lazy Ctrl is pressed just before C and released after', () => {
    const { out } = run([
      key('down', 'Control', 'ControlLeft', { ctrl: true }),
      key('down', 'c', 'KeyC', { ctrl: true }),
      key('up', 'c', 'KeyC', { ctrl: true }),
      key('up', 'Control', 'ControlLeft'),
    ]);
    expect(out).toEqual([d(CTRL), d(0x63), u(0x63), u(CTRL)]);
  });

  it('Alt held across several Tabs (Alt+Tab switcher)', () => {
    const { out } = run([
      key('down', 'Alt', 'AltLeft', { alt: true }),
      key('down', 'Tab', 'Tab', { alt: true }),
      key('up', 'Tab', 'Tab', { alt: true }),
      key('down', 'Tab', 'Tab', { alt: true }),
      key('up', 'Tab', 'Tab', { alt: true }),
      key('up', 'Alt', 'AltLeft'),
    ]);
    expect(out).toEqual([d(ALT), d(0xff09), u(0xff09), d(0xff09), u(0xff09), u(ALT)]);
  });

  it('a lone Alt tap is sent as a tap on release', () => {
    const { out } = run([
      key('down', 'Alt', 'AltLeft', { alt: true }),
      key('up', 'Alt', 'AltLeft'),
    ]);
    expect(out).toEqual([d(ALT), u(ALT)]);
  });

  it('flush() presses lazy modifiers (Ctrl+click)', () => {
    const hk = new HardwareKeyboard();
    hk.handle(key('down', 'Control', 'ControlLeft', { ctrl: true }), NO_FIELD);
    expect(hk.hasPending()).toBe(true);
    expect(ev(hk.flush())).toEqual([d(CTRL)]);
    expect(ev(hk.handle(key('up', 'Control', 'ControlLeft'), NO_FIELD).events)).toEqual([u(CTRL)]);
  });

  it('Windows AltGr (phantom Ctrl + AltGraph) + "@": only the character, no Ctrl+Alt', () => {
    const { out, results } = run([
      key('down', 'Control', 'ControlLeft', { ctrl: true }),
      key('down', 'AltGraph', 'AltRight', { ctrl: true, alt: true, altGraph: true }),
      key('down', '@', 'KeyQ', { ctrl: true, alt: true, altGraph: true }),
      key('up', '@', 'KeyQ', { ctrl: true, alt: true, altGraph: true }),
      key('up', 'Control', 'ControlLeft', { alt: true, altGraph: true }),
      key('up', 'AltGraph', 'AltRight'),
    ]);
    expect(out).toEqual([d(0x40), u(0x40)]);
    expect(results.every((r) => r.handled)).toBe(true);
  });

  it('AltGr character with the hidden field focused goes to the field, nothing sent', () => {
    const { out, results } = run(
      [
        key('down', 'Control', 'ControlLeft', { ctrl: true }),
        key('down', 'AltGraph', 'AltRight', { ctrl: true, alt: true, altGraph: true }),
        key('down', '€', 'KeyE', { ctrl: true, alt: true, altGraph: true }),
      ],
      FIELD,
    );
    expect(out).toEqual([]);
    expect(results[2]?.toField).toBe(true);
  });

  it('macOS Option + character is text, not an Alt chord', () => {
    const { out } = run([
      key('down', 'Alt', 'AltLeft', { alt: true }),
      key('down', 'å', 'KeyA', { alt: true }),
      key('up', 'å', 'KeyA', { alt: true }),
      key('up', 'Alt', 'AltLeft'),
    ]);
    expect(out).toEqual([d(0xe5), u(0xe5)]);
  });

  it('Shift is sent at once; Ctrl+Shift+T presses in physical order', () => {
    const { out } = run([
      key('down', 'Control', 'ControlLeft', { ctrl: true }),
      key('down', 'Shift', 'ShiftLeft', { ctrl: true, shift: true }),
      key('down', 'T', 'KeyT', { ctrl: true, shift: true }),
    ]);
    // Uppercase keysym: guacd keeps Shift down for "T" (it would release it for "t").
    expect(out).toEqual([d(CTRL), d(SHIFT), d(0x54)]);
  });

  it('key repeat sends more presses without releases', () => {
    const { out } = run([
      key('down', 'ArrowLeft', 'ArrowLeft'),
      key('down', 'ArrowLeft', 'ArrowLeft', { repeat: true }),
      key('down', 'ArrowLeft', 'ArrowLeft', { repeat: true }),
      key('up', 'ArrowLeft', 'ArrowLeft'),
    ]);
    expect(out).toEqual([d(0xff51), d(0xff51), d(0xff51), u(0xff51)]);
  });

  it('resyncs: a modifier whose keyup was lost is released before the next key', () => {
    const { out } = run([
      key('down', 'Shift', 'ShiftLeft', { shift: true }),
      // Shift keyup lost (focus switched away); next key reports shift up.
      key('down', 'ArrowUp', 'ArrowUp'),
    ]);
    expect(out).toEqual([d(SHIFT), u(SHIFT), d(0xff52)]);
  });

  it('chord keydown without a separate modifier keydown synthesises it (automation)', () => {
    const { out } = run([
      key('down', 'a', 'KeyA', { ctrl: true }),
      key('up', 'a', 'KeyA', { ctrl: true }),
    ]);
    expect(out).toEqual([d(CTRL), d(0x61), u(0x61), u(CTRL)]);
  });

  it('plain characters go to the focused field; without it they are sent', () => {
    const f = run([key('down', 'x', 'KeyX')], FIELD);
    expect(f.out).toEqual([]);
    expect(f.results[0]?.toField).toBe(true);
    const n = run([key('down', 'x', 'KeyX'), key('up', 'x', 'KeyX')]);
    expect(n.out).toEqual([d(0x78), u(0x78)]);
  });

  it('applies sticky modifiers via ctx.adjust (sticky Shift + hardware "1" = "!")', () => {
    const km = new KeyModel();
    km.tapModifier('Shift');
    km.tapModifier('Shift'); // locked
    const { out } = run([key('down', '1', 'Digit1'), key('up', '1', 'Digit1')], {
      fieldFocused: false,
      adjust: (ks) => km.applyModifiers(ks),
    });
    expect(out).toEqual([d(0x21), u(0x21)]);
  });

  it('keys pressed with Meta held are released at once (no keyup arrives)', () => {
    const { out, hk } = run([
      key('down', 'Meta', 'MetaLeft', { meta: true }),
      key('down', 'l', 'KeyL', { meta: true }),
    ]);
    expect(out).toEqual([d(KEYSYM.Super_L), d(0x6c), u(0x6c)]);
    expect(hk.held()).toEqual(new Set([KEYSYM.Super_L]));
  });

  it('Android soft-keyboard pseudo keys (229 / Unidentified) are ignored', () => {
    const hk = new HardwareKeyboard();
    const r = hk.handle({ ...key('down', 'Unidentified', ''), keyCode: 229 }, FIELD);
    expect(r).toEqual({ events: [], handled: false, toField: false });
  });

  it('releaseAll releases held keys and sent modifiers, not pending ones', () => {
    const hk = new HardwareKeyboard();
    hk.handle(key('down', 'Shift', 'ShiftLeft', { shift: true }), NO_FIELD);
    hk.handle(key('down', 'Control', 'ControlLeft', { ctrl: true, shift: true }), NO_FIELD);
    hk.handle(key('down', 'ArrowDown', 'ArrowDown', { ctrl: true, shift: true }), NO_FIELD);
    expect(ev(hk.releaseAll())).toEqual([u(0xff54), u(SHIFT), u(CTRL)]);
    expect(hk.held().size).toBe(0);
  });
});
