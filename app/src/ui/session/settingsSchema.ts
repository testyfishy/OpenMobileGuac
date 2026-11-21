/**
 * One descriptor per `SessionSettings` field: section, control, label and hint. Both the
 * in-session "Session options" sheet and the app's Settings screen render from this table,
 * so a new field only needs a row here (a test fails when a field has none).
 *
 * Pure: no React, DOM or CSS. Labels are read from `sessionStrings` at call time, so they
 * follow the app language. Imported by path from the main chunk (Settings screen).
 */

import {
  INPUT_RANGES,
  LEGACY_SESSION_KEYS,
  REMOTE_FILES_POLICIES,
  TAP_DISMISS_MODES,
  type RemoteFilesPolicy,
  type TapDismissMode,
  type NumericInputSetting,
  type ResolvedSessionSettings,
} from './settings.ts';
import { sessionStrings } from './sessionStrings.ts';
import { gestureForKey, gestureKeys, type GestureInfo } from './gestures.ts';
import {
  AUDIO_MODES,
  QUALITIES,
  REMOTE_RESOLUTIONS,
  type AudioMode,
  type Quality,
  type RemoteResolution,
} from '../../session/viewport/remoteSize.ts';
import {
  TOOLBAR_LANDSCAPE,
  TOOLBAR_STYLES,
  resolveToolbarItems,
  type ToolbarLandscape,
  type ToolbarStyle,
} from './toolbarItems.ts';

/** Fields with a control: every field except the legacy ones (`LEGACY_SESSION_KEYS`). */
export type SettingKey = Exclude<
  keyof ResolvedSessionSettings,
  (typeof LEGACY_SESSION_KEYS)[number]
>;

export const SETTING_SECTIONS = [
  'toolbar',
  'pointer',
  'gestures',
  'keyboard',
  'display',
  'clipboard',
  'files',
  'sound',
] as const;

export type SettingSection = (typeof SETTING_SECTIONS)[number];

interface Base {
  readonly key: SettingKey;
  readonly section: SettingSection;
  readonly label: () => string;
  readonly hint?: (s: ResolvedSessionSettings) => string | undefined;
}

export interface SwitchDescriptor extends Base {
  readonly control: 'switch';
}

export interface ChoiceDescriptor extends Base {
  readonly control: 'choice';
  readonly options: readonly string[];
  readonly optionLabel: (value: string) => string;
  /** Shown as a list of large choices (with hints) instead of a segmented control. */
  readonly optionHint?: (value: string) => string;
}

export interface RangeDescriptor extends Base {
  readonly control: 'range';
  readonly key: NumericInputSetting;
  readonly format: (value: number) => string;
}

export type ListEditor = 'toolbar' | 'keySets' | 'combos';

/** What a list summary may need beyond the settings (the app's key library). */
export interface SummaryContext {
  /** Display name of a key set id. */
  readonly keySetName: (id: string) => string;
}

export const DEFAULT_SUMMARY_CONTEXT: SummaryContext = { keySetName: (id) => id };

export interface ListDescriptor extends Base {
  readonly control: 'list';
  readonly editor: ListEditor;
  /** Short read-out of the current value (`null` = built-in). */
  readonly summary: (s: ResolvedSessionSettings, ctx: SummaryContext) => string;
}

export type SettingDescriptor =
  SwitchDescriptor | ChoiceDescriptor | RangeDescriptor | ListDescriptor;

const ms = (v: number) => `${Math.round(v)} ms`;
const times = (v: number) => `${v.toFixed(2)}×`;
const S = () => sessionStrings;

const sw = (
  key: SettingKey,
  section: SettingSection,
  label: () => string,
  hint?: (s: ResolvedSessionSettings) => string | undefined,
): SwitchDescriptor => ({ key, section, control: 'switch', label, ...(hint ? { hint } : {}) });

const range = (
  key: NumericInputSetting,
  section: SettingSection,
  label: () => string,
  format: (v: number) => string,
  hint?: () => string,
): RangeDescriptor => ({
  key,
  section,
  control: 'range',
  label,
  format,
  ...(hint ? { hint } : {}),
});

export const SETTING_DESCRIPTORS: readonly SettingDescriptor[] = [
  // ---- Toolbar
  {
    key: 'toolbarStyle',
    section: 'toolbar',
    control: 'choice',
    options: TOOLBAR_STYLES,
    label: () => S().options.toolbarStyle,
    hint: () => S().options.toolbarStyleHint,
    optionLabel: (v) => S().options.toolbarStyles[v as ToolbarStyle] ?? v,
  },
  {
    key: 'toolbarLandscape',
    section: 'toolbar',
    control: 'choice',
    options: TOOLBAR_LANDSCAPE,
    label: () => S().options.toolbarLandscape,
    hint: () => S().options.toolbarLandscapeHint,
    optionLabel: (v) => S().options.toolbarLandscapeOptions[v as ToolbarLandscape] ?? v,
  },
  {
    key: 'toolbarItems',
    section: 'toolbar',
    control: 'list',
    editor: 'toolbar',
    label: () => S().options.toolbarItems,
    summary: (s) =>
      `${s.toolbarItems === null ? `${S().options.builtIn}: ` : ''}${S().options.toolbarItemsSummary(
        resolveToolbarItems(s.toolbarItems).length,
      )}`,
  },
  {
    key: 'toolbarLabels',
    section: 'toolbar',
    control: 'choice',
    options: ['auto', 'always', 'never'],
    label: () => S().options.toolbarLabels,
    hint: () => S().options.toolbarLabelsHint,
    optionLabel: (v) => S().options.toolbarLabelOptions[v as 'auto' | 'always' | 'never'] ?? v,
  },
  sw(
    'toolbarAutoHide',
    'toolbar',
    () => S().options.toolbarAutoHide,
    () => S().options.toolbarAutoHideHint,
  ),

  // ---- Pointer
  sw(
    'viewOnly',
    'pointer',
    () => S().options.viewOnly,
    () => S().options.viewOnlyHint,
  ),
  {
    key: 'pointerMode',
    section: 'pointer',
    control: 'choice',
    options: ['direct', 'trackpad', 'touch'],
    label: () => S().input.pointerModeGroup,
    optionLabel: (v) => S().pointerModes.labels[v as 'direct' | 'trackpad' | 'touch'] ?? v,
    optionHint: (v) => S().pointerModes.hints[v as 'direct' | 'trackpad' | 'touch'] ?? '',
  },
  range('pointerSpeed', 'pointer', () => S().input.pointerSpeed, times),
  range(
    'pointerAcceleration',
    'pointer',
    () => S().input.acceleration,
    (v) => (v === 0 ? S().input.off : times(v)),
  ),
  sw(
    'pointerLock',
    'pointer',
    () => S().input.pointerLock,
    () => S().input.pointerLockHint,
  ),
  sw(
    'largeCursor',
    'pointer',
    () => S().input.largeCursor,
    () => S().input.largeCursorHint,
  ),
  sw(
    'haptics',
    'pointer',
    () => S().options.haptics,
    () => S().options.hapticsHint,
  ),

  // ---- Gestures (rendered as gesture rows: see gestures.ts)
  range(
    'tapSlopPx',
    'gestures',
    () => S().input.tapTolerance,
    (v) => `${Math.round(v)} px`,
    () => S().gestures.tapToleranceHint,
  ),
  range('doubleTapWindowMs', 'gestures', () => S().gestures.doubleTapTime, ms),
  sw(
    'gestureLongPress',
    'gestures',
    () => S().gestures.items.longPress.name,
    () => S().gestures.items.longPress.desc,
  ),
  range('longPressMs', 'gestures', () => S().gestures.holdTime, ms),
  {
    key: 'directOneFinger',
    section: 'gestures',
    control: 'choice',
    options: ['pan', 'drag'],
    label: () => S().input.directOneFinger,
    hint: () => S().input.fitsAlwaysDrags,
    optionLabel: (v) => (v === 'drag' ? S().input.dragRemote : S().input.panView),
  },
  sw(
    'tapDrag',
    'gestures',
    () => S().input.tapDrag,
    (s) => (s.tapDrag ? S().input.tapDragOn : S().input.tapDragOff),
  ),
  sw(
    'gestureTwoFingerTap',
    'gestures',
    () => S().gestures.items.twoFingerTap.name,
    () => S().gestures.items.twoFingerTap.desc,
  ),
  sw(
    'gestureThreeFingerTap',
    'gestures',
    () => S().gestures.items.threeFingerTap.name,
    () => S().gestures.items.threeFingerTap.desc,
  ),
  sw(
    'gestureZoomReset',
    'gestures',
    () => S().gestures.items.zoomReset.name,
    () => S().gestures.items.zoomReset.desc,
  ),
  {
    key: 'twoFingerDrag',
    section: 'gestures',
    control: 'choice',
    options: ['scroll', 'pan'],
    label: () => S().input.twoFingerDrag,
    optionLabel: (v) => (v === 'pan' ? S().input.panView : S().input.scrollRemote),
  },
  sw(
    'naturalScroll',
    'gestures',
    () => S().input.naturalScroll,
    () => S().input.naturalScrollHint,
  ),
  sw(
    'horizontalScroll',
    'gestures',
    () => S().input.horizontalScroll,
    () => S().input.horizontalScrollHint,
  ),
  sw(
    'gesturePinchZoom',
    'gestures',
    () => S().gestures.items.pinch.name,
    () => S().gestures.items.pinch.desc,
  ),
  sw(
    'terminalPinchFont',
    'gestures',
    () => S().options.terminalPinchFont,
    () => S().options.terminalPinchFontHint,
  ),
  {
    key: 'tapDismissKeyboard',
    section: 'gestures',
    control: 'choice',
    options: TAP_DISMISS_MODES,
    label: () => S().options.tapDismissKeyboard,
    hint: () => S().options.tapDismissKeyboardHint,
    optionLabel: (v) => S().options.tapDismissModes[v as TapDismissMode] ?? v,
  },
  sw(
    'keyBarSwipeDismiss',
    'gestures',
    () => S().options.keyBarSwipeDismiss,
    () => S().options.keyBarSwipeDismissHint,
  ),
  sw(
    'keySetSwipe',
    'gestures',
    () => S().options.keySetSwipe,
    () => S().options.keySetSwipeHint,
  ),
  sw(
    'keySetLongPress',
    'gestures',
    () => S().gestures.items.holdSet.name,
    () => S().gestures.items.holdSet.desc,
  ),
  sw(
    'pasteLongPress',
    'gestures',
    () => S().gestures.items.holdPaste.name,
    () => S().gestures.items.holdPaste.desc,
  ),
  sw(
    'sheetSwipeClose',
    'gestures',
    () => S().gestures.items.sheetSwipe.name,
    () => S().gestures.items.sheetSwipe.desc,
  ),

  // ---- Keyboard
  {
    key: 'commandKey',
    section: 'keyboard',
    control: 'choice',
    options: ['super', 'ctrl'],
    label: () => S().options.commandKey,
    hint: () => S().options.commandKeyHint,
    optionLabel: (v) => S().options.commandKeyOptions[v as 'super' | 'ctrl'] ?? v,
  },
  {
    key: 'textInputMode',
    section: 'keyboard',
    control: 'choice',
    options: ['live', 'word'],
    label: () => S().input.softKeyboardText,
    hint: () => S().input.keyboardTip,
    optionLabel: (v) => (v === 'word' ? S().input.commitOnWord : S().input.live),
  },
  sw(
    'textInputBar',
    'keyboard',
    () => S().input.textInputBar,
    () => S().input.textInputBarHint,
  ),
  {
    key: 'keySet',
    section: 'keyboard',
    control: 'list',
    editor: 'keySets',
    label: () => S().options.keySet,
    hint: () => S().options.keySetHint,
    summary: (s, ctx) => ctx.keySetName(s.keySet),
  },

  // ---- Display
  {
    key: 'quality',
    section: 'display',
    control: 'choice',
    options: QUALITIES,
    label: () => S().options.quality,
    hint: () => S().options.qualityHint,
    optionLabel: (v) => S().options.qualityOptions[v as Quality] ?? v,
  },
  {
    key: 'remoteResolution',
    section: 'display',
    control: 'choice',
    options: REMOTE_RESOLUTIONS,
    label: () => S().options.remoteResolution,
    hint: () => S().options.remoteResolutionHint,
    optionLabel: (v) => S().options.remoteResolutionOptions[v as RemoteResolution] ?? v,
  },
  range(
    'remoteWidth',
    'display',
    () => S().options.remoteWidth,
    (v) => S().options.px(Math.round(v)),
    () => S().options.remoteSizeHint,
  ),
  range(
    'remoteHeight',
    'display',
    () => S().options.remoteHeight,
    (v) => S().options.px(Math.round(v)),
    () => S().options.remoteSizeHint,
  ),
  range(
    'remoteScale',
    'display',
    () => S().options.remoteScale,
    (v) => S().options.percent(Math.round(v)),
    () => S().options.remoteScaleHint,
  ),
  {
    key: 'fitMode',
    section: 'display',
    control: 'choice',
    options: ['fit-screen', 'fit-width', 'fit-height', 'one-to-one', 'css-pixels'],
    label: () => S().options.fitMode,
    optionLabel: (v) =>
      S().fitModes.labels[v as keyof ReturnType<typeof S>['fitModes']['labels']] ?? v,
  },
  sw(
    'matchDeviceSize',
    'display',
    () => S().options.matchDeviceSize,
    () => S().view.matchHint,
  ),
  {
    key: 'splitLayout',
    section: 'display',
    control: 'choice',
    options: ['auto', 'on', 'off'],
    label: () => S().input.splitLayout,
    optionLabel: (v) =>
      v === 'on' ? S().input.on : v === 'off' ? S().input.off : S().input.whenFolded,
  },
  sw(
    'immersive',
    'display',
    () => S().input.immersive,
    () => S().input.immersiveHint,
  ),
  sw(
    'keepAwake',
    'display',
    () => S().options.keepAwake,
    () => S().options.keepAwakeHint,
  ),

  // ---- Clipboard
  sw(
    'clipboardRemoteToDevice',
    'clipboard',
    () => S().options.clipboardRemoteToDevice,
    () => S().options.clipboardRemoteToDeviceHint,
  ),
  sw(
    'clipboardSendOnConnect',
    'clipboard',
    () => S().options.clipboardSendOnConnect,
    () => S().options.clipboardSendOnConnectHint,
  ),
  sw(
    'clipboardAutoSendOnFocus',
    'clipboard',
    () => S().options.clipboardAutoSendOnFocus,
    () => S().options.clipboardAutoSendOnFocusHint,
  ),

  // ---- Files
  {
    key: 'remoteFiles',
    section: 'files',
    control: 'choice',
    options: REMOTE_FILES_POLICIES,
    label: () => S().options.remoteFiles,
    hint: () => S().options.remoteFilesHint,
    optionLabel: (v) => S().options.remoteFilesOptions[v as RemoteFilesPolicy] ?? v,
  },

  // ---- Sound
  {
    key: 'audio',
    section: 'sound',
    control: 'choice',
    options: AUDIO_MODES,
    label: () => S().options.audio,
    hint: () => S().options.audioHint,
    optionLabel: (v) => S().options.audioOptions[v as AudioMode] ?? v,
  },
];

export function descriptorsIn(section: SettingSection): SettingDescriptor[] {
  return SETTING_DESCRIPTORS.filter((d) => d.section === section);
}

/** Range bounds for a range descriptor: [min, max, step]. */
export function rangeOf(d: RangeDescriptor): readonly [number, number, number] {
  return INPUT_RANGES[d.key];
}

/** Case- and accent-insensitive match on label, hint and section title. */
export function matchesQuery(
  d: SettingDescriptor,
  query: string,
  s: ResolvedSessionSettings,
): boolean {
  const q = fold(query.trim());
  if (q === '') return true;
  const g = gestureForKey(d.key);
  const hay = [
    ...(g ? gestureText(g) : []),
    d.label(),
    d.hint?.(s) ?? '',
    sessionStrings.options.sections[d.section],
    ...(d.control === 'choice' ? d.options.map((o) => d.optionLabel(o)) : []),
  ]
    .map(fold)
    .join(' ');
  return q.split(/\s+/).every((w) => hay.includes(w));
}

function gestureText(g: GestureInfo): string[] {
  const t = sessionStrings.gestures;
  return [t.items[g.id].name, t.items[g.id].desc];
}

/** A gesture row matches when its own text or any of its settings matches. */
export function matchesGesture(g: GestureInfo, query: string, s: ResolvedSessionSettings): boolean {
  const q = fold(query.trim());
  if (q === '') return true;
  const hay = [...gestureText(g), sessionStrings.options.sections.gestures].map(fold).join(' ');
  if (q.split(/\s+/).every((w) => hay.includes(w))) return true;
  return gestureKeys(g).some((k) => {
    const d = SETTING_DESCRIPTORS.find((x) => x.key === k);
    return d !== undefined && matchesQuery(d, query, s);
  });
}

/** The descriptor of a setting key (every key has one). */
export function descriptorOf(key: SettingKey): SettingDescriptor | undefined {
  return SETTING_DESCRIPTORS.find((d) => d.key === key);
}

function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Patch that sets one setting (typed loosely: the descriptor guarantees the type). */
export function settingPatch(key: SettingKey, value: unknown): Partial<ResolvedSessionSettings> {
  return { [key]: value } as Partial<ResolvedSessionSettings>;
}
