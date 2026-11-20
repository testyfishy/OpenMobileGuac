import { describe, expect, it } from 'vitest';
import {
  guacdRdpResult,
  nativeDpi,
  requestedDisplaySize,
  requestsAudio,
  resizeDebounceMs,
  type SizeInputs,
} from './remoteSize.ts';

const phone3: Pick<SizeInputs, 'cssWidth' | 'cssHeight' | 'devicePixelRatio'> = {
  cssWidth: 390,
  cssHeight: 844,
  devicePixelRatio: 3,
};
const phone2: Pick<SizeInputs, 'cssWidth' | 'cssHeight' | 'devicePixelRatio'> = {
  cssWidth: 375,
  cssHeight: 812,
  devicePixelRatio: 2,
};
const base = {
  resolution: 'auto',
  customWidth: 1280,
  customHeight: 720,
  scalePercent: 100,
} as const;

describe('guacd 1.6.0 RDP size rule (resolution.c / settings.c)', () => {
  it.each([
    // [request, expected desktop] — values computed in AUDIT §4.3 and the research notes.
    [
      { width: 1170, height: 2532, dpi: 288 },
      { width: 484, height: 1055, dpi: 120 },
    ],
    [
      { width: 1170, height: 2532, dpi: 96 },
      { width: 1168, height: 2532, dpi: 96 },
    ],
    [
      { width: 390, height: 844, dpi: 96 },
      { width: 388, height: 844, dpi: 96 },
    ],
    [
      { width: 750, height: 1624, dpi: 192 },
      { width: 748, height: 1624, dpi: 192 },
    ],
    [
      { width: 375, height: 812, dpi: 96 },
      { width: 372, height: 812, dpi: 96 },
    ],
    [
      { width: 1170, height: 2532, dpi: 298 },
      { width: 1168, height: 2532, dpi: 298 },
    ],
  ])('%j → %j', (req, out) => {
    expect(guacdRdpResult(req)).toEqual(out);
  });

  it('nativeDpi is the lowest DPI guacd keeps', () => {
    expect(nativeDpi(1170, 2532, 288)).toBe(298);
    expect(nativeDpi(750, 1624, 192)).toBe(192);
    expect(nativeDpi(1170, 2532, 96)).toBe(96);
    expect(guacdRdpResult({ width: 1170, height: 2532, dpi: 297 }).dpi).toBe(120);
  });
});

describe('requestedDisplaySize per quality (AUDIT §4.4)', () => {
  it('auto = upstream web client: device px at 96·dpr', () => {
    expect(requestedDisplaySize({ ...base, quality: 'auto', ...phone3 })).toEqual({
      width: 1170,
      height: 2532,
      dpi: 288,
    });
    expect(requestedDisplaySize({ ...base, quality: 'auto', ...phone2 })).toEqual({
      width: 750,
      height: 1624,
      dpi: 192,
    });
  });

  it('best = native resolution on DPR 3 (1168×2532 instead of 484×1055)', () => {
    const r3 = requestedDisplaySize({ ...base, quality: 'best', ...phone3 });
    expect(r3).toEqual({ width: 1170, height: 2532, dpi: 298 });
    expect(guacdRdpResult(r3)).toEqual({ width: 1168, height: 2532, dpi: 298 });
    const r2 = requestedDisplaySize({ ...base, quality: 'best', ...phone2 });
    expect(guacdRdpResult(r2)).toEqual({ width: 748, height: 1624, dpi: 192 });
  });

  it('low = CSS px at 96 DPI, no audio, slower resize', () => {
    const r = requestedDisplaySize({ ...base, quality: 'low', ...phone3 });
    expect(r).toEqual({ width: 390, height: 844, dpi: 96 });
    expect(guacdRdpResult(r)).toEqual({ width: 388, height: 844, dpi: 96 });
    expect(requestsAudio('low', 'on')).toBe(false);
    expect(resizeDebounceMs('low')).toBeGreaterThan(resizeDebounceMs('auto'));
  });

  it('audio off advertises nothing; muted still requests (local mute)', () => {
    expect(requestsAudio('auto', 'off')).toBe(false);
    expect(requestsAudio('best', 'muted')).toBe(true);
    expect(requestsAudio('auto', 'on')).toBe(true);
  });

  it('a fixed or custom resolution is sent at 96 DPI, which guacd keeps as is', () => {
    const r = requestedDisplaySize({
      ...base,
      resolution: '1920x1080',
      quality: 'auto',
      ...phone3,
    });
    expect(r).toEqual({ width: 1920, height: 1080, dpi: 96 });
    expect(guacdRdpResult(r)).toEqual(r);
    const c = requestedDisplaySize({
      ...base,
      resolution: 'custom',
      customWidth: 1366,
      customHeight: 768,
      quality: 'best',
      ...phone2,
    });
    expect(c).toEqual({ width: 1366, height: 768, dpi: 96 });
    const d = requestedDisplaySize({ ...base, resolution: 'device', quality: 'low', ...phone3 });
    expect(d).toEqual({ width: 1170, height: 2532, dpi: 96 });
  });

  it('scale divides the requested size (200 % → half the pixels each way)', () => {
    const r = requestedDisplaySize({ ...base, quality: 'auto', scalePercent: 200, ...phone3 });
    expect(r).toEqual({ width: 585, height: 1266, dpi: 96 });
    expect(guacdRdpResult(r).width).toBe(584);
  });

  it('best keeps the auto DPI for terminals (guacd scales the font by DPI)', () => {
    expect(requestedDisplaySize({ ...base, quality: 'best', terminal: true, ...phone3 })).toEqual({
      width: 1170,
      height: 2532,
      dpi: 288,
    });
  });
});
