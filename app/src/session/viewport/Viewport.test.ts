import { describe, expect, it } from 'vitest';
import {
  FIT_MODES,
  applyViewportCommands,
  baseScale,
  canPan,
  clampToRemotePixel,
  createViewport,
  setAlignX,
  ensureVisible,
  fitScreenScale,
  isFlinging,
  isOverContent,
  offsetBounds,
  panBy,
  relayout,
  remoteToScreen,
  resetToMode,
  scaleBounds,
  scaleOf,
  screenToRemote,
  setMode,
  setZoom,
  startFling,
  stepFling,
  toCssTransform,
  toTransform,
  visibleRect,
  zoomAt,
  type FitMode,
  type Size,
  type ViewportState,
} from './Viewport.ts';

const REMOTE: Size = { width: 1920, height: 1080 };
const PORTRAIT: Size = { width: 390, height: 844 };
const LANDSCAPE: Size = { width: 844, height: 390 };

function vp(
  mode: FitMode,
  screen: Size,
  extra: Partial<Parameters<typeof createViewport>[0]> = {},
) {
  return createViewport({ remote: REMOTE, screen, mode, ...extra });
}

function contentRect(s: ViewportState) {
  const scale = scaleOf(s);
  return {
    left: s.offsetX,
    top: s.offsetY,
    right: s.offsetX + s.remote.width * scale,
    bottom: s.offsetY + s.remote.height * scale,
  };
}

function expectFinite(s: ViewportState) {
  for (const v of [s.offsetX, s.offsetY, s.zoom, scaleOf(s), s.velocityX, s.velocityY]) {
    expect(Number.isFinite(v)).toBe(true);
  }
}

describe('1:1 means one remote pixel per device pixel (AUDIT #6)', () => {
  it.each([1, 2, 3, 2.625])('at DPR %s: 1:1 = 1/dpr, 100%% = 1', (dpr) => {
    const remote = { width: 1920, height: 1080 };
    const one = createViewport({ remote, screen: PORTRAIT, mode: 'one-to-one', pixelRatio: dpr });
    expect(scaleOf(one)).toBeCloseTo(1 / dpr, 12);
    const css = createViewport({ remote, screen: PORTRAIT, mode: 'css-pixels', pixelRatio: dpr });
    expect(scaleOf(css)).toBe(1);
  });

  it('ignores a bogus pixel ratio', () => {
    const v = createViewport({
      remote: { width: 100, height: 100 },
      screen: PORTRAIT,
      mode: 'one-to-one',
      pixelRatio: 0,
    });
    expect(scaleOf(v)).toBe(1);
  });
});

describe('Viewport fit modes (DSP-1)', () => {
  // [mode, screen name, screen, expected scale, expected offsetX, expected offsetY]
  const rows: [FitMode, string, Size, number, number, number][] = [
    ['fit-screen', 'portrait', PORTRAIT, 390 / 1920, 0, (844 - 1080 * (390 / 1920)) / 2],
    ['fit-screen', 'landscape', LANDSCAPE, 390 / 1080, (844 - 1920 * (390 / 1080)) / 2, 0],
    ['fit-width', 'portrait', PORTRAIT, 390 / 1920, 0, (844 - 1080 * (390 / 1920)) / 2],
    // content taller than the screen: aligned to top
    ['fit-width', 'landscape', LANDSCAPE, 844 / 1920, 0, 0],
    // content wider than the screen: aligned to left
    ['fit-height', 'portrait', PORTRAIT, 844 / 1080, 0, 0],
    ['fit-height', 'landscape', LANDSCAPE, 390 / 1080, (844 - 1920 * (390 / 1080)) / 2, 0],
    ['one-to-one', 'portrait', PORTRAIT, 1, 0, 0],
    ['one-to-one', 'landscape', LANDSCAPE, 1, 0, 0],
  ];

  it.each(rows)('%s in %s', (mode, _name, screen, scale, ox, oy) => {
    const s = vp(mode, screen);
    expect(scaleOf(s)).toBeCloseTo(scale, 9);
    expect(s.offsetX).toBeCloseTo(ox, 6);
    expect(s.offsetY).toBeCloseTo(oy, 6);
    expect(s.zoom).toBe(1);
  });

  it.each([PORTRAIT, LANDSCAPE])('fit-screen shows the whole remote (%o)', (screen) => {
    const c = contentRect(vp('fit-screen', screen));
    expect(c.left).toBeGreaterThanOrEqual(-1e-9);
    expect(c.top).toBeGreaterThanOrEqual(-1e-9);
    expect(c.right).toBeLessThanOrEqual(screen.width + 1e-9);
    expect(c.bottom).toBeLessThanOrEqual(screen.height + 1e-9);
  });

  it.each([PORTRAIT, LANDSCAPE])('fit-width spans the width exactly (%o)', (screen) => {
    const c = contentRect(vp('fit-width', screen));
    expect(c.right - c.left).toBeCloseTo(screen.width, 9);
  });

  it.each([PORTRAIT, LANDSCAPE])('fit-height spans the height exactly (%o)', (screen) => {
    const c = contentRect(vp('fit-height', screen));
    expect(c.bottom - c.top).toBeCloseTo(screen.height, 9);
  });

  it('safe-area insets shrink the layout area and offset the content', () => {
    const insets = { top: 47, right: 0, bottom: 34, left: 0 };
    const s = vp('fit-height', PORTRAIT, { insets });
    expect(scaleOf(s)).toBeCloseTo((844 - 47 - 34) / 1080, 9);
    expect(s.offsetY).toBeCloseTo(47, 9);
    const land = vp('fit-screen', LANDSCAPE, {
      insets: { top: 0, right: 47, bottom: 21, left: 47 },
    });
    const c = contentRect(land);
    expect(c.left).toBeGreaterThanOrEqual(47 - 1e-9);
    expect(c.right).toBeLessThanOrEqual(844 - 47 + 1e-9);
    expect(c.bottom).toBeLessThanOrEqual(390 - 21 + 1e-9);
  });

  it('a portrait remote on a landscape screen letterboxes horizontally', () => {
    const s = createViewport({ remote: { width: 1080, height: 1920 }, screen: LANDSCAPE });
    expect(scaleOf(s)).toBeCloseTo(390 / 1920, 9);
    expect(s.offsetY).toBeCloseTo(0, 9);
    expect(s.offsetX).toBeCloseTo((844 - 1080 * (390 / 1920)) / 2, 9);
  });

  it('a remote smaller than the screen is scaled up in fit-screen and centred in 1:1', () => {
    const small = { width: 320, height: 200 };
    const fit = createViewport({ remote: small, screen: LANDSCAPE });
    expect(scaleOf(fit)).toBeCloseTo(390 / 200, 9);
    const one = createViewport({ remote: small, screen: LANDSCAPE, mode: 'one-to-one' });
    expect(scaleOf(one)).toBe(1);
    expect(one.offsetX).toBeCloseTo((844 - 320) / 2, 9);
    expect(one.offsetY).toBeCloseTo((390 - 200) / 2, 9);
  });

  it('setMode switches framing and resets zoom', () => {
    const zoomed = setZoom(vp('fit-screen', PORTRAIT), 3);
    const s = setMode(zoomed, 'fit-height');
    expect(s.mode).toBe('fit-height');
    expect(s.zoom).toBe(1);
    expect(scaleOf(s)).toBeCloseTo(844 / 1080, 9);
  });

  it('degenerate sizes never produce NaN', () => {
    const cases: [Size, Size][] = [
      [
        { width: 0, height: 0 },
        { width: 0, height: 0 },
      ],
      [{ width: 0, height: 0 }, PORTRAIT],
      [REMOTE, { width: 0, height: 0 }],
      [
        { width: Number.NaN, height: -5 },
        { width: Infinity, height: 100 },
      ],
    ];
    for (const [remote, screen] of cases) {
      for (const mode of FIT_MODES) {
        let s = createViewport({ remote, screen, mode });
        expectFinite(s);
        s = zoomAt(s, 2, { x: 10, y: 10 });
        s = panBy(s, 100, -100);
        s = ensureVisible(s, { x: 5, y: 5 }, 20);
        s = stepFling(startFling(s, 1, 1), 16);
        s = relayout(s, { screen: PORTRAIT, keyboardInset: 300 });
        expectFinite(s);
        const p = screenToRemote(s, { x: 1, y: 1 });
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      }
    }
  });
});

describe('Viewport zoom bounds (DSP-2)', () => {
  it('cannot zoom out past "whole remote visible"', () => {
    const s = zoomAt(vp('fit-height', PORTRAIT), 0.01, { x: 100, y: 100 });
    expect(scaleOf(s)).toBeCloseTo(fitScreenScale(s), 9);
    const c = contentRect(s);
    expect(c.right - c.left).toBeLessThanOrEqual(390 + 1e-9);
  });

  it('fit-screen cannot zoom out below its own base', () => {
    const s = zoomAt(vp('fit-screen', LANDSCAPE), 0.5, { x: 0, y: 0 });
    expect(s.zoom).toBeCloseTo(1, 9);
  });

  it('caps at the configured max scale', () => {
    const s = zoomAt(vp('fit-screen', PORTRAIT), 1000, { x: 0, y: 0 });
    expect(scaleOf(s)).toBeCloseTo(8, 9);
    const custom = zoomAt(vp('fit-screen', PORTRAIT, { config: { maxScale: 2 } }), 1000, {
      x: 0,
      y: 0,
    });
    expect(scaleOf(custom)).toBeCloseTo(2, 9);
  });

  it('1:1 base sits inside [min, max] even when the remote is tiny', () => {
    const s = createViewport({
      remote: { width: 100, height: 50 },
      screen: PORTRAIT,
      mode: 'one-to-one',
      config: { maxScale: 0.5 },
    });
    const b = scaleBounds(s);
    expect(b.min).toBeLessThanOrEqual(1);
    expect(b.max).toBeGreaterThanOrEqual(1);
    expect(scaleOf(s)).toBe(1);
  });

  it('keeps the remote point under the focal point fixed', () => {
    const s0 = vp('fit-screen', LANDSCAPE);
    const focal = { x: 400, y: 200 };
    const before = screenToRemote(s0, focal);
    const s1 = zoomAt(s0, 2.5, focal);
    const after = screenToRemote(s1, focal);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('focal zoom near an edge is corrected by pan bounds (no gap)', () => {
    const s = zoomAt(vp('fit-screen', LANDSCAPE), 4, { x: 844, y: 390 });
    const c = contentRect(s);
    expect(c.left).toBeLessThanOrEqual(1e-9);
    expect(c.right).toBeGreaterThanOrEqual(844 - 1e-9);
    expect(c.bottom).toBeGreaterThanOrEqual(390 - 1e-9);
  });

  it('ignores invalid zoom factors', () => {
    const s = vp('fit-screen', LANDSCAPE);
    for (const f of [0, -2, Number.NaN, Infinity]) expect(zoomAt(s, f, { x: 0, y: 0 })).toBe(s);
  });

  it('reset returns to the mode framing', () => {
    const s0 = vp('fit-width', LANDSCAPE);
    const moved = panBy(zoomAt(s0, 3, { x: 300, y: 300 }), -500, -500);
    const reset = resetToMode(moved);
    expect(reset.zoom).toBe(1);
    expect(reset.offsetX).toBeCloseTo(s0.offsetX, 9);
    expect(reset.offsetY).toBeCloseTo(s0.offsetY, 9);
  });
});

describe('Viewport pan bounds', () => {
  it('content smaller than the viewport stays centred', () => {
    const s0 = vp('fit-screen', PORTRAIT);
    const s1 = panBy(s0, 50, 300);
    expect(s1.offsetX).toBeCloseTo(s0.offsetX, 9);
    expect(s1.offsetY).toBeCloseTo(s0.offsetY, 9);
    expect(canPan(s0)).toBe(false);
  });

  it('larger content is clamped so no empty space appears', () => {
    const s0 = vp('one-to-one', PORTRAIT);
    expect(canPan(s0)).toBe(true);
    const right = panBy(s0, 10_000, 10_000);
    expect(right.offsetX).toBe(0);
    expect(right.offsetY).toBe(0);
    const left = panBy(s0, -10_000, -10_000);
    expect(left.offsetX).toBe(390 - 1920);
    expect(left.offsetY).toBe(844 - 1080);
  });

  it('fit-width can still pan vertically when the content is taller', () => {
    const s = panBy(vp('fit-width', LANDSCAPE), -30, -30);
    expect(s.offsetX).toBe(0);
    expect(s.offsetY).toBe(-30);
  });

  it('panning is exact within bounds', () => {
    const s0 = zoomAt(vp('fit-screen', LANDSCAPE), 4, { x: 422, y: 195 });
    const s1 = panBy(s0, 12.5, -7.25);
    expect(s1.offsetX - s0.offsetX).toBeCloseTo(12.5, 9);
    expect(s1.offsetY - s0.offsetY).toBeCloseTo(-7.25, 9);
  });
});

describe('Viewport coordinate mapping', () => {
  it.each(FIT_MODES)('round-trips remote ↔ screen in %s', (mode) => {
    const s = zoomAt(vp(mode, LANDSCAPE), 1.7, { x: 123, y: 77 });
    for (const p of [
      { x: 0, y: 0 },
      { x: 1919, y: 1079 },
      { x: 640.25, y: 333.5 },
    ]) {
      const back = screenToRemote(s, remoteToScreen(s, p));
      expect(back.x).toBeCloseTo(p.x, 9);
      expect(back.y).toBeCloseTo(p.y, 9);
    }
  });

  it('maps the screen centre to the remote centre in fit-screen', () => {
    const s = vp('fit-screen', PORTRAIT);
    const c = screenToRemote(s, { x: 195, y: 422 });
    expect(c.x).toBeCloseTo(960, 6);
    expect(c.y).toBeCloseTo(540, 6);
  });

  it('detects letterbox touches and clamps to valid pixels', () => {
    const s = vp('fit-screen', PORTRAIT);
    expect(isOverContent(s, { x: 195, y: 10 })).toBe(false);
    expect(isOverContent(s, { x: 195, y: 422 })).toBe(true);
    expect(clampToRemotePixel(s, { x: -3, y: 5000 })).toEqual({ x: 0, y: 1079 });
    expect(clampToRemotePixel(s, { x: 1919.6, y: 0.4 })).toEqual({ x: 1919, y: 0 });
    expect(clampToRemotePixel(s, { x: Number.NaN, y: 2 })).toEqual({ x: 0, y: 2 });
  });

  it('produces a CSS transform', () => {
    const s = vp('one-to-one', PORTRAIT);
    expect(toTransform(s)).toEqual({ translateX: 0, translateY: 0, scale: 1 });
    expect(toCssTransform(panBy(s, -10, -20))).toBe('translate3d(-10px, -20px, 0) scale(1)');
  });
});

describe('Viewport keyboard inset and ensureVisible (DSP-5)', () => {
  it('keyboard does not change the base scale', () => {
    const s0 = vp('fit-width', PORTRAIT);
    const s1 = relayout(s0, { keyboardInset: 300 });
    expect(baseScale(s1)).toBe(baseScale(s0));
    expect(visibleRect(s1).height).toBe(844 - 300);
  });

  it('keyboard opening does not make a zoomed view jump', () => {
    const s0 = zoomAt(vp('fit-screen', PORTRAIT), 4, { x: 195, y: 300 });
    const s1 = relayout(s0, { keyboardInset: 300 });
    expect(s1.offsetX).toBe(s0.offsetX);
    expect(s1.offsetY).toBe(s0.offsetY);
  });

  it('lifts a point near the remote bottom above the keyboard', () => {
    // Field near the bottom of the remote screen, zoomed in so it can be scrolled.
    const s0 = relayout(zoomAt(vp('fit-screen', PORTRAIT), 4, { x: 195, y: 422 }), {
      keyboardInset: 336,
    });
    const field = { x: 960, y: 1050 };
    const s1 = ensureVisible(s0, field, 24);
    const sp = remoteToScreen(s1, field);
    const vis = visibleRect(s1);
    expect(sp.y).toBeLessThanOrEqual(vis.y + vis.height - 24 + 1e-6);
    expect(sp.y).toBeGreaterThanOrEqual(vis.y);
    expect(sp.x).toBeGreaterThanOrEqual(24 - 1e-6);
    expect(sp.x).toBeLessThanOrEqual(390 - 24 + 1e-6);
  });

  it('fit-width with the keyboard up can pan the bottom row above the keyboard', () => {
    const s0 = relayout(vp('fit-width', LANDSCAPE), { keyboardInset: 200 });
    const s1 = ensureVisible(s0, { x: 100, y: 1079 }, 0);
    expect(remoteToScreen(s1, { x: 100, y: 1079 }).y).toBeLessThanOrEqual(190 + 1e-6);
    expect(offsetBounds(s1).y.min).toBeCloseTo(190 - 1080 * (844 / 1920), 6);
  });

  it('is a no-op when the point is already visible', () => {
    const s0 = zoomAt(vp('fit-screen', LANDSCAPE), 3, { x: 422, y: 195 });
    const inside = screenToRemote(s0, { x: 400, y: 200 });
    expect(ensureVisible(s0, inside, 10)).toBe(s0);
  });

  it('follows the pointer with a minimal pan (pointer ends exactly at the margin)', () => {
    const s0 = zoomAt(vp('fit-screen', LANDSCAPE), 4, { x: 0, y: 0 });
    const p = screenToRemote(s0, { x: 900, y: 100 }); // off the right edge
    const s1 = ensureVisible(s0, p, 40);
    expect(remoteToScreen(s1, p).x).toBeCloseTo(844 - 40, 6);
    expect(remoteToScreen(s1, p).y).toBeCloseTo(100, 6);
  });

  it('a margin larger than half the viewport centres the point (within bounds)', () => {
    const s0 = vp('one-to-one', PORTRAIT);
    const s1 = ensureVisible(s0, { x: 960, y: 540 }, 10_000);
    const sp = remoteToScreen(s1, { x: 960, y: 540 });
    expect(sp.x).toBeCloseTo(195, 6);
    expect(sp.y).toBeCloseTo(422, 6);
  });

  it('cannot pan past content edges even when asked', () => {
    const s0 = vp('one-to-one', PORTRAIT);
    const s1 = ensureVisible(s0, { x: 0, y: 0 }, 100);
    expect(s1.offsetX).toBe(0);
    expect(s1.offsetY).toBe(0);
  });

  it('keyboard taller than the screen leaves a zero-height visible area without NaN', () => {
    const s = ensureVisible(relayout(vp('fit-width', PORTRAIT), { keyboardInset: 5000 }), {
      x: 5,
      y: 5,
    });
    expect(visibleRect(s).height).toBe(0);
    expectFinite(s);
  });
});

describe('Viewport fling', () => {
  const zoomed = () => zoomAt(vp('fit-screen', LANDSCAPE), 4, { x: 422, y: 195 });

  it('is independent of how time is sliced', () => {
    const s0 = startFling(zoomed(), 0.5, -0.3);
    const once = stepFling(s0, 120);
    let many = s0;
    for (let i = 0; i < 12; i++) many = stepFling(many, 10);
    expect(many.offsetX).toBeCloseTo(once.offsetX, 6);
    expect(many.offsetY).toBeCloseTo(once.offsetY, 6);
    expect(many.velocityX).toBeCloseTo(once.velocityX, 9);
  });

  it('dt = 0 and negative dt are no-ops', () => {
    const s0 = startFling(zoomed(), 0.5, 0.5);
    expect(stepFling(s0, 0)).toBe(s0);
    expect(stepFling(s0, -16)).toBe(s0);
  });

  it('a huge dt finishes the fling within bounds', () => {
    const s = stepFling(startFling(zoomed(), 3, 3), 1e9);
    expect(isFlinging(s)).toBe(false);
    const b = offsetBounds(s);
    expect(s.offsetX).toBeGreaterThanOrEqual(b.x.min);
    expect(s.offsetX).toBeLessThanOrEqual(b.x.max);
  });

  it('stops an axis when it hits a bound and keeps the other', () => {
    const s0 = startFling(panBy(zoomed(), 10_000, 0), 1, -0.5); // already at the left bound
    const s1 = stepFling(s0, 16);
    expect(s1.velocityX).toBe(0);
    expect(s1.velocityY).not.toBe(0);
  });

  it('decays to a stop and the total distance is bounded by v * tau', () => {
    const s0 = startFling(zoomed(), 0.4, 0);
    let s = s0;
    let steps = 0;
    while (isFlinging(s) && steps < 10_000) {
      s = stepFling(s, 16);
      steps++;
    }
    expect(isFlinging(s)).toBe(false);
    expect(Math.abs(s.offsetX - s0.offsetX)).toBeLessThanOrEqual(0.4 * 325 + 1e-6);
  });

  it('caps the start velocity and ignores tiny flings', () => {
    expect(startFling(zoomed(), 100, 0).velocityX).toBe(8);
    expect(isFlinging(startFling(zoomed(), 0.001, 0.001))).toBe(false);
  });
});

describe('Viewport relayout: rotation, fold, remote resize (DSP-3 maths)', () => {
  it('rotation keeps the remote point at the screen centre', () => {
    const s0 = panBy(zoomAt(vp('fit-screen', PORTRAIT), 5, { x: 195, y: 422 }), 120, -80);
    const centreBefore = screenToRemote(s0, { x: 195, y: 422 });
    const s1 = relayout(s0, { screen: LANDSCAPE });
    const centreAfter = screenToRemote(s1, { x: 422, y: 195 });
    expect(centreAfter.x).toBeCloseTo(centreBefore.x, 6);
    expect(centreAfter.y).toBeCloseTo(centreBefore.y, 6);
    expect(s1.zoom).toBeCloseTo(s0.zoom, 9);
  });

  it('un-zoomed fit-screen re-fits after rotation', () => {
    const s1 = relayout(vp('fit-screen', PORTRAIT), { screen: LANDSCAPE });
    const fresh = vp('fit-screen', LANDSCAPE);
    expect(scaleOf(s1)).toBeCloseTo(scaleOf(fresh), 9);
    expect(s1.offsetX).toBeCloseTo(fresh.offsetX, 6);
    expect(s1.offsetY).toBeCloseTo(fresh.offsetY, 6);
  });

  it('unfolding (width grows) keeps the centre point', () => {
    const folded = { width: 360, height: 800 };
    const unfolded = { width: 720, height: 800 };
    // Pan away from the left edge so the new, wider view is not clamped.
    const s0 = panBy(zoomAt(vp('fit-height', folded), 1.5, { x: 180, y: 400 }), -600, -100);
    const before = screenToRemote(s0, { x: 180, y: 400 });
    const s1 = relayout(s0, { screen: unfolded });
    const after = screenToRemote(s1, { x: 360, y: 400 });
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('a remote resize maps the centre proportionally and stays in bounds', () => {
    const s0 = zoomAt(vp('fit-screen', LANDSCAPE), 3, { x: 422, y: 195 });
    const s1 = relayout(s0, { remote: { width: 960, height: 540 } });
    expect(s1.remote).toEqual({ width: 960, height: 540 });
    const b = offsetBounds(s1);
    expect(s1.offsetX).toBeGreaterThanOrEqual(b.x.min - 1e-9);
    expect(s1.offsetX).toBeLessThanOrEqual(b.x.max + 1e-9);
  });

  it('relayout stops a fling', () => {
    const s0 = startFling(zoomAt(vp('fit-screen', LANDSCAPE), 3, { x: 0, y: 0 }), 1, 1);
    expect(isFlinging(relayout(s0, { screen: PORTRAIT }))).toBe(false);
  });
});

describe('applyViewportCommands', () => {
  it('applies a sequence of commands as data', () => {
    const s0 = vp('fit-screen', LANDSCAPE);
    const s1 = applyViewportCommands(s0, [
      { type: 'zoom', factor: 2, focalX: 422, focalY: 195 },
      { type: 'pan', dx: 10, dy: 5 },
      { type: 'fling', vx: 1, vy: 0 },
    ]);
    expect(s1.zoom).toBeCloseTo(2, 9);
    expect(isFlinging(s1)).toBe(true);
    const s2 = applyViewportCommands(s1, [{ type: 'stop-fling' }]);
    expect(isFlinging(s2)).toBe(false);
    const s3 = applyViewportCommands(s2, [{ type: 'reset' }]);
    expect(s3.zoom).toBe(1);
    const s4 = applyViewportCommands(zoomAt(s0, 4, { x: 0, y: 0 }), [
      { type: 'ensure-visible', x: 1900, y: 1000, margin: 10 },
    ]);
    expect(remoteToScreen(s4, { x: 1900, y: 1000 }).x).toBeLessThanOrEqual(844 - 10 + 1e-6);
  });
});

describe('content narrower than the free area', () => {
  // A landscape phone: safe area 59 px on both sides, a 62 px toolbar docked on the right.
  const base = {
    remote: { width: 300, height: 400 },
    screen: { width: 874, height: 402 },
    insets: { top: 0, right: 62, bottom: 0, left: 59 },
    mode: 'css-pixels' as const,
  };

  it('centres in the screen minus the toolbar, not in the safe area', () => {
    const plain = createViewport(base);
    expect(plain.offsetX).toBe(59 + (874 - 59 - 62 - 300) / 2);
    const framed = createViewport({ ...base, frame: { top: 0, right: 62, bottom: 0, left: 0 } });
    expect(framed.offsetX).toBe((874 - 62 - 300) / 2);
  });

  it('keeps the content inside the safe area', () => {
    const wide = createViewport({
      ...base,
      remote: { width: 740, height: 400 },
      frame: { top: 0, right: 62, bottom: 0, left: 0 },
    });
    expect(wide.offsetX).toBe(59);
  });

  it('aligns left or right on request', () => {
    const v = createViewport({ ...base, frame: { top: 0, right: 62, bottom: 0, left: 0 } });
    expect(setAlignX(v, 'left').offsetX).toBe(59);
    expect(setAlignX(v, 'right').offsetX).toBe(874 - 62 - 300);
    expect(setAlignX(v, 'center').offsetX).toBe(v.offsetX);
  });
});
