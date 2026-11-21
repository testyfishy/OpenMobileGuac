import { describe, expect, it } from 'vitest';
import { scrollMore } from './scrollHint.ts';

describe('scroll hint', () => {
  it('reports which edges hide content', () => {
    expect(scrollMore(0, 0)).toBe('none');
    expect(scrollMore(0, 1)).toBe('none');
    expect(scrollMore(0, 120)).toBe('end');
    expect(scrollMore(60, 120)).toBe('both');
    expect(scrollMore(120, 120)).toBe('start');
    expect(scrollMore(119.5, 120)).toBe('start');
    expect(scrollMore(-60, 120)).toBe('both');
  });
});
