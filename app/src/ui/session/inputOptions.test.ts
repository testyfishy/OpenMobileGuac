import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEY_BAR_LAYOUT,
  availableTokens,
  comboToken,
  editKeyBarLayout,
  normalizeKeyBarLayout,
  parseToken,
  resolveKeyBarLayout,
  tokenLabel,
  visibleRows,
} from './keyBarLayout.ts';
import { extraButtonCombo, penButtons } from './inputMapping.ts';
import {
  DEFAULT_SESSION_SETTINGS,
  INPUT_RANGES,
  gestureConfigFromSettings,
  normalizeSessionSettings,
  pointerConfigFromSettings,
  sanitizeSessionSettingsPatch,
  type SessionSettings,
} from './settings.ts';

const BASE: SessionSettings = {
  fitMode: 'fit-screen',
  pointerMode: 'direct',
  matchDeviceSize: false,
  pointerSpeed: 1,
  naturalScroll: true,
  haptics: true,
  clipboardRemoteToDevice: true,
  clipboardAutoSendOnFocus: false,
  keepAwake: true,
  customCombos: [],
};

describe('input settings (PTR-7)', () => {
  it('old stored settings (without the new fields) load with defaults', () => {
    const s = normalizeSessionSettings(BASE);
    expect(s).toEqual(DEFAULT_SESSION_SETTINGS);
  });

  it.each([
    ['longPressMs', 50, INPUT_RANGES.longPressMs[0]],
    ['longPressMs', 99_999, INPUT_RANGES.longPressMs[1]],
    ['doubleTapWindowMs', -5, INPUT_RANGES.doubleTapWindowMs[0]],
    ['tapSlopPx', 1000, INPUT_RANGES.tapSlopPx[1]],
    ['pointerAcceleration', Number.NaN, 1],
  ] as const)('%s = %s is clamped to %s', (key, value, expected) => {
    expect(normalizeSessionSettings({ ...BASE, [key]: value })[key]).toBe(expected);
  });

  it('repairs bad enum values and keeps the touch pointer mode', () => {
    const s = normalizeSessionSettings({
      ...BASE,
      pointerMode: 'touch',
      splitLayout: 'sideways' as never,
      textInputMode: 'x' as never,
      directOneFinger: 'drag',
    });
    expect([s.pointerMode, s.splitLayout, s.textInputMode, s.directOneFinger]).toEqual([
      'touch',
      'auto',
      'live',
      'drag',
    ]);
  });

  it('maps to the pointer and gesture configs', () => {
    const s = {
      ...BASE,
      pointerMode: 'trackpad' as const,
      tapDrag: false,
      twoFingerDrag: 'pan' as const,
      directOneFinger: 'drag' as const,
      horizontalScroll: false,
      pointerAcceleration: 0,
    };
    expect(pointerConfigFromSettings(s)).toEqual({
      mode: 'trackpad',
      pointerSpeed: 1,
      pointerAcceleration: 0,
      naturalScroll: true,
      tapDrag: false,
      directPan: 'drag',
      twoFingerPan: 'viewport',
      horizontalScroll: false,
      pinchZoom: true,
      twoFingerTap: true,
      threeFingerTap: true,
      threeFingerDoubleTap: true,
    });
    expect(gestureConfigFromSettings({ ...BASE, longPressMs: 400, tapSlopPx: 20 })).toEqual({
      longPressMs: 400,
      longPress: true,
      doubleTapWindowMs: 300,
      tapSlopPx: 20,
      tapMaxMs: 200,
      multiTouchSlopPx: 32,
    });
  });

  it('gesture switches: on by default, kept when off, repaired when not boolean', () => {
    const keys = [
      'gestureLongPress',
      'gestureTwoFingerTap',
      'gestureThreeFingerTap',
      'gestureZoomReset',
      'gesturePinchZoom',
      'sheetSwipeClose',
      'keySetLongPress',
      'pasteLongPress',
    ] as const;
    const d = normalizeSessionSettings(BASE);
    for (const k of keys) expect(d[k], k).toBe(true);
    const off = normalizeSessionSettings({
      ...BASE,
      ...Object.fromEntries(keys.map((k) => [k, false])),
    });
    for (const k of keys) expect(off[k], k).toBe(false);
    const junk = normalizeSessionSettings({
      ...BASE,
      ...(Object.fromEntries(keys.map((k) => [k, 'no'])) as Partial<SessionSettings>),
    });
    for (const k of keys) expect(junk[k], k).toBe(true);
    expect(sanitizeSessionSettingsPatch({ gesturePinchZoom: false, sheetSwipeClose: 0 })).toEqual({
      gesturePinchZoom: false,
      sheetSwipeClose: true,
    });
  });

  it('gesture switches reach the recogniser and the pointer model', () => {
    const s = {
      ...BASE,
      gestureLongPress: false,
      gestureTwoFingerTap: false,
      gestureThreeFingerTap: false,
      gestureZoomReset: false,
      gesturePinchZoom: false,
    };
    expect(gestureConfigFromSettings(s).longPress).toBe(false);
    expect(pointerConfigFromSettings(s)).toMatchObject({
      pinchZoom: false,
      twoFingerTap: false,
      threeFingerTap: false,
      threeFingerDoubleTap: false,
    });
  });

  it('sanitizeSessionSettingsPatch keeps present keys only, normalised', () => {
    expect(
      sanitizeSessionSettingsPatch({
        longPressMs: 5,
        tapDrag: false,
        junk: 1,
        pointerMode: 'touch',
      }),
    ).toEqual({ longPressMs: 300, tapDrag: false, pointerMode: 'touch' });
    expect(sanitizeSessionSettingsPatch(null)).toEqual({});
    expect(sanitizeSessionSettingsPatch([1])).toEqual({});
  });
});

describe('key bar layout (KEY-7)', () => {
  it('parses tokens', () => {
    expect(parseToken('Ctrl')).toEqual({ kind: 'modifier', mod: 'Ctrl' });
    expect(parseToken('F5')).toEqual({ kind: 'key', name: 'F5' });
    expect(parseToken('Fn')).toEqual({ kind: 'fn' });
    expect(parseToken('combo:ctrl+shift+t')).toEqual({ kind: 'combo', text: 'Ctrl+Shift+T' });
    expect(parseToken('del')).toBeNull(); // must be canonical
    expect(parseToken('combo:Nope+Q')).toBeNull();
    expect(comboToken('alt + f4')).toBe('combo:Alt+F4');
  });

  it('labels', () => {
    expect(tokenLabel('Super')).toBe('Win');
    expect(tokenLabel('PageDown')).toBe('PgDn');
    expect(tokenLabel('combo:Super+D')).toBe('Win+D');
    expect(tokenLabel('combo:Ctrl+Alt+Delete')).toBe('Ctrl+Alt+Del');
  });

  it('normalises stored layouts', () => {
    expect(normalizeKeyBarLayout(undefined)).toBeNull();
    expect(normalizeKeyBarLayout([[], []])).toBeNull();
    expect(normalizeKeyBarLayout([['Esc', 'bogus', 3], 'x', ['F1']])).toEqual([['Esc'], ['F1']]);
    expect(resolveKeyBarLayout(null)).toBe(DEFAULT_KEY_BAR_LAYOUT);
  });

  it('Fn toggles the rows after the first (shown above it)', () => {
    const l = DEFAULT_KEY_BAR_LAYOUT;
    expect(visibleRows(l, false)).toHaveLength(1);
    expect(visibleRows(l, true)[0]?.[0]).toBe('F1');
    expect(visibleRows([['Esc'], ['F1']], false)).toHaveLength(2); // no Fn: all rows
  });

  it('edits: add, move, remove keys and rows, reset', () => {
    let l = editKeyBarLayout(null, { type: 'add-row' });
    expect(l).toHaveLength(3);
    l = editKeyBarLayout(l, { type: 'add', row: 2, token: 'combo:Ctrl+Z' });
    l = editKeyBarLayout(l, { type: 'add', row: 2, token: 'Insert' });
    l = editKeyBarLayout(l, { type: 'add', row: 2, token: 'not-a-key' });
    expect(l?.[2]).toEqual(['combo:Ctrl+Z', 'Insert']);
    l = editKeyBarLayout(l, { type: 'move', row: 2, index: 1, delta: -1 });
    expect(l?.[2]).toEqual(['Insert', 'combo:Ctrl+Z']);
    l = editKeyBarLayout(l, { type: 'move', row: 2, index: 0, delta: -1 }); // no-op at edge
    expect(l?.[2]).toEqual(['Insert', 'combo:Ctrl+Z']);
    l = editKeyBarLayout(l, { type: 'remove', row: 2, index: 0 });
    expect(l?.[2]).toEqual(['combo:Ctrl+Z']);
    l = editKeyBarLayout(l, { type: 'move-row', row: 2, delta: -1 });
    expect(l?.[1]).toEqual(['combo:Ctrl+Z']);
    l = editKeyBarLayout(l, { type: 'remove-row', row: 1 });
    expect(l).toHaveLength(2);
    expect(editKeyBarLayout(l, { type: 'reset' })).toBeNull();
    // The last row cannot be removed.
    expect(editKeyBarLayout([['Esc']], { type: 'remove-row', row: 0 })).toEqual([['Esc']]);
  });

  it('lists modifiers, keys, Fn, presets and saved combos to add', () => {
    const t = availableTokens(['Ctrl+Shift+T', 'garbage+']);
    expect(t.slice(0, 6)).toEqual(['Ctrl', 'Alt', 'Shift', 'Super', 'AltGr', 'Fn']);
    expect(t).toContain('F24');
    expect(t).toContain('combo:Ctrl+Alt+Delete');
    expect(t).toContain('combo:Ctrl+Shift+T');
    expect(new Set(t).size).toBe(t.length);
  });
});

describe('pen and extra mouse buttons (PTR-5)', () => {
  it('pen: tip = left, barrel = right (replaces left), eraser = left', () => {
    expect(penButtons(1)).toEqual({ left: true, middle: false, right: false });
    expect(penButtons(3)).toEqual({ left: false, middle: false, right: true });
    expect(penButtons(2)).toEqual({ left: false, middle: false, right: true });
    expect(penButtons(32)).toEqual({ left: true, middle: false, right: false });
    expect(penButtons(0)).toEqual({ left: false, middle: false, right: false });
  });

  it('back / forward buttons become Alt+Left / Alt+Right on press only', () => {
    const back = extraButtonCombo(0, 8).map(
      (e) => `${e.pressed ? '+' : '-'}${e.keysym.toString(16)}`,
    );
    expect(back).toEqual(['+ffe9', '+ff51', '-ff51', '-ffe9']);
    expect(extraButtonCombo(8, 8)).toEqual([]);
    expect(extraButtonCombo(0, 16)[1]?.keysym).toBe(0xff53);
  });
});
