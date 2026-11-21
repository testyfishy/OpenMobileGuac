import { describe, expect, it } from 'vitest';
import {
  classifyWindow,
  readWindowShape,
  sameShape,
  shapeOf,
  splitLayoutFor,
  type WindowShape,
} from './deviceShape.ts';
import { computeLayout, splitKeyboard, type LayoutInput } from './layout.ts';
import { PIP_OPEN_FAIL_MS, pipOpenFailed, pipOpenRefused } from './pipFeed.ts';
import { isTopmostLayer } from './sheetBack.ts';

const NONE = new Map<number, { width: number; height: number }>();

describe('isTopmostLayer', () => {
  it('only the last open layer is on top', () => {
    const a = { id: 'more' };
    const b = { id: 'prompt' };
    expect(isTopmostLayer(b, [a, b])).toBe(true);
    expect(isTopmostLayer(a, [a, b])).toBe(false);
  });
  it('a lone layer, or one not found yet, still answers', () => {
    const a = { id: 'more' };
    expect(isTopmostLayer(a, [a])).toBe(true);
    expect(isTopmostLayer(null, [a])).toBe(true);
    expect(isTopmostLayer(a, [])).toBe(true);
  });
});

describe('readWindowShape', () => {
  const read = (
    size: { width: number; height: number },
    prev: WindowShape | null,
    fieldKeyboard: boolean,
    nativeKeyboard: boolean,
  ) => readWindowShape({ size, prev, fieldKeyboard, nativeKeyboard, seen: NONE });

  // Ordinary iPhones (portrait 393×852, landscape 852×393): a keyboard from any field gives
  // the same shape as before, whether or not it is counted as a keyboard.
  const iphoneCases = [
    { name: 'portrait', open: { width: 393, height: 852 }, shrunk: { width: 393, height: 516 } },
    { name: 'landscape', open: { width: 852, height: 393 }, shrunk: { width: 852, height: 193 } },
  ];
  for (const c of iphoneCases) {
    it(`keeps an ordinary iPhone's ${c.name} shape with a keyboard up`, () => {
      const prev = shapeOf(c.open);
      const counted = read(c.shrunk, prev, false, true).shape;
      const fieldOnly = read(c.shrunk, prev, true, false).shape;
      const notCounted = read(c.shrunk, prev, false, false).shape;
      expect(sameShape(counted, prev)).toBe(true);
      expect(sameShape(fieldOnly, prev)).toBe(true);
      expect(sameShape(notCounted, prev)).toBe(true);
    });
  }

  it('matches classifyWindow for the hidden field, as before', () => {
    const prev = shapeOf({ width: 852, height: 393 });
    const size = { width: 852, height: 193 };
    expect(read(size, prev, true, false).shape).toEqual(
      classifyWindow({ size, prev, keyboardUp: true, remembered: undefined }),
    );
    expect(read(size, prev, false, false).shape).toEqual(shapeOf(size));
  });

  it("keeps iPhone Duo's outer screen portrait when another field raises the keyboard", () => {
    const prev = shapeOf({ width: 466, height: 678 });
    const shrunk = { width: 466, height: 378 };
    // Only the hidden field counted (the old reading): the shrunken window looked landscape.
    expect(read(shrunk, prev, false, false).shape.landscape).toBe(true);
    const r = read(shrunk, prev, false, true);
    expect(r.shape).toEqual(prev);
    expect(r.remember).toBe(false);
  });

  it('remembers keyboard-closed sizes only', () => {
    expect(read({ width: 466, height: 678 }, null, false, false).remember).toBe(true);
    expect(read({ width: 466, height: 378 }, null, true, false).remember).toBe(false);
    expect(read({ width: 0, height: 0 }, null, false, false).remember).toBe(false);
  });

  it('still applies a rotation with the keyboard up, from the remembered size', () => {
    const prev = shapeOf({ width: 466, height: 678 });
    const seen = new Map([[678, { width: 678, height: 466 }]]);
    const r = readWindowShape({
      size: { width: 678, height: 166 },
      prev,
      fieldKeyboard: false,
      nativeKeyboard: true,
      seen,
    });
    expect(r.shape).toEqual({ landscape: true, compact: true, width: 678 });
  });
});

describe('splitLayoutFor', () => {
  it('writes auto when the wanted state is what auto gives now', () => {
    expect(splitLayoutFor(true, true)).toBe('auto');
    expect(splitLayoutFor(false, false)).toBe('auto');
  });
  it('writes on / off when it differs from the fold', () => {
    expect(splitLayoutFor(true, false)).toBe('on');
    expect(splitLayoutFor(false, true)).toBe('off');
  });
});

describe('splitKeyboard', () => {
  const base: LayoutInput = {
    measured: { width: 0, height: 0 },
    stable: null,
    keyboardOpen: false,
    nativeKeyboardHeight: 0,
    visualViewportInset: 0,
  };
  const layout = (
    measured: number,
    stable: number,
    native: number,
    vv = 0,
  ): ReturnType<typeof computeLayout> =>
    computeLayout({
      ...base,
      measured: { width: 393, height: measured },
      stable: { width: 393, height: stable },
      keyboardOpen: native > 0 || vv > 0,
      nativeKeyboardHeight: native,
      visualViewportInset: vv,
    });

  it('gives the full-screen answer when the stage is the whole session', () => {
    // Ordinary iPhone, WebView shrunk by the keyboard (iOS native resize).
    for (const [stable, measured, native] of [
      [852, 516, 336],
      [393, 193, 200],
      [852, 852, 336],
    ] as const) {
      const out = layout(measured, stable, native);
      const s = splitKeyboard({
        stageTop: 0,
        stageHeight: measured,
        stage: out,
        rootTop: 0,
        rootHeight: measured,
        root: out,
      });
      expect(s.keyboardInset).toBe(out.keyboardInset);
      expect(s.keyboardCover).toBe(Math.max(0, out.keyboardInset - (out.screen.height - measured)));
    }
  });

  it('58 % stage: the dock sits on the keyboard, the inset is what the stage lost', () => {
    const root = layout(500, 800, 300);
    const stage = layout(290, 464, 300);
    const s = splitKeyboard({
      stageTop: 0,
      stageHeight: 290,
      stage,
      rootTop: 0,
      rootHeight: 500,
      root,
    });
    expect(s.keyboardCover).toBe(0);
    expect(s.keyboardInset).toBe(174);
  });

  it('stage at a hinge: no inset while the keyboard stays below it', () => {
    const root = layout(500, 800, 300);
    // The stage has a fixed height and does not shrink.
    const stage = computeLayout({
      ...base,
      measured: { width: 393, height: 400 },
      stable: { width: 393, height: 400 },
      keyboardOpen: true,
      nativeKeyboardHeight: 300,
    });
    const at = (rootHeight: number, r = root) =>
      splitKeyboard({ stageTop: 0, stageHeight: 400, stage, rootTop: 0, rootHeight, root: r });
    expect(at(500)).toEqual({ keyboardCover: 0, keyboardInset: 0 });
    // A taller keyboard reaches 100 px into the stage.
    expect(at(300, layout(300, 800, 500)).keyboardInset).toBe(100);
  });

  it('web overlay keyboard: the container does not shrink, the keyboard covers it', () => {
    const root = computeLayout({
      ...base,
      measured: { width: 393, height: 800 },
      stable: { width: 393, height: 800 },
      keyboardOpen: true,
      visualViewportInset: 300,
    });
    const stage = computeLayout({
      ...base,
      measured: { width: 393, height: 464 },
      stable: { width: 393, height: 464 },
      keyboardOpen: true,
    });
    const s = splitKeyboard({
      stageTop: 0,
      stageHeight: 464,
      stage,
      rootTop: 0,
      rootHeight: 800,
      root,
    });
    expect(s.keyboardCover).toBe(300);
    expect(s.keyboardInset).toBe(0);
  });
});

describe('pipOpenRefused', () => {
  it('is not a refusal while the window is still coming up', () => {
    expect(pipOpenRefused({ supported: true, prepared: true, possible: true, active: false })).toBe(
      false,
    );
    expect(pipOpenRefused({ supported: true, prepared: true, active: true, error: 'old' })).toBe(
      false,
    );
  });
  it('is a refusal when unsupported, not prepared or not possible', () => {
    expect(pipOpenRefused({ supported: false })).toBe(true);
    expect(pipOpenRefused({ supported: true, prepared: false })).toBe(true);
    expect(pipOpenRefused({ supported: true, prepared: true, possible: false })).toBe(true);
  });
});

describe('pipOpenFailed', () => {
  it('takes a failed event soon after an open as that open failing', () => {
    expect(pipOpenFailed('failed', 1000 + PIP_OPEN_FAIL_MS, 1000)).toBe(true);
    expect(pipOpenFailed('failed', 1001 + PIP_OPEN_FAIL_MS, 1000)).toBe(false);
    expect(pipOpenFailed('failed', 2000, 0)).toBe(false);
    expect(pipOpenFailed('possible', 1500, 1000)).toBe(false);
  });
});
