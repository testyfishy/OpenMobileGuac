/**
 * Per-connection session settings (the contract the app shell persists) and their mapping
 * onto the pure session models.
 *
 * Fields added after the first release are optional so that stored settings (and code that
 * builds a `SessionSettings` literal) keep working; `normalizeSessionSettings` fills them
 * from `DEFAULT_SESSION_SETTINGS` and clamps them to safe ranges.
 */

import type { GestureConfig } from '../../session/gesture/GestureRecognizer.ts';
import type { FitMode } from '../../session/viewport/Viewport.ts';
import type { PointerConfig, PointerMode } from '../../session/pointer/PointerModel.ts';
import { normalizeKeyBarLayout } from './keyBarLayout.ts';

export interface SessionSettings {
  fitMode: FitMode;
  pointerMode: PointerMode;
  /** DSP-4: ask the server to resize the remote to the device. */
  matchDeviceSize: boolean;
  /** 0.25..4, 1 = default. */
  pointerSpeed: number;
  naturalScroll: boolean;
  haptics: boolean;
  clipboardRemoteToDevice: boolean;
  clipboardAutoSendOnFocus: boolean;
  keepAwake: boolean;
  /** e.g. "Ctrl+Shift+Esc", parsed by KeyModel.parseCombo. */
  customCombos: string[];

  // ---- Input options (PTR-7 and later; optional for compatibility)
  /** Trackpad acceleration 0..2 (0 = linear). */
  pointerAcceleration?: number;
  /** Long-press time (ms). */
  longPressMs?: number;
  /** Double-tap window (ms); also the longest tap-drag release delay. */
  doubleTapWindowMs?: number;
  /** Finger movement (px) still counted as a tap. */
  tapSlopPx?: number;
  /** Trackpad tap-and-a-half drag (off = taps are complete clicks with zero delay). */
  tapDrag?: boolean;
  /** Direct mode one-finger drag when zoomed in. (When the desktop fits, it always drags.) */
  directOneFinger?: 'pan' | 'drag';
  /** Two-finger drag: scroll the remote or pan the view. */
  twoFingerDrag?: 'scroll' | 'pan';
  /** Two-finger horizontal scroll as Shift + wheel. */
  horizontalScroll?: boolean;
  /** Soft-keyboard text: send live, or hold each word until a boundary (fallback). */
  textInputMode?: 'live' | 'word';
  /** Show the visible "Text input" bar (type / dictate / paste, then Send). */
  textInputBar?: boolean;
  /** Key bar rows (tokens, see keyBarLayout.ts); null = built-in layout. */
  keyBarLayout?: string[][] | null;
  /** Larger, high-contrast cursor overlay. */
  largeCursor?: boolean;
  /** Split layout: display above a trackpad + key bar. `auto` = on a folded (tabletop) device. */
  splitLayout?: 'auto' | 'on' | 'off';
  /** Hide system bars (native) / full screen (web). */
  immersive?: boolean;
  /** Hardware mouse in trackpad mode: capture the pointer for relative motion. */
  pointerLock?: boolean;
  /** AUD-1: remote audio muted for this connection. */
  audioMuted?: boolean;
}

/** Settings with every optional field resolved. */
export type ResolvedSessionSettings = Required<SessionSettings>;

export const DEFAULT_SESSION_SETTINGS: ResolvedSessionSettings = {
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
  pointerAcceleration: 1,
  longPressMs: 500,
  doubleTapWindowMs: 300,
  tapSlopPx: 10,
  tapDrag: true,
  directOneFinger: 'pan',
  twoFingerDrag: 'scroll',
  horizontalScroll: true,
  textInputMode: 'live',
  textInputBar: false,
  keyBarLayout: null,
  largeCursor: false,
  splitLayout: 'auto',
  immersive: false,
  pointerLock: false,
  audioMuted: false,
};

export const MIN_POINTER_SPEED = 0.25;
export const MAX_POINTER_SPEED = 4;

/** Safe ranges for the numeric input options: [min, max, step]. */
export const INPUT_RANGES = {
  pointerSpeed: [MIN_POINTER_SPEED, MAX_POINTER_SPEED, 0.25],
  pointerAcceleration: [0, 2, 0.25],
  longPressMs: [300, 1200, 50],
  doubleTapWindowMs: [150, 600, 25],
  tapSlopPx: [4, 30, 1],
} as const satisfies Record<string, readonly [number, number, number]>;

export type NumericInputSetting = keyof typeof INPUT_RANGES;

function clampTo(value: unknown, key: NumericInputSetting): number {
  const [min, max] = INPUT_RANGES[key];
  const fallback = DEFAULT_SESSION_SETTINGS[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function clampPointerSpeed(speed: number): number {
  return clampTo(speed, 'pointerSpeed');
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

const FIT_MODES_LIST: readonly FitMode[] = ['fit-screen', 'fit-width', 'fit-height', 'one-to-one'];
const POINTER_MODES_LIST: readonly PointerMode[] = ['direct', 'trackpad', 'touch'];

/** Fill gaps and repair out-of-range values in settings coming from storage. */
export function normalizeSessionSettings(
  input: Partial<SessionSettings> | null | undefined,
): ResolvedSessionSettings {
  const raw: Record<string, unknown> = { ...(input ?? {}) };
  const d = DEFAULT_SESSION_SETTINGS;
  return {
    fitMode: oneOf(raw['fitMode'], FIT_MODES_LIST, d.fitMode),
    pointerMode: oneOf(raw['pointerMode'], POINTER_MODES_LIST, d.pointerMode),
    matchDeviceSize: bool(raw['matchDeviceSize'], d.matchDeviceSize),
    pointerSpeed: clampTo(raw['pointerSpeed'], 'pointerSpeed'),
    naturalScroll: bool(raw['naturalScroll'], d.naturalScroll),
    haptics: bool(raw['haptics'], d.haptics),
    clipboardRemoteToDevice: bool(raw['clipboardRemoteToDevice'], d.clipboardRemoteToDevice),
    clipboardAutoSendOnFocus: bool(raw['clipboardAutoSendOnFocus'], d.clipboardAutoSendOnFocus),
    keepAwake: bool(raw['keepAwake'], d.keepAwake),
    customCombos: Array.isArray(raw['customCombos'])
      ? (raw['customCombos'] as unknown[]).filter((c): c is string => typeof c === 'string')
      : [],
    pointerAcceleration: clampTo(raw['pointerAcceleration'], 'pointerAcceleration'),
    longPressMs: clampTo(raw['longPressMs'], 'longPressMs'),
    doubleTapWindowMs: clampTo(raw['doubleTapWindowMs'], 'doubleTapWindowMs'),
    tapSlopPx: clampTo(raw['tapSlopPx'], 'tapSlopPx'),
    tapDrag: bool(raw['tapDrag'], d.tapDrag),
    directOneFinger: oneOf(raw['directOneFinger'], ['pan', 'drag'] as const, d.directOneFinger),
    twoFingerDrag: oneOf(raw['twoFingerDrag'], ['scroll', 'pan'] as const, d.twoFingerDrag),
    horizontalScroll: bool(raw['horizontalScroll'], d.horizontalScroll),
    textInputMode: oneOf(raw['textInputMode'], ['live', 'word'] as const, d.textInputMode),
    textInputBar: bool(raw['textInputBar'], d.textInputBar),
    keyBarLayout: normalizeKeyBarLayout(raw['keyBarLayout']),
    largeCursor: bool(raw['largeCursor'], d.largeCursor),
    splitLayout: oneOf(raw['splitLayout'], ['auto', 'on', 'off'] as const, d.splitLayout),
    immersive: bool(raw['immersive'], d.immersive),
    pointerLock: bool(raw['pointerLock'], d.pointerLock),
    audioMuted: bool(raw['audioMuted'], d.audioMuted),
  };
}

/**
 * Keys owned by the session screen beyond the original contract (input options, also
 * `pointerMode: 'touch'`, and `audioMuted`). The shell's settings store keeps these through
 * `sanitizeSessionSettingsPatch`.
 */
export const INPUT_SETTING_KEYS = [
  'pointerAcceleration',
  'longPressMs',
  'doubleTapWindowMs',
  'tapSlopPx',
  'tapDrag',
  'directOneFinger',
  'twoFingerDrag',
  'horizontalScroll',
  'textInputMode',
  'textInputBar',
  'keyBarLayout',
  'largeCursor',
  'splitLayout',
  'immersive',
  'pointerLock',
  'audioMuted',
] as const satisfies readonly (keyof SessionSettings)[];

/**
 * Sanitiser for untrusted stored JSON: keeps only the given keys that are present and
 * well-typed (normalised), drops the rest. For the app shell's settings store, so the
 * input options and `pointerMode: 'touch'` survive a round trip.
 */
export function sanitizeSessionSettingsPatch(raw: unknown): Partial<SessionSettings> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const n = normalizeSessionSettings(r as Partial<SessionSettings>);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(n) as (keyof ResolvedSessionSettings)[]) {
    if (!(key in r)) continue;
    if (r[key] === undefined) continue;
    // Present keys keep their normalised (type-checked, clamped) value.
    out[key] = n[key];
  }
  return out as Partial<SessionSettings>;
}

/** The part of the PointerModel config that comes from session settings. */
export function pointerConfigFromSettings(s: SessionSettings): Partial<PointerConfig> {
  const r = normalizeSessionSettings(s);
  return {
    mode: r.pointerMode,
    pointerSpeed: r.pointerSpeed,
    pointerAcceleration: r.pointerAcceleration,
    naturalScroll: r.naturalScroll,
    tapDrag: r.tapDrag,
    directPan: r.directOneFinger === 'drag' ? 'drag' : 'auto',
    twoFingerPan: r.twoFingerDrag === 'pan' ? 'viewport' : 'scroll',
    horizontalScroll: r.horizontalScroll,
  };
}

/** Recogniser thresholds from session settings (PTR-7). */
export function gestureConfigFromSettings(s: SessionSettings): Partial<GestureConfig> {
  const r = normalizeSessionSettings(s);
  return {
    longPressMs: r.longPressMs,
    doubleTapWindowMs: r.doubleTapWindowMs,
    tapSlopPx: r.tapSlopPx,
    // Hold that arms a tap-and-a-half drag: well inside the long press.
    tapMaxMs: Math.min(250, Math.round(r.longPressMs / 2)),
    multiTouchSlopPx: Math.max(16, Math.round(r.tapSlopPx * 1.6)),
  };
}

// Labels for fit and pointer modes live in the session string table (`sessionStrings.ts`).
