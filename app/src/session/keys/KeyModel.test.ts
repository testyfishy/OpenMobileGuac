import { describe, expect, it } from 'vitest';
import {
  COMBO_PRESETS,
  KEYSYM,
  KEY_NAMES,
  KeyModel,
  canonicalKeyName,
  comboEvents,
  formatCombo,
  keysymForCodePoint,
  keysymForComboToken,
  keysymForName,
  parseCombo,
  type Combo,
  type KeyEvent,
} from './KeyModel.ts';

const CTRL = 0xffe3;
const ALT = 0xffe9;
const SHIFT = 0xffe1;
const SUPER = 0xffeb;
const DEL = 0xffff;

/** "+0xffe3" / "-0xffe3" rendering for readable expectations. */
function ev(events: KeyEvent[]): string[] {
  return events.map((e) => `${e.pressed ? '+' : '-'}${e.keysym.toString(16)}`);
}
function down(ks: number) {
  return `+${ks.toString(16)}`;
}
function up(ks: number) {
  return `-${ks.toString(16)}`;
}

describe('keysymForCodePoint (Unicode → keysym)', () => {
  const rows: [string, number, number | null][] = [
    ['space', 0x20, 0x20],
    ['a', 0x61, 0x61],
    ['Z', 0x5a, 0x5a],
    ['tilde', 0x7e, 0x7e],
    ['NBSP (Latin-1 direct)', 0xa0, 0xa0],
    ['é (Latin-1 direct)', 0xe9, 0xe9],
    ['ÿ (last Latin-1)', 0xff, 0xff],
    ['Ā (first non-Latin-1)', 0x100, 0x01000100],
    ['€', 0x20ac, 0x010020ac],
    ['あ', 0x3042, 0x01003042],
    ['漢', 0x6f22, 0x01006f22],
    ['😀 (astral)', 0x1f600, 0x0101f600],
    ['max code point', 0x10ffff, 0x0110ffff],
    ['newline → Enter', 0x0a, KEYSYM.Return],
    ['CR → Enter', 0x0d, KEYSYM.Return],
    ['tab', 0x09, KEYSYM.Tab],
    ['backspace', 0x08, KEYSYM.BackSpace],
    ['escape', 0x1b, KEYSYM.Escape],
    ['DEL', 0x7f, KEYSYM.Delete],
    ['NUL dropped', 0x00, null],
    ['other C0 dropped', 0x01, null],
    ['C1 dropped', 0x85, null],
    ['lone high surrogate', 0xd800, null],
    ['lone low surrogate', 0xdfff, null],
    ['beyond Unicode', 0x110000, null],
    ['negative', -1, null],
    ['fraction', 65.5, null],
  ];
  it.each(rows)('%s', (_n, cp, ks) => expect(keysymForCodePoint(cp)).toBe(ks));
});

describe('named keys', () => {
  // Cross-check against upstream Keyboard.js 1.6.0 `keyidentifier_keysym` (left keysym).
  const upstream: [string, number][] = [
    ['Escape', 0xff1b],
    ['Tab', 0xff09],
    ['Enter', 0xff0d],
    ['Backspace', 0xff08],
    ['Delete', 0xffff],
    ['Insert', 0xff63],
    ['Home', 0xff50],
    ['End', 0xff57],
    ['PageUp', 0xff55],
    ['PageDown', 0xff56],
    ['ArrowLeft', 0xff51],
    ['ArrowUp', 0xff52],
    ['ArrowRight', 0xff53],
    ['ArrowDown', 0xff54],
    ['PrintScreen', 0xff61],
    ['Pause', 0xff13],
    ['Scroll', 0xff14],
    ['CapsLock', 0xffe5],
    ['NumLock', 0xff7f],
    ['ContextMenu', 0xff67],
    ['Control', 0xffe3],
    ['Alt', 0xffe9],
    ['Shift', 0xffe1],
    ['Super', 0xffeb],
    ['Meta', 0xffe7],
    ['AltGraph', 0xfe03],
    ['F1', 0xffbe],
    ['F12', 0xffc9],
    ['F13', 0xffca],
    ['F24', 0xffd5],
  ];
  it.each(upstream)('%s matches upstream', (name, ks) => expect(keysymForName(name)).toBe(ks));

  it('F1–F24 are contiguous', () => {
    for (let i = 1; i <= 24; i++) expect(keysymForName(`F${i}`)).toBe(0xffbe + i - 1);
    expect(keysymForName('F25')).toBeNull();
    expect(keysymForName('F0')).toBeNull();
  });

  it('aliases are case-insensitive and canonicalise', () => {
    expect(keysymForName('del')).toBe(DEL);
    expect(keysymForName(' ESC ')).toBe(0xff1b);
    expect(keysymForName('PrtSc')).toBe(0xff61);
    expect(keysymForName('pgdn')).toBe(0xff56);
    // Win is Super_L (guacd's RDP keymap maps Super_L to the Windows key). Upstream's
    // "Win" key identifier maps to Meta_L instead; both reach LWin through guacd.
    expect(keysymForName('Win')).toBe(SUPER);
    expect(canonicalKeyName('windows')).toBe('Super');
    expect(canonicalKeyName('return')).toBe('Enter');
    expect(keysymForName('NotAKey')).toBeNull();
  });

  it('every canonical name resolves', () => {
    for (const n of KEY_NAMES) expect(keysymForName(n)).not.toBeNull();
  });
});

describe('KeyModel sticky modifiers (KEY-3)', () => {
  it('tap → once, tap → locked (pressed), tap → off (released)', () => {
    const k = new KeyModel();
    expect(k.tapModifier('Ctrl')).toEqual([]);
    expect(k.getModifier('Ctrl')).toBe('once');
    expect(ev(k.tapModifier('Ctrl'))).toEqual([down(CTRL)]);
    expect(k.getModifier('Ctrl')).toBe('locked');
    expect(ev(k.tapModifier('Ctrl'))).toEqual([up(CTRL)]);
    expect(k.getModifier('Ctrl')).toBe('off');
  });

  it('one-shot applies to the next key only', () => {
    const k = new KeyModel();
    k.tapModifier('Ctrl');
    expect(ev(k.pressKey('Tab'))).toEqual([down(CTRL), down(0xff09), up(0xff09), up(CTRL)]);
    expect(ev(k.pressKey('Tab'))).toEqual([down(0xff09), up(0xff09)]);
    expect(k.getModifier('Ctrl')).toBe('off');
  });

  it('acceptance: sticky Ctrl + "c" from the soft keyboard = Ctrl+C', () => {
    const k = new KeyModel();
    k.tapModifier('Ctrl');
    expect(ev(k.typeText('c'))).toEqual([down(CTRL), down(0x63), up(0x63), up(CTRL)]);
  });

  it('autocapitalised "C" with sticky Ctrl is still Ctrl+C (no implicit Shift)', () => {
    const k = new KeyModel();
    k.tapModifier('Ctrl');
    expect(ev(k.typeText('C'))).toEqual([down(CTRL), down(0x63), up(0x63), up(CTRL)]);
  });

  it('sticky Shift uppercases letters so guacd does not drop Shift', () => {
    const k = new KeyModel();
    k.tapModifier('Shift');
    expect(ev(k.typeText('ab'))).toEqual([
      down(SHIFT),
      down(0x41),
      up(0x41),
      up(SHIFT),
      down(0x62),
      up(0x62),
    ]);
  });

  it.each([
    ['1', 0x21],
    ['2', 0x40],
    ['9', 0x28],
    ['-', 0x5f],
    ['/', 0x3f],
    ['`', 0x7e],
    ["'", 0x22],
  ])('sticky Shift + "%s" sends the shifted keysym with Shift held', (ch, shifted) => {
    // guacd's keymaps type keysym "1" without Shift even when Shift is held, so the
    // shifted keysym must be sent (see the file comment).
    const k = new KeyModel();
    k.tapModifier('Shift');
    expect(ev(k.typeText(ch))).toEqual([down(SHIFT), down(shifted), up(shifted), up(SHIFT)]);
  });

  it('sticky Shift + key-bar / hardware keysym uses the shifted symbol too', () => {
    const k = new KeyModel();
    k.tapModifier('Shift');
    expect(ev(k.pressKey(0x31))).toEqual([down(SHIFT), down(0x21), up(0x21), up(SHIFT)]);
    k.tapModifier('Shift');
    expect(ev(k.pressKey('Comma'))).toEqual([down(SHIFT), down(0x3c), up(0x3c), up(SHIFT)]);
    // Non-printable keys keep their keysym: Shift+Left extends a selection.
    k.tapModifier('Shift');
    expect(ev(k.pressKey('Left'))).toEqual([down(SHIFT), down(0xff51), up(0xff51), up(SHIFT)]);
  });

  it('locked Shift shifts every character; already-shifted text is sent as is', () => {
    const k = new KeyModel();
    k.tapModifier('Shift');
    k.tapModifier('Shift'); // locked: Shift is held on the remote
    expect(ev(k.typeText('a1!'))).toEqual([
      down(0x41),
      up(0x41),
      down(0x21),
      up(0x21),
      down(0x21),
      up(0x21),
    ]);
  });

  it('Ctrl chords stay unshifted: sticky Ctrl + "1" = Ctrl+1', () => {
    const k = new KeyModel();
    k.tapModifier('Ctrl');
    expect(ev(k.typeText('1'))).toEqual([down(CTRL), down(0x31), up(0x31), up(CTRL)]);
    expect(k.applyModifiers(0x31)).toBe(0x31);
  });

  it('Ctrl+Shift one-shot + "t" = Ctrl+Shift+T in press order', () => {
    const k = new KeyModel();
    k.tapModifier('Shift');
    k.tapModifier('Ctrl');
    expect(ev(k.typeText('t'))).toEqual([
      down(CTRL),
      down(SHIFT),
      down(0x54),
      up(0x54),
      up(SHIFT),
      up(CTRL),
    ]);
  });

  it('one-shot modifiers apply only to the first character of typed text', () => {
    const k = new KeyModel();
    k.tapModifier('Alt');
    expect(ev(k.typeText('xy'))).toEqual([
      down(ALT),
      down(0x78),
      up(0x78),
      up(ALT),
      down(0x79),
      up(0x79),
    ]);
  });

  it('locked modifiers stay held across keys and are not re-wrapped', () => {
    const k = new KeyModel();
    k.tapModifier('Alt');
    expect(ev(k.tapModifier('Alt'))).toEqual([down(ALT)]);
    expect(ev(k.pressKey('Tab'))).toEqual([down(0xff09), up(0xff09)]);
    expect(ev(k.pressKey('Tab'))).toEqual([down(0xff09), up(0xff09)]);
    expect(ev(k.tapModifier('Alt'))).toEqual([up(ALT)]);
  });

  it('locked Ctrl lowercases letters for every typed character', () => {
    const k = new KeyModel();
    k.tapModifier('Ctrl');
    k.tapModifier('Ctrl');
    expect(ev(k.typeText('AB'))).toEqual([down(0x61), up(0x61), down(0x62), up(0x62)]);
  });

  it('locked + one-shot mix: one-shot wraps, locked stays', () => {
    const k = new KeyModel();
    k.tapModifier('Ctrl');
    k.tapModifier('Ctrl'); // locked
    k.tapModifier('Shift'); // once
    expect(ev(k.pressKey('Esc'))).toEqual([down(SHIFT), down(0xff1b), up(0xff1b), up(SHIFT)]);
    expect(k.getModifier('Ctrl')).toBe('locked');
    expect(k.getModifier('Shift')).toBe('off');
  });

  it('pressing a modifier key that is one-shot does not double-press it', () => {
    const k = new KeyModel();
    k.tapModifier('Shift');
    expect(ev(k.pressKey('Shift'))).toEqual([down(SHIFT), up(SHIFT)]);
  });

  it('releaseAll releases locked modifiers in reverse order and clears one-shots', () => {
    const k = new KeyModel();
    k.tapModifier('Ctrl');
    k.tapModifier('Ctrl');
    k.tapModifier('Super');
    k.tapModifier('Super');
    k.tapModifier('Alt'); // once
    expect(ev(k.releaseAll())).toEqual([up(SUPER), up(CTRL)]);
    expect(Object.values(k.modifiers()).every((s) => s === 'off')).toBe(true);
    expect(k.releaseAll()).toEqual([]);
  });

  it('clearOneShot drops pending modifiers silently', () => {
    const k = new KeyModel();
    k.tapModifier('Ctrl');
    k.clearOneShot();
    expect(ev(k.typeText('c'))).toEqual([down(0x63), up(0x63)]);
  });

  it('pressKey accepts raw keysyms and rejects unknown names', () => {
    const k = new KeyModel();
    expect(ev(k.pressKey(0xffc9))).toEqual([down(0xffc9), up(0xffc9)]);
    expect(() => k.pressKey('Nope')).toThrow(RangeError);
  });

  it('a one-shot modifier survives typing that produced no keys', () => {
    const k = new KeyModel();
    k.tapModifier('Ctrl');
    expect(k.typeText('\u0001')).toEqual([]);
    expect(k.getModifier('Ctrl')).toBe('once');
  });
});

describe('KeyModel.typeText (KEY-2)', () => {
  const k = () => new KeyModel();

  it('types mixed-case passwords and URLs as is', () => {
    const t = 'Pa55w0rd!';
    const out = k().typeText(t);
    expect(out.filter((e) => e.pressed).map((e) => e.keysym)).toEqual(
      [...t].map((c) => c.charCodeAt(0)),
    );
    expect(out).toHaveLength(t.length * 2);
  });

  it('surrogate pairs become one keysym', () => {
    expect(ev(k().typeText('a😀b'))).toEqual([
      down(0x61),
      up(0x61),
      down(0x0101f600),
      up(0x0101f600),
      down(0x62),
      up(0x62),
    ]);
  });

  it('lone surrogates are skipped', () => {
    expect(ev(k().typeText('a\ud800b'))).toEqual([down(0x61), up(0x61), down(0x62), up(0x62)]);
  });

  it('newline variants send a single Enter each', () => {
    const enter = KEYSYM.Return;
    const presses = (s: string) =>
      k()
        .typeText(s)
        .filter((e) => e.pressed)
        .map((e) => e.keysym);
    expect(presses('a\nb')).toEqual([0x61, enter, 0x62]);
    expect(presses('a\r\nb')).toEqual([0x61, enter, 0x62]);
    expect(presses('a\rb')).toEqual([0x61, enter, 0x62]);
    expect(presses('\r\n\r\n')).toEqual([enter, enter]);
    expect(presses('\n\r')).toEqual([enter, enter]);
  });

  it('composed CJK text', () => {
    const presses = k()
      .typeText('日本語')
      .filter((e) => e.pressed)
      .map((e) => e.keysym);
    expect(presses).toEqual([0x010065e5, 0x0100672c, 0x01008a9e]);
  });

  it('empty text produces nothing', () => {
    expect(k().typeText('')).toEqual([]);
  });

  it('every press is immediately followed by its release', () => {
    const out = k().typeText('héllo wörld\t€\n');
    for (let i = 0; i < out.length; i += 2) {
      expect(out[i]?.pressed).toBe(true);
      expect(out[i + 1]).toEqual({ keysym: out[i]?.keysym, pressed: false });
    }
  });
});

describe('combos (KEY-4)', () => {
  const parse = (s: string): Combo => {
    const r = parseCombo(s);
    if (!r.ok) throw new Error(r.error);
    return r.combo;
  };

  const rows: [string, string[][], string][] = [
    ['Ctrl+Alt+Delete', [['Ctrl', 'Alt', 'Delete']], 'Ctrl+Alt+Delete'],
    ['ctrl+alt+del', [['Ctrl', 'Alt', 'Delete']], 'Ctrl+Alt+Delete'],
    ['Win', [['Super']], 'Super'],
    ['Win+d', [['Super', 'D']], 'Super+D'],
    [' Ctrl + Shift + Esc ', [['Ctrl', 'Shift', 'Esc']], 'Ctrl+Shift+Esc'],
    ['PrtSc', [['PrintScreen']], 'PrintScreen'],
    [
      'Ctrl+K, Ctrl+C',
      [
        ['Ctrl', 'K'],
        ['Ctrl', 'C'],
      ],
      'Ctrl+K, Ctrl+C',
    ],
    ['Ctrl++', [['Ctrl', 'Plus']], 'Ctrl+Plus'],
    ['Ctrl+Plus', [['Ctrl', 'Plus']], 'Ctrl+Plus'],
    ['+', [['Plus']], 'Plus'],
    ['Ctrl+,', [['Ctrl', 'Comma']], 'Ctrl+Comma'],
    ['Alt+Space', [['Alt', 'Space']], 'Alt+Space'],
    ['Ctrl+Ctrl+C', [['Ctrl', 'C']], 'Ctrl+C'],
    ['Super+é', [['Super', 'é']], 'Super+é'],
    ['Alt+F4', [['Alt', 'F4']], 'Alt+F4'],
  ];

  it.each(rows)('parses %j', (text, steps, canonical) => {
    const c = parse(text);
    expect(c.steps).toEqual(steps);
    expect(formatCombo(c)).toBe(canonical);
    // Round trip through the canonical form.
    expect(parse(formatCombo(c))).toEqual(c);
  });

  it.each(['', '   ', 'Ctrl+', 'Ctrl+Bogus', 'Ctrl+ab', 'F99'])('rejects %j', (text) => {
    const r = parseCombo(text);
    expect(r.ok).toBe(false);
  });

  it('chord: press in order, release in reverse', () => {
    expect(ev(comboEvents(parse('Ctrl+Alt+Delete')))).toEqual([
      down(CTRL),
      down(ALT),
      down(DEL),
      up(DEL),
      up(ALT),
      up(CTRL),
    ]);
  });

  it('sequence: chords run one after another', () => {
    expect(ev(comboEvents(parse('Ctrl+K, Ctrl+C')))).toEqual([
      down(CTRL),
      down(0x6b),
      up(0x6b),
      up(CTRL),
      down(CTRL),
      down(0x63),
      up(0x63),
      up(CTRL),
    ]);
  });

  it('letters map to lowercase keysyms so guacd does not add Shift', () => {
    expect(keysymForComboToken('D')).toBe(0x64);
    expect(keysymForComboToken('d')).toBe(0x64);
    expect(keysymForComboToken('1')).toBe(0x31);
    expect(keysymForComboToken('\u0001')).toBeNull();
  });

  it('locked modifiers are not pressed again or released by a combo; one-shots untouched', () => {
    const k = new KeyModel();
    k.tapModifier('Ctrl');
    k.tapModifier('Ctrl'); // locked, held on remote
    k.tapModifier('Shift'); // one-shot, pending
    expect(ev(k.runCombo(parse('Ctrl+Alt+Delete')))).toEqual([
      down(ALT),
      down(DEL),
      up(DEL),
      up(ALT),
    ]);
    expect(k.getModifier('Shift')).toBe('once');
    expect(k.getModifier('Ctrl')).toBe('locked');
  });

  it('presets cover KEY-4 and all produce balanced events', () => {
    expect(COMBO_PRESETS.map((p) => p.label)).toEqual([
      'Ctrl+Alt+Del',
      'Alt+Tab',
      'Alt+F4',
      'Win',
      'Win+D',
      'Ctrl+Shift+Esc',
      'PrtSc',
    ]);
    for (const p of COMBO_PRESETS) {
      const events = comboEvents(p.combo);
      expect(events.length).toBeGreaterThan(0);
      const held = new Set<number>();
      for (const e of events) {
        if (e.pressed) held.add(e.keysym);
        else expect(held.delete(e.keysym)).toBe(true);
      }
      expect(held.size).toBe(0);
    }
    const byId = Object.fromEntries(COMBO_PRESETS.map((p) => [p.id, ev(comboEvents(p.combo))]));
    expect(byId['win']).toEqual([down(SUPER), up(SUPER)]);
    expect(byId['prtsc']).toEqual([down(0xff61), up(0xff61)]);
    expect(byId['ctrl-shift-esc']).toEqual([
      down(CTRL),
      down(SHIFT),
      down(0xff1b),
      up(0xff1b),
      up(SHIFT),
      up(CTRL),
    ]);
  });
});

/**
 * AUDIT #5: chords send what a physical US keyboard sends through `Guacamole.Keyboard`, so
 * guacd's RDP Shift adjustment (keymaps/en_us_qwerty.keymap: `t` = -shift, `T` = +shift,
 * `1` = -shift, `!` = +shift; keyboard.c presses/releases Shift to match before the
 * scancode) leaves the chord intact. Each row: what is sent, and why.
 */
describe('Shift in chords and on the key bar (guacd 1.6.0 RDP keymap rule)', () => {
  const parse = (text: string): Combo => {
    const r = parseCombo(text);
    if (!r.ok) throw new Error(r.error);
    return r.combo;
  };
  const T = 0x54;
  const t = 0x74;
  const TAB = 0xff09;
  const ESC = 0xff1b;
  const comboRows: [string, string[], string][] = [
    [
      'Ctrl+Shift+T',
      [down(CTRL), down(SHIFT), down(T), up(T), up(SHIFT), up(CTRL)],
      'uppercase T keeps the held Shift (keymap `T` = +shift); `t` would make guacd release it',
    ],
    [
      'Ctrl+T',
      [down(CTRL), down(t), up(t), up(CTRL)],
      'no Shift: lowercase, or guacd would add a synthetic Shift (Ctrl+Shift+T)',
    ],
    [
      'Ctrl+Shift+1',
      [down(CTRL), down(SHIFT), down(0x21), up(0x21), up(SHIFT), up(CTRL)],
      'Shift+1 is "!" on a US keyboard; keysym `1` (-shift) would drop the Shift',
    ],
    [
      'Ctrl+!',
      [down(CTRL), down(SHIFT), down(0x21), up(0x21), up(SHIFT), up(CTRL)],
      'a shifted symbol needs Shift, so it is added as a physical keyboard would',
    ],
    [
      'Alt+Shift+Tab',
      [down(ALT), down(SHIFT), down(TAB), up(TAB), up(SHIFT), up(ALT)],
      'Tab has no Shift constraint in base.keymap; never ISO_Left_Tab (unmapped, dropped)',
    ],
    [
      'Ctrl+Shift+Esc',
      [down(CTRL), down(SHIFT), down(ESC), up(ESC), up(SHIFT), up(CTRL)],
      'named keys are sent as their base keysym',
    ],
    [
      'Super+Shift+S',
      [down(SUPER), down(SHIFT), down(0x53), up(0x53), up(SHIFT), up(SUPER)],
      'Win+Shift+S (snip): uppercase S with Shift held',
    ],
    ['Shift+A', [down(SHIFT), down(0x41), up(0x41), up(SHIFT)], 'plain Shift+letter: uppercase'],
    [
      'T+Shift+Ctrl',
      [down(SHIFT), down(CTRL), down(T), up(T), up(CTRL), up(SHIFT)],
      'modifiers are pressed before the key whatever the written order',
    ],
  ];

  it.each(comboRows)('combo %s', (text, expected) => {
    expect(ev(comboEvents(parse(text)))).toEqual(expected);
  });

  it('a combo run while the key-bar Shift is locked keeps the case consistent with it', () => {
    const k = new KeyModel();
    k.tapModifier('Shift');
    expect(ev(k.tapModifier('Shift'))).toEqual([down(SHIFT)]); // locked, held on the remote
    expect(ev(k.runCombo(parse('Ctrl+T')))).toEqual([down(CTRL), down(T), up(T), up(CTRL)]);
  });

  it('key bar: sticky Shift + "1" sends "!" with Shift held', () => {
    const k = new KeyModel();
    k.tapModifier('Shift');
    expect(ev(k.typeText('1'))).toEqual([down(SHIFT), down(0x21), up(0x21), up(SHIFT)]);
  });

  it('key bar: sticky Ctrl + Shift + "t" sends Ctrl, Shift, T', () => {
    const k = new KeyModel();
    k.tapModifier('Ctrl');
    k.tapModifier('Shift');
    expect(ev(k.typeText('t'))).toEqual([
      down(CTRL),
      down(SHIFT),
      down(T),
      up(T),
      up(SHIFT),
      up(CTRL),
    ]);
  });

  it('key bar: sticky Shift + "a" sends A; sticky Ctrl + "C" sends lowercase c', () => {
    const k = new KeyModel();
    k.tapModifier('Shift');
    expect(ev(k.typeText('a'))).toEqual([down(SHIFT), down(0x41), up(0x41), up(SHIFT)]);
    k.tapModifier('Ctrl');
    expect(ev(k.typeText('C'))).toEqual([down(CTRL), down(0x63), up(0x63), up(CTRL)]);
  });

  it('key bar: sticky Alt + Shift + Tab key', () => {
    const k = new KeyModel();
    k.tapModifier('Alt');
    k.tapModifier('Shift');
    expect(ev(k.pressKey('Tab'))).toEqual([
      down(ALT),
      down(SHIFT),
      down(TAB),
      up(TAB),
      up(SHIFT),
      up(ALT),
    ]);
  });
});
