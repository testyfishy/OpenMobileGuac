import { describe, expect, it } from 'vitest';
import { PIP_MAX_WIDTH, pipFrameSize } from './pipFeed.ts';

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
