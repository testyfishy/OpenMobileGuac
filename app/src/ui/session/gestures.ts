/**
 * Every touch gesture the session screen recognises, in the order the Settings › Gestures
 * area lists them. Each row names the animation to show, the setting that switches it on or
 * off (`toggle`), further settings that tune it (`settings`) and whether it is always on.
 *
 * A setting key belongs to at most one row (a test checks this, and that every descriptor in
 * the `gestures` section is owned by a row), so no control is shown twice. Names, one-line
 * descriptions and "always on" reasons are in `sessionStrings.gestures`.
 *
 * Pure: no React, DOM or CSS. Derived from the code, not from the spec: GestureRecognizer
 * (taps, holds, drags, pinch), PointerModel (what each does in direct touch and trackpad
 * mode), SessionController (tap to hide the keyboard, terminal pinch), KeyBar (swipes and
 * the set button), Toolbar (hold Paste) and Sheet (swipe a panel down). In touch
 * pass-through mode the desktop gestures are not recognised at all: touches go to the
 * remote as they are (TouchPassthrough).
 */

import type { SettingKey } from './settingsSchema.ts';
import type { SessionStrings } from './sessionStrings.ts';

export type GestureId = keyof SessionStrings['gestures']['items'];

/** The looping animation drawn for a gesture (`GestureFigure.tsx`). */
export type GestureFigureKind =
  | 'tap'
  | 'double-tap'
  | 'long-press'
  | 'drag'
  | 'tap-drag'
  | 'two-finger-tap'
  | 'three-finger-tap'
  | 'three-finger-double-tap'
  | 'two-finger-drag'
  | 'pinch'
  | 'tap-keyboard'
  | 'keybar-swipe-down'
  | 'keybar-swipe-side'
  | 'hold-button'
  | 'sheet-swipe-down';

/** Where the gesture is made: on the remote desktop or on the session chrome. */
export type GestureArea = 'desktop' | 'chrome';

export interface GestureInfo {
  readonly id: GestureId;
  readonly area: GestureArea;
  readonly figure: GestureFigureKind;
  /** Boolean setting that switches the gesture on or off. */
  readonly toggle?: SettingKey;
  /** Further settings shown with the gesture (choices, times, related switches). */
  readonly settings: readonly SettingKey[];
  /**
   * No off switch: turning it off would leave the app without a basic action (a click, a
   * double click, moving the pointer or the view, scrolling). The reason is
   * `sessionStrings.gestures.why[id]`.
   */
  readonly alwaysOn: boolean;
}

export const GESTURE_AREAS: readonly GestureArea[] = ['desktop', 'chrome'];

export const GESTURES: readonly GestureInfo[] = [
  // ---- On the remote desktop (direct touch and trackpad)
  { id: 'tap', area: 'desktop', figure: 'tap', settings: ['tapSlopPx'], alwaysOn: true },
  {
    id: 'doubleTap',
    area: 'desktop',
    figure: 'double-tap',
    settings: ['doubleTapWindowMs'],
    alwaysOn: true,
  },
  {
    id: 'longPress',
    area: 'desktop',
    figure: 'long-press',
    toggle: 'gestureLongPress',
    settings: ['longPressMs'],
    alwaysOn: false,
  },
  { id: 'drag', area: 'desktop', figure: 'drag', settings: ['directOneFinger'], alwaysOn: true },
  {
    id: 'tapDrag',
    area: 'desktop',
    figure: 'tap-drag',
    toggle: 'tapDrag',
    settings: [],
    alwaysOn: false,
  },
  {
    id: 'twoFingerTap',
    area: 'desktop',
    figure: 'two-finger-tap',
    toggle: 'gestureTwoFingerTap',
    settings: [],
    alwaysOn: false,
  },
  {
    id: 'threeFingerTap',
    area: 'desktop',
    figure: 'three-finger-tap',
    toggle: 'gestureThreeFingerTap',
    settings: [],
    alwaysOn: false,
  },
  {
    id: 'zoomReset',
    area: 'desktop',
    figure: 'three-finger-double-tap',
    toggle: 'gestureZoomReset',
    settings: [],
    alwaysOn: false,
  },
  {
    id: 'twoFingerDrag',
    area: 'desktop',
    figure: 'two-finger-drag',
    settings: ['twoFingerDrag', 'naturalScroll', 'horizontalScroll'],
    alwaysOn: true,
  },
  {
    id: 'pinch',
    area: 'desktop',
    figure: 'pinch',
    toggle: 'gesturePinchZoom',
    settings: ['terminalPinchFont'],
    alwaysOn: false,
  },
  {
    id: 'tapKeyboard',
    area: 'desktop',
    figure: 'tap-keyboard',
    settings: ['tapDismissKeyboard'],
    alwaysOn: false,
  },

  // ---- On the key bar, toolbar and panels
  {
    id: 'keyBarDown',
    area: 'chrome',
    figure: 'keybar-swipe-down',
    toggle: 'keyBarSwipeDismiss',
    settings: [],
    alwaysOn: false,
  },
  {
    id: 'keyBarSide',
    area: 'chrome',
    figure: 'keybar-swipe-side',
    toggle: 'keySetSwipe',
    settings: [],
    alwaysOn: false,
  },
  {
    id: 'holdSet',
    area: 'chrome',
    figure: 'hold-button',
    toggle: 'keySetLongPress',
    settings: [],
    alwaysOn: false,
  },
  {
    id: 'holdPaste',
    area: 'chrome',
    figure: 'hold-button',
    toggle: 'pasteLongPress',
    settings: [],
    alwaysOn: false,
  },
  {
    id: 'sheetSwipe',
    area: 'chrome',
    figure: 'sheet-swipe-down',
    toggle: 'sheetSwipeClose',
    settings: [],
    alwaysOn: false,
  },
];

/** Every setting a gesture row shows, toggle first. */
export function gestureKeys(g: GestureInfo): SettingKey[] {
  return g.toggle ? [g.toggle, ...g.settings] : [...g.settings];
}

/** The gesture row that shows a setting, if any. */
export function gestureForKey(key: SettingKey): GestureInfo | undefined {
  return GESTURES.find((g) => g.toggle === key || g.settings.includes(key));
}
