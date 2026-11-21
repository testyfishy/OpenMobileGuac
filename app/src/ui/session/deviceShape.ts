/**
 * Pure helpers that classify the window the session is shown in, so the layout follows the
 * screen the app is on right now (a foldable's cover screen or inner screen, Split View, a
 * rotation) instead of the device it started on. No DOM access: callers pass what they read.
 *
 * Why the window and not `screen.*`: on a foldable the app moves between two displays without
 * restarting, and on iPhone Duo `UIScreen.main` is documented as ambiguous (Apple: use the
 * window scene). `screen.width` in a WebView may keep reporting one display while the app is
 * on the other, so it is not used for layout decisions.
 */

import type { Size } from '../../session/viewport/Viewport.ts';
import { cutoutSide, type CutoutSide } from './toolbarItems.ts';

/**
 * A window whose short side is at most this (CSS px) gets the phone layout (side toolbar and
 * key column in landscape). Phones are 320-440; foldable cover screens about 340-470; small
 * tablets and foldable inner screens 600 and up (iPhone Duo inner about 669, iPad mini 744).
 */
export const COMPACT_SHORT_SIDE = 540;

export interface WindowShape {
  /** Wider than tall. */
  readonly landscape: boolean;
  /** Phone-sized short side (see COMPACT_SHORT_SIDE). */
  readonly compact: boolean;
  /** The window width the shape was taken at (CSS px). */
  readonly width: number;
}

const ok = (v: number) => Number.isFinite(v) && v > 0;

export function shapeOf(size: Size): WindowShape {
  const w = ok(size.width) ? size.width : 0;
  const h = ok(size.height) ? size.height : 0;
  return {
    landscape: w > h,
    compact: w === 0 || h === 0 ? true : Math.min(w, h) <= COMPACT_SHORT_SIDE,
    width: w,
  };
}

export interface ClassifyInput {
  /** The window size now (innerWidth × innerHeight). */
  readonly size: Size;
  /** Shape from the previous reading, if any. */
  readonly prev: WindowShape | null;
  /** A soft keyboard is up (it may have shrunk the window's height). */
  readonly keyboardUp: boolean;
  /** The last size seen at this width while no keyboard was up, if any. */
  readonly remembered?: Size | undefined;
  /** `screen.orientation.type` mapped to landscape / portrait, if the WebView reports it. */
  readonly orientation?: 'landscape' | 'portrait' | undefined;
  /**
   * Short side of `screen` (CSS px), the last resort for a landscape window first seen with
   * the keyboard up. It may describe the other display on a two-screen foldable.
   */
  readonly screenShortSide?: number | undefined;
}

/**
 * The window's shape, robust to a soft keyboard that shrinks the WebView (Android
 * adjustResize, iOS Capacitor `native` resize): a keyboard only ever changes the height, so
 * a height-only change while it is up keeps the previous shape. A width change while it is
 * up is a rotation, a fold or unfold, or Split View, and applies at once: from the size last
 * seen at that width without the keyboard if known. Otherwise the height is not trusted:
 * landscape comes from the device orientation (else the current size), a portrait window's
 * short side is its width (which the keyboard does not change), and a landscape window's
 * short side falls back to the screen's.
 */
export function classifyWindow(input: ClassifyInput): WindowShape {
  const { size, prev, keyboardUp } = input;
  if (!keyboardUp || prev === null) return shapeOf(size);
  if (Math.abs(size.width - prev.width) < 1) return prev;
  if (input.remembered) return { ...shapeOf(input.remembered), width: size.width };
  const landscape =
    input.orientation !== undefined ? input.orientation === 'landscape' : shapeOf(size).landscape;
  const fallback = input.screenShortSide;
  const short = !landscape
    ? size.width
    : fallback !== undefined && ok(fallback)
      ? fallback
      : size.height;
  return {
    landscape,
    compact: !ok(short) || short <= COMPACT_SHORT_SIDE,
    width: size.width,
  };
}

export interface WindowReading {
  /** The window size now (innerWidth × innerHeight). */
  readonly size: Size;
  readonly prev: WindowShape | null;
  /** The session's hidden field has focus (its soft keyboard). */
  readonly fieldKeyboard: boolean;
  /**
   * The native layer reports a soft keyboard open, whichever field raised it (text input bar,
   * sign-in prompt, a name in a sheet).
   */
  readonly nativeKeyboard: boolean;
  /** Sizes seen per (rounded) width while no keyboard was up. */
  readonly seen: ReadonlyMap<number, Size>;
  readonly orientation?: 'landscape' | 'portrait' | undefined;
  readonly screenShortSide?: number | undefined;
}

/**
 * One reading of the window for the session screen: the shape, and whether this size may be
 * remembered as a keyboard-closed size for its width. Any soft keyboard counts, not only the
 * hidden field's: on a near-square cover screen (iPhone Duo outside, about 466×678) a
 * keyboard raised by another field would otherwise read as landscape. Pure.
 */
export function readWindowShape(r: WindowReading): { shape: WindowShape; remember: boolean } {
  const keyboardUp = r.fieldKeyboard || r.nativeKeyboard;
  const key = Math.round(r.size.width);
  const remember = !keyboardUp && r.size.width > 0 && r.size.height > 0;
  const shape = classifyWindow({
    size: r.size,
    prev: r.prev,
    keyboardUp,
    remembered: keyboardUp ? r.seen.get(key) : undefined,
    orientation: r.orientation,
    screenShortSide: r.screenShortSide,
  });
  return { shape, remember };
}

export function sameShape(a: WindowShape, b: WindowShape): boolean {
  return a.landscape === b.landscape && a.compact === b.compact && a.width === b.width;
}

/**
 * Which side has the camera cutout in landscape. The safe area is the better witness where it
 * is asymmetric (Android cutouts; iPhone Duo puts the camera and status bar on one side): the
 * wider inset is the camera side. Equal insets (iPhone landscape reports both sides) fall
 * back to `window.orientation`.
 */
export function cutoutFrom(
  angle: unknown,
  insets: { readonly left: number; readonly right: number } | null,
): CutoutSide {
  if (insets && ok(Math.max(insets.left, insets.right))) {
    const d = insets.left - insets.right;
    if (d >= 8) return 'left';
    if (d <= -8) return 'right';
  }
  return cutoutSide(angle);
}

// ---------------------------------------------------------------------------------------
// Fold (DSP-8)

export interface FoldInfo {
  /** A horizontal hinge (tabletop / laptop posture): segments above and below. */
  readonly horizontalFold: boolean;
  /** Top of the lower segment in CSS px from the viewport top, when known. */
  readonly foldTop: number | null;
  /**
   * Bottom of the upper segment, when known. Equal to `foldTop` on a seamless folding
   * display; smaller where the hinge is a gap that shows nothing (dual-screen devices).
   */
  readonly foldBottom: number | null;
}

export const NO_FOLD: FoldInfo = { horizontalFold: false, foldTop: null, foldBottom: null };

export interface ViewportSegment {
  readonly top: number;
  readonly height: number;
  readonly left?: number;
  readonly width?: number;
}

export interface FoldSignals {
  /** `window.viewport.segments` (Viewport Segments API), when the WebView has it. */
  readonly segments?: readonly ViewportSegment[] | null | undefined;
  /** `(vertical-viewport-segments: 2)`: two segments stacked, i.e. a horizontal hinge. */
  readonly stacked: boolean;
  /** `(horizontal-viewport-segments: 2)`: two segments side by side, i.e. a vertical hinge. */
  readonly sideBySide: boolean;
  /** `navigator.devicePosture.type` (no geometry). */
  readonly posture?: string | undefined;
  /** `screen.orientation.angle`: 0/180 = the device's natural orientation. */
  readonly angle?: number | undefined;
  readonly width: number;
  readonly height: number;
}

/** A book-style foldable's inner screen is near-square; a flip phone's is tall (about 2.3:1). */
const NEAR_SQUARE = 1.6;

/**
 * The fold, from whichever API the WebView has. Only a horizontal hinge (tabletop / laptop
 * posture) matters: the split layout puts the desktop on the upper half and the trackpad on
 * the lower. A vertical hinge (a book fold, iPhone Duo or a Galaxy Fold held open like a
 * book) leaves the desktop whole: it is one picture across a seamless display.
 *
 * The Device Posture API says "folded" without saying which way the hinge runs. It is only
 * trusted where the geometry is unambiguous: no segment information contradicts it, the
 * window is near-square (a book fold's inner screen, not a flip phone's), wider than tall,
 * and turned 90° from the device's natural orientation. A book foldable's hinge runs along
 * its natural vertical axis, so only then is it horizontal; a foldable whose natural
 * orientation is landscape (Pixel Fold's inner screen, and possibly iPhone Duo's) held
 * that way has a vertical hinge. Without the angle the posture alone is not enough.
 */
export function foldFromSignals(s: FoldSignals): FoldInfo {
  const segs = s.segments;
  if (segs && segs.length >= 2) {
    const sorted = [...segs].sort((a, b) => a.top - b.top);
    const a = sorted[0];
    const b = sorted[sorted.length - 1];
    if (a && b && b.top - a.top > 1) {
      const upperBottom = a.top + a.height;
      return {
        horizontalFold: true,
        foldTop: Math.round(b.top),
        foldBottom: Math.round(Math.min(upperBottom, b.top)),
      };
    }
    return NO_FOLD;
  }
  if (s.stacked) {
    const half = Math.round(s.height / 2);
    return { horizontalFold: true, foldTop: half, foldBottom: half };
  }
  if (s.sideBySide) return NO_FOLD;
  if (s.posture !== 'folded') return NO_FOLD;
  const w = s.width;
  const h = s.height;
  if (!ok(w) || !ok(h) || w <= h || w / h > NEAR_SQUARE) return NO_FOLD;
  const angle = s.angle;
  if (angle !== 90 && angle !== 270 && angle !== -90) return NO_FOLD;
  const half = Math.round(h / 2);
  return { horizontalFold: true, foldTop: half, foldBottom: half };
}

/**
 * The `splitLayout` value for the More sheet's switch: `auto` while the wanted state is what
 * `auto` gives on this device now (split exactly when folded at a horizontal hinge), so a
 * switch turned off and on again keeps following the fold. Pure.
 */
export function splitLayoutFor(on: boolean, horizontalFold: boolean): 'auto' | 'on' | 'off' {
  if (on === horizontalFold) return 'auto';
  return on ? 'on' : 'off';
}

export function sameFold(a: FoldInfo, b: FoldInfo): boolean {
  return (
    a.horizontalFold === b.horizontalFold &&
    a.foldTop === b.foldTop &&
    a.foldBottom === b.foldBottom
  );
}
