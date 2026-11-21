import { describe, expect, it } from 'vitest';
import {
  classifyWindow,
  cutoutFrom,
  foldFromSignals,
  NO_FOLD,
  sameShape,
  shapeOf,
  type FoldSignals,
} from './deviceShape.ts';

// Window sizes (CSS px). iPhone Duo: derived from Apple's screenshot specifications at 3x
// (outer 1398×2034 px, inner 2007×2853 px); Galaxy Z Fold-class inner screen; iPad mini.
const DUO_OUTER = { width: 466, height: 678 };
const DUO_OUTER_LAND = { width: 678, height: 466 };
const DUO_INNER = { width: 669, height: 951 };
const DUO_INNER_LAND = { width: 951, height: 669 };
const PHONE = { width: 393, height: 852 };
const IPAD_MINI = { width: 744, height: 1133 };

describe('shapeOf', () => {
  it('the cover screen is phone-sized in both orientations', () => {
    expect(shapeOf(DUO_OUTER)).toMatchObject({ compact: true, landscape: false });
    expect(shapeOf(DUO_OUTER_LAND)).toMatchObject({ compact: true, landscape: true });
  });
  it('the inner screen is not, in both orientations', () => {
    expect(shapeOf(DUO_INNER)).toMatchObject({ compact: false, landscape: false });
    expect(shapeOf(DUO_INNER_LAND)).toMatchObject({ compact: false, landscape: true });
    expect(shapeOf(IPAD_MINI).compact).toBe(false);
  });
  it('a half-width Split View window on the inner screen is phone-sized', () => {
    expect(shapeOf({ width: 470, height: 669 })).toMatchObject({ compact: true, landscape: false });
  });
  it('an empty size is treated as a phone, not landscape', () => {
    expect(shapeOf({ width: 0, height: 0 })).toMatchObject({ compact: true, landscape: false });
  });
});

describe('classifyWindow', () => {
  it('without a keyboard: the current size, every time (fold and unfold)', () => {
    let s = shapeOf(DUO_OUTER);
    s = classifyWindow({ size: DUO_INNER_LAND, prev: s, keyboardUp: false });
    expect(s).toMatchObject({ compact: false, landscape: true, width: 951 });
    s = classifyWindow({ size: DUO_OUTER, prev: s, keyboardUp: false });
    expect(s).toMatchObject({ compact: true, landscape: false, width: 466 });
  });

  it('a keyboard that shrinks only the height keeps the shape', () => {
    const prev = shapeOf(PHONE);
    // A portrait phone with a 500 px keyboard would look landscape-ish / short.
    const s = classifyWindow({ size: { width: 393, height: 352 }, prev, keyboardUp: true });
    expect(s).toBe(prev);
    // A tablet with the keyboard up is not read as a phone.
    const tab = shapeOf(DUO_INNER_LAND);
    expect(classifyWindow({ size: { width: 951, height: 330 }, prev: tab, keyboardUp: true })).toBe(
      tab,
    );
  });

  it('a fold with the keyboard up applies at once, from the size last seen at that width', () => {
    const prev = shapeOf(DUO_INNER_LAND);
    const s = classifyWindow({
      size: { width: 466, height: 330 },
      prev,
      keyboardUp: true,
      remembered: DUO_OUTER,
      orientation: 'landscape', // ignored: the remembered size is better
    });
    expect(s).toMatchObject({ compact: true, landscape: false, width: 466 });
  });

  it('an unseen width with the keyboard up uses the device orientation for landscape', () => {
    const prev = shapeOf(PHONE);
    const s = classifyWindow({
      size: { width: 852, height: 120 },
      prev,
      keyboardUp: true,
      orientation: 'landscape',
    });
    expect(s).toMatchObject({ compact: true, landscape: true, width: 852 });
    const p = classifyWindow({
      size: { width: 669, height: 700 },
      prev,
      keyboardUp: true,
      orientation: 'portrait',
    });
    expect(p.landscape).toBe(false);
  });

  it('an unseen width with the keyboard up does not trust the shrunk height', () => {
    // A tablet rotated for the first time with the keyboard up.
    const tab = classifyWindow({
      size: { width: 1133, height: 340 },
      prev: shapeOf(IPAD_MINI),
      keyboardUp: true,
      orientation: 'landscape',
      screenShortSide: 744,
    });
    expect(tab).toMatchObject({ compact: false, landscape: true });
    // A first unfold to the inner screen's portrait with the keyboard up: the width decides.
    const inner = classifyWindow({
      size: { width: 669, height: 520 },
      prev: shapeOf(DUO_OUTER),
      keyboardUp: true,
      orientation: 'portrait',
      screenShortSide: 466, // stale: the other display
    });
    expect(inner).toMatchObject({ compact: false, landscape: false });
    // A first unfold to the inner screen's landscape: the screen's short side, if current.
    const land = classifyWindow({
      size: { width: 951, height: 330 },
      prev: shapeOf(DUO_OUTER),
      keyboardUp: true,
      orientation: 'landscape',
      screenShortSide: 669,
    });
    expect(land).toMatchObject({ compact: false, landscape: true });
  });

  it('sameShape compares every field', () => {
    expect(sameShape(shapeOf(DUO_OUTER), shapeOf(DUO_OUTER))).toBe(true);
    expect(sameShape(shapeOf(DUO_OUTER), shapeOf({ width: 467, height: 678 }))).toBe(false);
  });
});

describe('cutoutFrom', () => {
  it('an asymmetric safe area names the camera side', () => {
    expect(cutoutFrom(undefined, { left: 0, right: 59 })).toBe('right');
    expect(cutoutFrom(-90, { left: 48, right: 0 })).toBe('left');
  });
  it('equal or no insets fall back to window.orientation', () => {
    expect(cutoutFrom(90, { left: 59, right: 59 })).toBe('left');
    expect(cutoutFrom(-90, null)).toBe('right');
    expect(cutoutFrom(0, { left: 0, right: 0 })).toBe('unknown');
    expect(cutoutFrom(90, { left: 3, right: 0 })).toBe('left');
  });
});

describe('foldFromSignals', () => {
  const base: FoldSignals = { stacked: false, sideBySide: false, width: 841, height: 673 };

  it('no API: no fold', () => {
    expect(foldFromSignals(base)).toEqual(NO_FOLD);
  });

  it('two stacked segments: a horizontal hinge at the lower segment', () => {
    const f = foldFromSignals({
      ...base,
      segments: [
        { top: 0, height: 330, left: 0, width: 841 },
        { top: 343, height: 330, left: 0, width: 841 },
      ],
    });
    expect(f).toEqual({ horizontalFold: true, foldTop: 343, foldBottom: 330 });
  });

  it('segments in any order', () => {
    const f = foldFromSignals({
      ...base,
      segments: [
        { top: 337, height: 336 },
        { top: 0, height: 337 },
      ],
    });
    expect(f).toEqual({ horizontalFold: true, foldTop: 337, foldBottom: 337 });
  });

  it('side-by-side segments (book fold): no horizontal fold', () => {
    const f = foldFromSignals({
      ...base,
      segments: [
        { top: 0, height: 669, left: 0, width: 475 },
        { top: 0, height: 669, left: 476, width: 475 },
      ],
      posture: 'folded',
      angle: 90,
    });
    expect(f).toEqual(NO_FOLD);
  });

  it('the media query alone: hinge at half height', () => {
    expect(foldFromSignals({ ...base, stacked: true })).toEqual({
      horizontalFold: true,
      foldTop: 337,
      foldBottom: 337,
    });
  });

  it('posture "folded" with a side-by-side media query is a book fold', () => {
    expect(foldFromSignals({ ...base, sideBySide: true, posture: 'folded', angle: 90 })).toEqual(
      NO_FOLD,
    );
  });

  it('posture only: a near-square landscape window turned from natural portrait', () => {
    expect(foldFromSignals({ ...base, posture: 'folded', angle: 90 }).horizontalFold).toBe(true);
    expect(foldFromSignals({ ...base, posture: 'folded', angle: 270 }).horizontalFold).toBe(true);
  });

  it('posture only does not misfire on an iPhone Duo / Pixel Fold style book fold', () => {
    // Natural orientation landscape (angle 0): the hinge is vertical.
    const duo = { stacked: false, sideBySide: false, width: 951, height: 669 };
    expect(foldFromSignals({ ...duo, posture: 'folded', angle: 0 })).toEqual(NO_FOLD);
    // Angle unknown: not enough to tell.
    expect(foldFromSignals({ ...duo, posture: 'folded' })).toEqual(NO_FOLD);
    // Portrait: never a horizontal fold from posture alone.
    expect(
      foldFromSignals({ ...duo, width: 669, height: 951, posture: 'folded', angle: 90 }),
    ).toEqual(NO_FOLD);
  });

  it('posture only does not misfire on a flip phone turned sideways (tall screen)', () => {
    expect(
      foldFromSignals({ ...base, width: 880, height: 380, posture: 'folded', angle: 90 }),
    ).toEqual(NO_FOLD);
  });

  it('posture "continuous": no fold', () => {
    expect(foldFromSignals({ ...base, posture: 'continuous', angle: 90 })).toEqual(NO_FOLD);
  });
});
