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
