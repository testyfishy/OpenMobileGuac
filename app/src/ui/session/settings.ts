/**
 * Per-connection session settings (the contract the app shell persists) and their mapping
 * onto the pure session models.
 *
 * Fields added after the first release are optional so that stored settings (and code that
 * builds a `SessionSettings` literal) keep working; `normalizeSessionSettings` fills them
 * from `DEFAULT_SESSION_SETTINGS` and clamps them to safe ranges.
 */

import type { GestureConfig } from '../../session/gesture/GestureRecognizer.ts';
import { ALIGN_X, type AlignX, type FitMode } from '../../session/viewport/Viewport.ts';
import {
  AUDIO_MODES,
  QUALITIES,
  REMOTE_RESOLUTIONS,
  type AudioMode,
  type Quality,
  type RemoteResolution,
} from '../../session/viewport/remoteSize.ts';
import type { PointerConfig, PointerMode } from '../../session/pointer/PointerModel.ts';
import { GENERAL_SET_ID, isKeySetId } from '../../session/keys/KeySets.ts';
import type { CommandKeyMode } from '../../session/keys/HardwareKeyboard.ts';
import { normalizeKeyBarLayout } from './keyBarLayout.ts';
import {
  KEY_BAR_LANDSCAPE,
  TOOLBAR_LANDSCAPE,
  TOOLBAR_STYLES,
  normalizeToolbarItems,
  type KeyBarLandscape,
  type ToolbarLandscape,
  type ToolbarStyle,
} from './toolbarItems.ts';

export interface SessionSettings {
  fitMode: FitMode;
  /** Where a desktop narrower than the free width sits (1:1 pixels, a tall remote). */
  displayAlign: AlignX;
  pointerMode: PointerMode;
  /**
   * DSP-4: follow the view: send the new size when the area the desktop is drawn in changes
   * (rotation, docked toolbar, split layout), as the Guacamole web client always does. On by
   * default since 2026-11; a value stored per connection (or a changed app default) is kept.
   * Never applies to a fixed or custom Remote resolution, and never while the soft keyboard is
   * up (the keyboard only covers the desktop; see `SessionController.scheduleMatchSize`).
   */
  matchDeviceSize: boolean;
  /** 0.25..4, 1 = default. */
  pointerSpeed: number;
  naturalScroll: boolean;
  haptics: boolean;
  clipboardRemoteToDevice: boolean;
  clipboardAutoSendOnFocus: boolean;
  keepAwake: boolean;
  /**
   * Legacy (before the key library): e.g. "Ctrl+Shift+Esc". Still read and offered in the
   * combo menu; new combos are saved in the app's key library (`AppSettings.keys`).
   */
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
  /** Let the keyboard app correct words and turn a double space into a full stop. */
  keyboardAutocorrect?: boolean;
  /** Let the keyboard app capitalise the start of sentences. */
  keyboardCapitals?: boolean;
  /** Show the visible "Text input" bar (type / dictate / paste, then Send). */
  textInputBar?: boolean;
  /**
   * Legacy (before key sets): this connection's own key bar rows; null = none. Shown as the
   * "Custom layout" set until the user picks another set.
   */
  keyBarLayout?: string[][] | null;
  /** KEY-9: the extra key bar's key set (id from the key library). */
  keySet?: string;
  /** KEY-9: a sideways swipe on the key bar switches to the next / previous set. */
  keySetSwipe?: boolean;
  /** FIL-1: files (and print jobs) the remote pushes: ask, always accept or always decline. */
  remoteFiles?: RemoteFilesPolicy;
  /**
   * FIL-1: where accepted files go. `downloads`: streamed into the app's Downloads folder
   * (visible in the Files app) and kept; `share`: the share sheet, no copy kept.
   */
  receivedFiles?: ReceivedFilesMode;
  /** AUD-2: send the device microphone (RDP `enable-audio-input`). Off by default. */
  microphone?: boolean;
  /** Larger, high-contrast cursor overlay. */
  largeCursor?: boolean;
  /** Split layout: display above a trackpad + key bar. `auto` = on a folded (tabletop) device. */
  splitLayout?: 'auto' | 'on' | 'off';
  /** Hide system bars (native) / full screen (web). */
  immersive?: boolean;
  /** Hardware mouse in trackpad mode: capture the pointer for relative motion. */
  pointerLock?: boolean;
  /** AUD-1 (legacy): remote audio muted. Now derived from `audio === 'muted'`. */
  audioMuted?: boolean;
  /**
   * AUD-1: `on`; `muted` (received, not played: local mute); `off` (no audio types are
   * advertised at connect, so guacd sends no audio at all and saves the bandwidth).
   */
  audio?: AudioMode;
  /** CLP-1: send the device clipboard once when the session connects (iOS may prompt). */
  clipboardSendOnConnect?: boolean;
  /**
   * The Send action (toolbar, More) also presses the remote's paste shortcut once the
   * clipboard is there (Ctrl+V; Ctrl+Shift+V in a terminal). Off: send only.
   */
  sendPastes?: boolean;
  /**
   * Experimental (iOS): show the remote display in the system's Picture in Picture window
   * when leaving the app with a session open.
   */
  pictureInPicture?: boolean;
  /** Quality (AUDIT §4.4): what size, DPI and media to request at connect. */
  quality?: Quality;
  /** Remote desktop size to request; `auto` follows the quality. */
  remoteResolution?: RemoteResolution;
  /** `custom` remote size in pixels. */
  remoteWidth?: number;
  remoteHeight?: number;
  /** 100..300 %: request a proportionally smaller desktop so it is drawn larger. */
  remoteScale?: number;
  /** View only: no mouse, keyboard, touch or clipboard reaches the remote. */
  viewOnly?: boolean;
  /** Terminal protocols (SSH, telnet, Kubernetes): pinch changes the font size. */
  terminalPinchFont?: boolean;
  /** Hardware keyboard ⌘ / Meta: send Super (Win) as upstream, or Control (⌘C = Ctrl+C). */
  commandKey?: CommandKeyMode;

  // ---- Toolbar and keyboard dismissal (optional for compatibility)
  /**
   * Floating (collapsible, over the desktop) or a static row docked to an edge that the
   * desktop is laid out around. Side docks apply in landscape; portrait uses the bottom.
   */
  toolbarStyle?: ToolbarStyle;
  /**
   * Landscape: move a toolbar docked at the top or bottom to a side, where a wide and
   * short screen has room to spare. `same` keeps it where `toolbarStyle` puts it.
   */
  toolbarLandscape?: ToolbarLandscape;
  /** Actions in the toolbar row, in order (ids from toolbarItems.ts); null = built-in row. */
  toolbarItems?: string[] | null;
  /** Labels under the icons: `auto` hides them on short (landscape) screens. */
  toolbarLabels?: 'auto' | 'always' | 'never';
  /** Floating toolbar: collapse to a handle after a few seconds without use. */
  toolbarAutoHide?: boolean;
  /**
   * A tap on the remote while the soft keyboard is up: `off` (only a click), `hide-click`
   * (hides the keyboard and clicks) or `hide-only` (hides the keyboard, no click). Stored
   * booleans from older versions map to `hide-click` / `off`.
   */
  tapDismissKeyboard?: TapDismissMode;
  /** Swiping down on the extra key bar hides the keyboard (or the key bar). */
  keyBarSwipeDismiss?: boolean;
  /** A "hide extra keys" button at the right end of the key bar (the toolbar hides it too). */
  keyBarCollapseButton?: boolean;
  /**
   * Phones in landscape: the extra key bar as a row at the bottom (pushing the view up) or a
   * column at a side, in the width a wide screen has spare (`side`: the side the toolbar does
   * not use). Portrait, tablets and the split layout always use the row.
   */
  keyBarLandscape?: KeyBarLandscape;

  // ---- Gesture switches (Settings › Gestures; optional for compatibility, all on by default)
  /** Touch and hold: right click (direct) or drag (trackpad). Off: a hold is a tap. */
  gestureLongPress?: boolean;
  /** Two-finger tap = right click. */
  gestureTwoFingerTap?: boolean;
  /** Three-finger tap = middle click. */
  gestureThreeFingerTap?: boolean;
  /** Three-finger double tap = reset the zoom. */
  gestureZoomReset?: boolean;
  /** Pinch zooms the view (the terminal font option is separate). */
  gesturePinchZoom?: boolean;
  /** A downward swipe on a session panel's header closes it. */
  sheetSwipeClose?: boolean;
  /** Holding the key bar's set button opens the list of sets. */
  keySetLongPress?: boolean;
  /** Holding the toolbar's Paste button types the clipboard as keystrokes. */
  pasteLongPress?: boolean;
}

export type TapDismissMode = 'off' | 'hide-click' | 'hide-only';
export const TAP_DISMISS_MODES: readonly TapDismissMode[] = ['off', 'hide-click', 'hide-only'];
export type RemoteFilesPolicy = 'ask' | 'accept' | 'decline';
export const REMOTE_FILES_POLICIES: readonly RemoteFilesPolicy[] = ['ask', 'accept', 'decline'];
export type ReceivedFilesMode = 'downloads' | 'share';
export const RECEIVED_FILES_MODES: readonly ReceivedFilesMode[] = ['downloads', 'share'];

/**
 * Fields still read (for migration and old stored values) but no longer edited as session
 * settings: key sets and the key library replace them. The descriptor table skips them.
 */
export const LEGACY_SESSION_KEYS = ['keyBarLayout', 'customCombos', 'audioMuted'] as const;

/** Settings with every optional field resolved. */
export type ResolvedSessionSettings = Required<SessionSettings>;

export const DEFAULT_SESSION_SETTINGS: ResolvedSessionSettings = {
  fitMode: 'fit-screen',
  displayAlign: 'center',
  pointerMode: 'direct',
  matchDeviceSize: true,
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
  keyboardAutocorrect: false,
  keyboardCapitals: false,
  textInputBar: false,
  keyBarLayout: null,
  largeCursor: false,
  splitLayout: 'auto',
  immersive: false,
  pointerLock: false,
  audioMuted: false,
  audio: 'on',
  clipboardSendOnConnect: false,
  sendPastes: true,
  pictureInPicture: false,
  quality: 'auto',
  remoteResolution: 'auto',
  remoteWidth: 1280,
  remoteHeight: 720,
  remoteScale: 100,
  viewOnly: false,
  terminalPinchFont: false,
  commandKey: 'super',
  toolbarStyle: 'dock-bottom',
  toolbarLandscape: 'away',
  toolbarItems: null,
  toolbarLabels: 'auto',
  toolbarAutoHide: true,
  tapDismissKeyboard: 'off',
  keyBarSwipeDismiss: true,
  keyBarCollapseButton: false,
  keyBarLandscape: 'side',
  gestureLongPress: true,
  gestureTwoFingerTap: true,
  gestureThreeFingerTap: true,
  gestureZoomReset: true,
  gesturePinchZoom: true,
  sheetSwipeClose: true,
  keySetLongPress: true,
  pasteLongPress: true,
  keySet: GENERAL_SET_ID,
  keySetSwipe: false,
  remoteFiles: 'ask',
  receivedFiles: 'downloads',
  microphone: false,
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
  remoteWidth: [320, 7680, 2],
  remoteHeight: [240, 4320, 2],
  remoteScale: [100, 300, 25],
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

/** `audio`, or the legacy `audioMuted` flag; `audioMuted` is kept in step for old readers. */
function audioFields(raw: Record<string, unknown>): { audio: AudioMode; audioMuted: boolean } {
  const audio: AudioMode = (AUDIO_MODES as readonly unknown[]).includes(raw['audio'])
    ? (raw['audio'] as AudioMode)
    : raw['audioMuted'] === true
      ? 'muted'
      : 'on';
  return { audio, audioMuted: audio === 'muted' };
}

/** Three-way tap-to-hide; booleans from older versions: true → hide and click. */
function tapDismiss(value: unknown): TapDismissMode {
  if (value === true) return 'hide-click';
  if (value === false) return 'off';
  return oneOf(value, TAP_DISMISS_MODES, DEFAULT_SESSION_SETTINGS.tapDismissKeyboard);
}

const FIT_MODES_LIST: readonly FitMode[] = [
  'fit-screen',
  'fit-width',
  'fit-height',
  'one-to-one',
  'css-pixels',
];
const POINTER_MODES_LIST: readonly PointerMode[] = ['direct', 'trackpad', 'touch'];

/** Fill gaps and repair out-of-range values in settings coming from storage. */
export function normalizeSessionSettings(
  input: Partial<SessionSettings> | null | undefined,
): ResolvedSessionSettings {
  const raw: Record<string, unknown> = { ...(input ?? {}) };
  const d = DEFAULT_SESSION_SETTINGS;
  return {
    fitMode: oneOf(raw['fitMode'], FIT_MODES_LIST, d.fitMode),
    displayAlign: oneOf(raw['displayAlign'], ALIGN_X, d.displayAlign),
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
    keyboardAutocorrect: bool(raw['keyboardAutocorrect'], d.keyboardAutocorrect),
    keyboardCapitals: bool(raw['keyboardCapitals'], d.keyboardCapitals),
    textInputBar: bool(raw['textInputBar'], d.textInputBar),
    keyBarLayout: normalizeKeyBarLayout(raw['keyBarLayout']),
    largeCursor: bool(raw['largeCursor'], d.largeCursor),
    splitLayout: oneOf(raw['splitLayout'], ['auto', 'on', 'off'] as const, d.splitLayout),
    immersive: bool(raw['immersive'], d.immersive),
    pointerLock: bool(raw['pointerLock'], d.pointerLock),
    ...audioFields(raw),
    clipboardSendOnConnect: bool(raw['clipboardSendOnConnect'], d.clipboardSendOnConnect),
    sendPastes: bool(raw['sendPastes'], d.sendPastes),
    pictureInPicture: bool(raw['pictureInPicture'], d.pictureInPicture),
    quality: oneOf(raw['quality'], QUALITIES, d.quality),
    remoteResolution: oneOf(raw['remoteResolution'], REMOTE_RESOLUTIONS, d.remoteResolution),
    remoteWidth: Math.round(clampTo(raw['remoteWidth'], 'remoteWidth')),
    remoteHeight: Math.round(clampTo(raw['remoteHeight'], 'remoteHeight')),
    remoteScale: clampTo(raw['remoteScale'], 'remoteScale'),
    viewOnly: bool(raw['viewOnly'], d.viewOnly),
    terminalPinchFont: bool(raw['terminalPinchFont'], d.terminalPinchFont),
    commandKey: oneOf(raw['commandKey'], ['super', 'ctrl'] as const, d.commandKey),
    toolbarStyle: oneOf(raw['toolbarStyle'], TOOLBAR_STYLES, d.toolbarStyle),
    toolbarLandscape: oneOf(raw['toolbarLandscape'], TOOLBAR_LANDSCAPE, d.toolbarLandscape),
    toolbarItems: normalizeToolbarItems(raw['toolbarItems']),
    toolbarLabels: oneOf(
      raw['toolbarLabels'],
      ['auto', 'always', 'never'] as const,
      d.toolbarLabels,
    ),
    toolbarAutoHide: bool(raw['toolbarAutoHide'], d.toolbarAutoHide),
    tapDismissKeyboard: tapDismiss(raw['tapDismissKeyboard']),
    keyBarSwipeDismiss: bool(raw['keyBarSwipeDismiss'], d.keyBarSwipeDismiss),
    keyBarCollapseButton: bool(raw['keyBarCollapseButton'], d.keyBarCollapseButton),
    keyBarLandscape: oneOf(raw['keyBarLandscape'], KEY_BAR_LANDSCAPE, d.keyBarLandscape),
    gestureLongPress: bool(raw['gestureLongPress'], d.gestureLongPress),
    gestureTwoFingerTap: bool(raw['gestureTwoFingerTap'], d.gestureTwoFingerTap),
    gestureThreeFingerTap: bool(raw['gestureThreeFingerTap'], d.gestureThreeFingerTap),
    gestureZoomReset: bool(raw['gestureZoomReset'], d.gestureZoomReset),
    gesturePinchZoom: bool(raw['gesturePinchZoom'], d.gesturePinchZoom),
    sheetSwipeClose: bool(raw['sheetSwipeClose'], d.sheetSwipeClose),
    keySetLongPress: bool(raw['keySetLongPress'], d.keySetLongPress),
    pasteLongPress: bool(raw['pasteLongPress'], d.pasteLongPress),
    keySet: isKeySetId(raw['keySet']) ? raw['keySet'] : d.keySet,
    keySetSwipe: bool(raw['keySetSwipe'], d.keySetSwipe),
    remoteFiles: oneOf(raw['remoteFiles'], REMOTE_FILES_POLICIES, d.remoteFiles),
    receivedFiles: oneOf(raw['receivedFiles'], RECEIVED_FILES_MODES, d.receivedFiles),
    microphone: bool(raw['microphone'], d.microphone),
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
  'keyboardAutocorrect',
  'keyboardCapitals',
  'textInputBar',
  'keyBarLayout',
  'largeCursor',
  'splitLayout',
  'immersive',
  'pointerLock',
  'audioMuted',
  'audio',
  'clipboardSendOnConnect',
  'sendPastes',
  'pictureInPicture',
  'quality',
  'remoteResolution',
  'remoteWidth',
  'remoteHeight',
  'remoteScale',
  'viewOnly',
  'terminalPinchFont',
  'commandKey',
  'toolbarStyle',
  'toolbarLandscape',
  'displayAlign',
  'toolbarItems',
  'toolbarLabels',
  'toolbarAutoHide',
  'tapDismissKeyboard',
  'keyBarSwipeDismiss',
  'keyBarCollapseButton',
  'keyBarLandscape',
  'gestureLongPress',
  'gestureTwoFingerTap',
  'gestureThreeFingerTap',
  'gestureZoomReset',
  'gesturePinchZoom',
  'sheetSwipeClose',
  'keySetLongPress',
  'pasteLongPress',
  'keySet',
  'keySetSwipe',
  'remoteFiles',
  'receivedFiles',
  'microphone',
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
  // A stored legacy mute becomes the new three-way `audio` choice.
  if ('audioMuted' in r && !('audio' in r) && typeof r['audioMuted'] === 'boolean') {
    out['audio'] = r['audioMuted'] ? 'muted' : 'on';
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
    pinchZoom: r.gesturePinchZoom,
    twoFingerTap: r.gestureTwoFingerTap,
    threeFingerTap: r.gestureThreeFingerTap,
    threeFingerDoubleTap: r.gestureZoomReset,
  };
}

/** Recogniser thresholds from session settings (PTR-7). */
export function gestureConfigFromSettings(s: SessionSettings): Partial<GestureConfig> {
  const r = normalizeSessionSettings(s);
  return {
    longPressMs: r.longPressMs,
    longPress: r.gestureLongPress,
    doubleTapWindowMs: r.doubleTapWindowMs,
    tapSlopPx: r.tapSlopPx,
    // Hold that arms a tap-and-a-half drag: well inside the long press.
    tapMaxMs: Math.min(250, Math.round(r.longPressMs / 2)),
    multiTouchSlopPx: Math.max(16, Math.round(r.tapSlopPx * 1.6)),
  };
}

// Labels for fit and pointer modes live in the session string table (`sessionStrings.ts`).
