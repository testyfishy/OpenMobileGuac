import { describe, expect, it } from 'vitest';
import { PIP_MAX_WIDTH, pipFrameDue, pipFrameSize } from './pipFeed.ts';

describe('pipFrameSize', () => {
  it('never upscales and keeps even dimensions', () => {
    expect(pipFrameSize(800, 601)).toEqual({ width: 800, height: 602 });
  });
  it('scales wide displays down to the maximum width', () => {
    const s = pipFrameSize(1920, 1080);
    expect(s).toEqual({ width: PIP_MAX_WIDTH, height: 540 });
  });
  it('returns nothing for an empty display', () => {
    expect(pipFrameSize(0, 0)).toEqual({ width: 0, height: 0 });
  });
});

describe('pipFrameDue', () => {
  const at = (ms: number, hidden: boolean, dirty: boolean) =>
    pipFrameDue({ now: 10_000 + ms, lastSentAt: 10_000, hidden, dirty });
  it('follows display updates up to 12 a second in the background', () => {
    expect(at(50, true, true)).toBe(false);
    expect(at(90, true, true)).toBe(true);
  });
  it('sends only twice a second in the foreground', () => {
    expect(at(90, false, true)).toBe(false);
    expect(at(500, false, true)).toBe(true);
  });
  it('refreshes an unchanged picture once a second', () => {
    expect(at(900, true, false)).toBe(false);
    expect(at(1000, true, false)).toBe(true);
  });
});
