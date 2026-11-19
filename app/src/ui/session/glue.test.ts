import { describe, expect, it } from 'vitest';
import { KEYSYM } from '../../session/keys/KeyModel.ts';
import { comboMenuEntries, reduceComboList, validateCombo } from './combos.ts';
import {
  decideHardwareKey,
  guacButtonMask,
  keysymForKey,
  missingModifierKeysyms,
  pointerButtons,
  pointerKind,
  toGuacMouseTemplate,
  wheelDeltaPx,
  type KeyEventLike,
} from './inputMapping.ts';
import { computeLayout, cursorDrawScale, visualViewportInset } from './layout.ts';
import {
  DEFAULT_SESSION_SETTINGS,
  normalizeSessionSettings,
  pointerConfigFromSettings,
} from './settings.ts';
import {
  INITIAL_SESSION_MACHINE,
  STATUS,
  isRetryableStatus,
  reconnectDelay,
  reduceSession,
  statusMessage,
  type SessionEvent,
  type SessionMachine,
} from './status.ts';

describe('settings', () => {
  it('has the documented defaults', () => {
    expect(DEFAULT_SESSION_SETTINGS).toMatchObject({
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
    });
  });

  it('normalises bad stored values', () => {
    const s = normalizeSessionSettings({
      fitMode: 'zoom' as never,
      pointerMode: 'x' as never,
      pointerSpeed: 99,
      customCombos: ['Ctrl+C', 3 as never],
    });
    expect(s.fitMode).toBe('fit-screen');
    expect(s.pointerMode).toBe('direct');
    expect(s.pointerSpeed).toBe(4);
    expect(s.customCombos).toEqual(['Ctrl+C']);
    expect(normalizeSessionSettings(null)).toEqual(DEFAULT_SESSION_SETTINGS);
  });

  it('maps to pointer config', () => {
    expect(
      pointerConfigFromSettings({
        ...DEFAULT_SESSION_SETTINGS,
        pointerMode: 'trackpad',
        pointerSpeed: 0.1,
        naturalScroll: false,
      }),
    ).toMatchObject({ mode: 'trackpad', pointerSpeed: 0.25, naturalScroll: false });
  });
});

describe('status messages', () => {
  it('maps known codes', () => {
    expect(statusMessage(STATUS.UPSTREAM_NOT_FOUND)).toMatch(/could not be found/);
    expect(statusMessage(STATUS.CLIENT_UNAUTHORIZED)).toMatch(/Sign in/);
  });
  it('falls back to the server text, then a generic message', () => {
    expect(statusMessage(0x0999, ' custom ')).toBe('custom');
    expect(statusMessage(0x0399)).toBe('The request was refused (code 0x0399).');
    expect(statusMessage(0x0299)).toBe('The connection failed (code 0x0299).');
  });
  it('classifies retryable codes', () => {
    expect(isRetryableStatus(STATUS.UPSTREAM_UNAVAILABLE)).toBe(true);
    expect(isRetryableStatus(STATUS.CLIENT_UNAUTHORIZED)).toBe(false);
    expect(isRetryableStatus(STATUS.SESSION_CONFLICT)).toBe(false);
  });
  it('backs off exponentially with a cap', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => reconnectDelay(n))).toEqual([
      1000, 2000, 4000, 8000, 8000, 8000,
    ]);
  });
});

describe('session machine', () => {
  const run = (events: SessionEvent[], m: SessionMachine = INITIAL_SESSION_MACHINE) =>
    events.reduce((acc, e) => reduceSession(acc, e), m);

  it('connects', () => {
    expect(run([{ type: 'connect' }, { type: 'connected' }]).phase.kind).toBe('connected');
  });

  it('does not retry a first connection that never succeeded', () => {
    const m = run([{ type: 'connect' }, { type: 'closed', intentional: false }]);
    expect(m.phase).toEqual({ kind: 'error', code: null, message: 'Could not reach the server.' });
  });

  it('retries an unexpected close after connecting, with backoff, then gives up', () => {
    let m = run([
      { type: 'connect' },
      { type: 'connected' },
      { type: 'closed', intentional: false },
    ]);
    expect(m.phase).toMatchObject({ kind: 'reconnecting', attempt: 1, delayMs: 1000 });
    for (let i = 2; i <= 4; i++) {
      m = run([{ type: 'connect' }, { type: 'closed', intentional: false }], m);
      expect(m.phase).toMatchObject({ kind: 'reconnecting', attempt: i });
    }
    m = run([{ type: 'connect' }, { type: 'closed', intentional: false }], m);
    expect(m.phase.kind).toBe('error');
  });

  it('resets attempts once reconnected', () => {
    const m = run([
      { type: 'connect' },
      { type: 'connected' },
      { type: 'closed', intentional: false },
      { type: 'connect' },
      { type: 'connected' },
    ]);
    expect(m.attempts).toBe(0);
    expect(m.phase.kind).toBe('connected');
  });

  it('does not retry non-retryable errors', () => {
    const m = run([
      { type: 'connect' },
      { type: 'connected' },
      { type: 'error', code: STATUS.SESSION_CONFLICT },
      { type: 'closed', intentional: false },
    ]);
    expect(m.phase).toMatchObject({ kind: 'error', code: STATUS.SESSION_CONFLICT });
  });

  it('retries retryable errors', () => {
    const m = run([
      { type: 'connect' },
      { type: 'connected' },
      { type: 'error', code: STATUS.UPSTREAM_TIMEOUT },
      { type: 'closed', intentional: false },
    ]);
    expect(m.phase.kind).toBe('reconnecting');
  });

  it('treats intentional closes as disconnected, unless an error came first', () => {
    expect(
      run([{ type: 'connect' }, { type: 'connected' }, { type: 'closed', intentional: true }]).phase
        .kind,
    ).toBe('disconnected');
    expect(
      run([
        { type: 'connect' },
        { type: 'error', code: STATUS.CLIENT_FORBIDDEN, message: 'x' },
        { type: 'closed', intentional: true },
      ]).phase,
    ).toMatchObject({ kind: 'error', code: STATUS.CLIENT_FORBIDDEN });
  });

  it('keeps a user disconnect final', () => {
    const m = run([
      { type: 'connect' },
      { type: 'connected' },
      { type: 'user-disconnect' },
      { type: 'closed', intentional: false },
    ]);
    expect(m.phase.kind).toBe('disconnected');
  });
});

describe('mouse mapping', () => {
  const s = { x: 10.7, y: 3.2, left: true, middle: false, right: true, up: false, down: true };
  it('builds the library template with integer coordinates', () => {
    expect(toGuacMouseTemplate(s)).toEqual({ ...s, x: 10, y: 3 });
  });
  it('builds the wire mask', () => {
    expect(guacButtonMask(s)).toBe(1 | 4 | 16);
    expect(
      guacButtonMask({ ...s, left: false, right: false, down: false, middle: true, up: true }),
    ).toBe(2 | 8);
  });
  it('maps PointerEvent.buttons (right = 2, middle = 4)', () => {
    expect(pointerButtons(1)).toEqual({ left: true, middle: false, right: false });
    expect(pointerButtons(2)).toEqual({ left: false, middle: false, right: true });
    expect(pointerButtons(4)).toEqual({ left: false, middle: true, right: false });
    expect(pointerButtons(Number.NaN)).toEqual({ left: false, middle: false, right: false });
  });
  it('maps pointer types', () => {
    expect(pointerKind('mouse')).toBe('mouse');
    expect(pointerKind('pen')).toBe('pen');
    expect(pointerKind('touch')).toBe('touch');
    expect(pointerKind('')).toBe('touch');
  });
  it('converts wheel deltas', () => {
    expect(wheelDeltaPx(3, 1, 800)).toBe(48);
    expect(wheelDeltaPx(1, 2, 1000)).toBe(900);
    expect(wheelDeltaPx(12, 0, 1000)).toBe(12);
  });
});

describe('hardware keys', () => {
  const ev = (over: Partial<KeyEventLike>): KeyEventLike => ({
    key: 'a',
    code: 'KeyA',
    keyCode: 65,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    isComposing: false,
    ...over,
  });

  it('leaves plain text, Enter and Backspace to the focused field', () => {
    expect(decideHardwareKey(ev({}), true)).toEqual({ action: 'field' });
    expect(decideHardwareKey(ev({ key: 'Enter' }), true)).toEqual({ action: 'field' });
    expect(decideHardwareKey(ev({ key: 'Backspace' }), true)).toEqual({ action: 'field' });
  });

  it('sends plain text itself when the field is not focused', () => {
    expect(decideHardwareKey(ev({ key: 'A' }), false)).toEqual({ action: 'send', keysym: 0x41 });
    expect(decideHardwareKey(ev({ key: 'Enter' }), false)).toEqual({
      action: 'send',
      keysym: KEYSYM.Return,
    });
  });

  it('sends named keys and chords from keydown', () => {
    expect(decideHardwareKey(ev({ key: 'ArrowUp' }), true)).toEqual({
      action: 'send',
      keysym: KEYSYM.Up,
    });
    expect(decideHardwareKey(ev({ key: 'F5' }), true)).toEqual({
      action: 'send',
      keysym: KEYSYM.F1 + 4,
    });
    expect(decideHardwareKey(ev({ key: 'C', ctrlKey: true }), true)).toEqual({
      action: 'send',
      keysym: 0x63,
    });
    expect(decideHardwareKey(ev({ key: 'Control', code: 'ControlRight' }), true)).toEqual({
      action: 'send',
      keysym: KEYSYM.Control_R,
    });
  });

  it('treats AltGr / Option characters as text', () => {
    expect(decideHardwareKey(ev({ key: '@', ctrlKey: true, altKey: true }), true)).toEqual({
      action: 'field',
    });
    expect(decideHardwareKey(ev({ key: 'x', altKey: true }), true)).toEqual({
      action: 'send',
      keysym: 0x78,
    });
  });

  it('ignores composition and soft-keyboard pseudo keys', () => {
    expect(decideHardwareKey(ev({ isComposing: true }), true).action).toBe('ignore');
    expect(decideHardwareKey(ev({ keyCode: 229 }), true).action).toBe('ignore');
    expect(decideHardwareKey(ev({ key: 'Unidentified' }), false).action).toBe('ignore');
    expect(decideHardwareKey(ev({ key: 'Dead' }), false).action).toBe('ignore');
    expect(decideHardwareKey(ev({ key: 'BrowserBack' }), false).action).toBe('ignore');
  });

  it('synthesises modifiers a chord needs but the remote does not hold', () => {
    const flags = { ctrlKey: true, altKey: false, metaKey: false, shiftKey: true };
    expect(missingModifierKeysyms(flags, new Set())).toEqual([KEYSYM.Control_L, KEYSYM.Shift_L]);
    expect(missingModifierKeysyms(flags, new Set([KEYSYM.Control_R]))).toEqual([KEYSYM.Shift_L]);
    expect(
      missingModifierKeysyms(
        { ctrlKey: false, altKey: true, metaKey: true, shiftKey: false },
        new Set(),
      ),
    ).toEqual([KEYSYM.Alt_L, KEYSYM.Super_L]);
  });

  it('maps modifier sides and letters under chords', () => {
    expect(keysymForKey('Meta', 'MetaLeft', false)).toBe(KEYSYM.Super_L);
    expect(keysymForKey('Shift', 'ShiftRight', false)).toBe(KEYSYM.Shift_R);
    expect(keysymForKey('Q', 'KeyQ', true)).toBe(0x71);
    expect(keysymForKey('é', 'KeyE', false)).toBe(0xe9);
  });
});

describe('combo list', () => {
  it('adds canonical combos and rejects invalid or duplicate ones', () => {
    let r = reduceComboList([], { type: 'add', text: 'ctrl + shift + esc' });
    expect(r).toEqual({ ok: true, list: ['Ctrl+Shift+Esc'] });
    r = reduceComboList(r.list, { type: 'add', text: 'Control+Shift+Escape' });
    expect(r.ok).toBe(false);
    r = reduceComboList(r.list, { type: 'add', text: 'Ctrl+Banana' });
    expect(r).toMatchObject({ ok: false, error: 'Unknown key "Banana"' });
    expect(validateCombo('Ctrl+')).toEqual({ ok: false, error: 'Combo ends with "+"' });
  });

  it('removes and reorders', () => {
    const list = ['A', 'B', 'C'];
    expect(reduceComboList(list, { type: 'remove', index: 1 }).list).toEqual(['A', 'C']);
    expect(reduceComboList(list, { type: 'move', index: 0, delta: 1 }).list).toEqual([
      'B',
      'A',
      'C',
    ]);
    expect(reduceComboList(list, { type: 'move', index: 0, delta: -1 }).list).toEqual(list);
    expect(reduceComboList(list, { type: 'remove', index: 7 }).list).toEqual(list);
  });

  it('lists presets then valid custom combos', () => {
    const entries = comboMenuEntries(['Ctrl+K, Ctrl+C', 'nonsense+key']);
    expect(entries[0]?.label).toBe('Ctrl+Alt+Del');
    const custom = entries.filter((e) => e.customIndex !== null);
    expect(custom.map((e) => e.label)).toEqual(['Ctrl+K, Ctrl+C']);
  });
});

describe('layout', () => {
  const base = {
    stable: { width: 400, height: 800 },
    keyboardOpen: false,
    nativeKeyboardHeight: 0,
    visualViewportInset: 0,
  };

  it('passes the measured size through with no keyboard', () => {
    expect(computeLayout({ ...base, measured: { width: 800, height: 400 } })).toEqual({
      screen: { width: 800, height: 400 },
      keyboardInset: 0,
      stable: { width: 800, height: 400 },
    });
  });

  it('keeps the stable size when the WebView shrinks for the keyboard', () => {
    const out = computeLayout({
      ...base,
      keyboardOpen: true,
      nativeKeyboardHeight: 300,
      measured: { width: 400, height: 500 },
    });
    expect(out).toEqual({
      screen: { width: 400, height: 800 },
      keyboardInset: 300,
      stable: base.stable,
    });
  });

  it('uses the native height when the WebView does not shrink', () => {
    const out = computeLayout({
      ...base,
      keyboardOpen: true,
      nativeKeyboardHeight: 320,
      measured: { width: 400, height: 800 },
    });
    expect(out.keyboardInset).toBe(320);
  });

  it('uses the visual viewport inset on the web', () => {
    const out = computeLayout({
      ...base,
      keyboardOpen: true,
      visualViewportInset: 280,
      measured: { width: 400, height: 800 },
    });
    expect(out.keyboardInset).toBe(280);
    expect(visualViewportInset(800, 0, 520)).toBe(280);
    expect(visualViewportInset(800, 0, 900)).toBe(0);
  });

  it('relearns the stable size after a rotation with the keyboard open', () => {
    const out = computeLayout({
      ...base,
      keyboardOpen: true,
      measured: { width: 800, height: 300 },
    });
    expect(out.stable).toEqual({ width: 800, height: 300 });
  });

  it('clamps the cursor scale', () => {
    expect(cursorDrawScale(0.2)).toBe(0.75);
    expect(cursorDrawScale(1.2)).toBe(1.2);
    expect(cursorDrawScale(6)).toBe(1.5);
    expect(cursorDrawScale(Number.NaN)).toBe(1);
  });
});
