import { describe, expect, it } from 'vitest';
import { DemoScale, fitScale, scaleForDpi } from './scale.ts';

describe('scaleForDpi', () => {
  it('maps GUAC_DPI to device pixels per logical pixel, within [1, 4]', () => {
    expect(scaleForDpi(96)).toBe(1);
    expect(scaleForDpi(144)).toBe(1.5);
    expect(scaleForDpi(252)).toBe(2.625);
    expect(scaleForDpi(288)).toBe(3);
    expect(scaleForDpi(48)).toBe(1);
    expect(scaleForDpi(960)).toBe(4);
  });

  it('falls back to 1 for a missing or invalid DPI', () => {
    expect(scaleForDpi(NaN)).toBe(1);
    expect(scaleForDpi(0)).toBe(1);
    expect(scaleForDpi(-96)).toBe(1);
    expect(scaleForDpi(Infinity)).toBe(1);
  });
});

describe('fitScale', () => {
  it('keeps the scale when the logical desktop is big enough', () => {
    expect(fitScale(3, 1125, 2436)).toBe(3);
  });

  it('lowers the scale so the logical desktop keeps its minimum size, never below 1', () => {
    expect(fitScale(3, 640, 480)).toBe(2);
    expect(fitScale(3, 300, 200)).toBe(1);
  });
});

describe('DemoScale.sizes', () => {
  it('phone portrait at DPR 3: 1125 × 2436 device px is 375 × 812 logical', () => {
    const s = new DemoScale(3);
    expect(s.sizes(1125, 2436)).toEqual({
      logical: { width: 375, height: 812 },
      device: { width: 1125, height: 2436 },
    });
    // Rotated.
    expect(s.sizes(2436, 1125).logical).toEqual({ width: 812, height: 375 });
  });

  it('fractional scales round the logical size up and keep the device size exact', () => {
    const s = new DemoScale(2.625);
    expect(s.sizes(1080, 2340)).toEqual({
      logical: { width: 412, height: 892 },
      device: { width: 1080, height: 2340 },
    });
    expect(new DemoScale(1.5).sizes(1281, 801)).toEqual({
      logical: { width: 854, height: 534 },
      device: { width: 1281, height: 801 },
    });
  });

  it('clamps the device size, and grows it when the logical minimum applies', () => {
    const s = new DemoScale(3);
    expect(s.sizes(9000, 9000).device).toEqual({ width: 4096, height: 4096 });
    expect(s.sizes(9000, 9000).logical).toEqual({ width: 1366, height: 1366 });
    // 330 / 3 = 110 logical, below the 320 minimum: layer 0 becomes 960 device px.
    expect(s.sizes(330, 900)).toEqual({
      logical: { width: 320, height: 300 },
      device: { width: 960, height: 900 },
    });
  });

  it('uses the default size for invalid requests', () => {
    expect(new DemoScale(2).sizes(NaN, 0).device).toEqual({ width: 1280, height: 800 });
  });
});

describe('DemoScale conversions', () => {
  it('maps pointer coordinates down and lengths up', () => {
    const s = new DemoScale(3);
    expect([s.toLogical(0), s.toLogical(2), s.toLogical(3), s.toLogical(1124)]).toEqual([
      0, 0, 1, 374,
    ]);
    expect(s.toLogical(-5)).toBe(0);
    expect(s.dev(13)).toBe(39);
    expect(new DemoScale(2.625).dev(13)).toBe(34);
  });

  it('covers a logical rect with whole device pixels', () => {
    expect(new DemoScale(3).devRect({ x: 1, y: 2, w: 3, h: 4 })).toEqual({
      x: 3,
      y: 6,
      w: 9,
      h: 12,
    });
    // 8 * 2.625 = 21 exactly: no stray pixel from float error.
    expect(new DemoScale(2.625).devRect({ x: 8, y: 8, w: 8, h: 8 })).toEqual({
      x: 21,
      y: 21,
      w: 21,
      h: 21,
    });
    // 2.625 to 5.25 device px: pixels 2 to 5 are touched.
    expect(new DemoScale(2.625).devRect({ x: 1, y: 0, w: 1, h: 1 })).toEqual({
      x: 2,
      y: 0,
      w: 4,
      h: 3,
    });
  });

  it('treats an invalid scale as 1', () => {
    expect(new DemoScale(0.5).scale).toBe(1);
    expect(new DemoScale(NaN).scale).toBe(1);
    expect(new DemoScale(2).isInteger).toBe(true);
    expect(new DemoScale(2.625).isInteger).toBe(false);
  });
});
