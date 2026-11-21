/**
 * Pure layout helpers for the session screen: what screen size and keyboard inset to hand
 * the Viewport, given what the DOM reports, and how big to draw the cursor overlay.
 */

import type { Size } from '../../session/viewport/Viewport.ts';

export interface LayoutInput {
  /** Current size of the session container (CSS px). */
  readonly measured: Size;
  /** Last size measured while the soft keyboard was hidden, if any. */
  readonly stable: Size | null;
  /** Whether a soft keyboard is believed to be open (native event or visual viewport). */
  readonly keyboardOpen: boolean;
  /** Keyboard height reported by the native plugin (0 when unknown / web). */
  readonly nativeKeyboardHeight: number;
  /**
   * Height of the container hidden below the visual viewport (web: visualViewport shrinks
   * while the layout viewport keeps its size).
   */
  readonly visualViewportInset: number;
}

export interface LayoutOutput {
  /** Screen size to give the Viewport. */
  readonly screen: Size;
  /** Height covered by the keyboard, measured from the bottom of `screen`. */
  readonly keyboardInset: number;
  /** Updated stable size. */
  readonly stable: Size;
}

const nn = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);

/**
 * The soft keyboard must not rescale the desktop (Viewport design). Depending on the
 * platform and the Capacitor Keyboard resize mode the keyboard either shrinks the WebView
 * (Android adjustResize, iOS `native`/`body` modes) or only overlays it (iOS `none`, mobile
 * browsers, which shrink the visual viewport only). Both are folded into the same answer:
 * while the keyboard is open and only the height shrank, keep the stable screen size and
 * report the shrink as keyboard inset. Native height and visual-viewport inset are added
 * where the container did not shrink, without double-counting.
 */
export function computeLayout(input: LayoutInput): LayoutOutput {
  const measured = { width: nn(input.measured.width), height: nn(input.measured.height) };
  const stable = input.stable;
  const shrankOnlyHeight =
    input.keyboardOpen &&
    stable !== null &&
    Math.abs(stable.width - measured.width) < 1 &&
    measured.height < stable.height;
  if (shrankOnlyHeight && stable) {
    const shrink = stable.height - measured.height;
    const native = input.keyboardOpen ? nn(input.nativeKeyboardHeight) : 0;
    const inset = Math.max(shrink, native, shrink + nn(input.visualViewportInset));
    return { screen: stable, keyboardInset: Math.min(inset, stable.height), stable };
  }
  const native = input.keyboardOpen ? nn(input.nativeKeyboardHeight) : 0;
  const inset = Math.max(native, nn(input.visualViewportInset));
  return {
    screen: measured,
    keyboardInset: Math.min(inset, measured.height),
    // Only learn the stable size while no keyboard is open (or when the width changed,
    // e.g. rotation with the keyboard up, where the old stable size is meaningless).
    stable:
      !input.keyboardOpen || stable === null || Math.abs(stable.width - measured.width) >= 1
        ? measured
        : stable,
  };
}

export interface SplitKeyboardInput {
  /** The stage's top and measured height (CSS px, viewport coordinates). */
  readonly stageTop: number;
  readonly stageHeight: number;
  /** `computeLayout` for the stage. */
  readonly stage: LayoutOutput;
  /** The session container's top and measured height: the box the keyboard shrinks. */
  readonly rootTop: number;
  readonly rootHeight: number;
  /** `computeLayout` for the container. */
  readonly root: LayoutOutput;
}

/**
 * Split layout: the stage is only the upper part of the session, so the keyboard is measured
 * against the whole container and only the part that hides the stage is the viewport's inset.
 * `keyboardCover`: how much of the container's bottom the keyboard covers (what the dock and
 * sheets sit above). `keyboardInset`: the stage's stable height minus what is still visible
 * of it (the stage may itself have shrunk, or end above the keyboard). With the stage equal
 * to the container this gives the same answer as the full-screen layout. Pure.
 */
export function splitKeyboard(i: SplitKeyboardInput): {
  keyboardCover: number;
  keyboardInset: number;
} {
  const rootShrink = i.root.screen.height - nn(i.rootHeight);
  const keyboardCover = Math.max(0, i.root.keyboardInset - rootShrink);
  const keyboardTop = i.rootTop + nn(i.rootHeight) - keyboardCover;
  const visibleBottom = Math.min(i.stageTop + nn(i.stageHeight), keyboardTop);
  const stable = i.stage.screen.height;
  const keyboardInset = Math.min(stable, Math.max(0, i.stageTop + stable - visibleBottom));
  return { keyboardCover, keyboardInset };
}

/**
 * CSS scale for the cursor overlay. The remote cursor image is in remote pixels; at
 * fit-screen on a phone the viewport scale is ~0.2-0.4, which would make it unusably
 * small, and at high zoom huge. Keep the drawn size between 0.75× and 1.5× of the image
 * in CSS px, following the viewport scale in between.
 */
export function cursorDrawScale(viewportScale: number): number {
  if (!Number.isFinite(viewportScale) || viewportScale <= 0) return 1;
  return Math.min(1.5, Math.max(0.75, viewportScale));
}

/** Visual-viewport inset: how much of the container's bottom the visual viewport hides. */
export function visualViewportInset(
  containerBottom: number,
  visualTop: number,
  visualHeight: number,
): number {
  const visibleBottom = visualTop + visualHeight;
  return nn(containerBottom - visibleBottom);
}
