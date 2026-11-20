/**
 * "Tap the desktop to hide the keyboard" (three-way setting). Pure.
 *
 * - `off`: a tap only clicks.
 * - `hide-click`: the tap hides the keyboard and still clicks (decided when the tap is
 *   recognised, so a drag or pinch never hides it).
 * - `hide-only`: the touch that lands while the keyboard is up only hides the keyboard;
 *   that pointer is swallowed until it lifts, so nothing is clicked or dragged.
 */

import type { TapDismissMode } from './settings.ts';

export type TapDismissDecision = 'pass' | 'hide-and-pass' | 'hide-and-swallow';

/** At pointer down (touch or pen) on the remote. */
export function onTouchDown(mode: TapDismissMode, keyboardUp: boolean): TapDismissDecision {
  return mode === 'hide-only' && keyboardUp ? 'hide-and-swallow' : 'pass';
}

/** When a one-finger tap (or the start of a pending tap) is recognised. */
export function onTapRecognised(mode: TapDismissMode, keyboardUp: boolean): TapDismissDecision {
  return mode === 'hide-click' && keyboardUp ? 'hide-and-pass' : 'pass';
}
