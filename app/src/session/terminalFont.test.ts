import { describe, expect, it } from 'vitest';
import {
  FONT_SIZE_DEFAULT,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  fontSizeAfterPinch,
  nextColorScheme,
  parseFontSize,
  stepFontSize,
} from './terminalFont.ts';

describe('terminal font size and colours (argv font-size / color-scheme)', () => {
  it('parses the server value', () => {
    expect(parseFontSize('14')).toBe(14);
    expect(parseFontSize('')).toBe(FONT_SIZE_DEFAULT);
    expect(parseFontSize('0')).toBe(FONT_SIZE_DEFAULT);
    expect(parseFontSize(undefined)).toBe(FONT_SIZE_DEFAULT);
  });

  it('steps and clamps', () => {
    expect(stepFontSize(12, 1)).toBe(13);
    expect(stepFontSize(FONT_SIZE_MIN, -1)).toBe(FONT_SIZE_MIN);
    expect(stepFontSize(FONT_SIZE_MAX, 1)).toBe(FONT_SIZE_MAX);
  });

  it('scales with a pinch', () => {
    expect(fontSizeAfterPinch(12, 1.5)).toBe(18);
    expect(fontSizeAfterPinch(12, 0.5)).toBe(6);
    expect(fontSizeAfterPinch(12, 10)).toBe(FONT_SIZE_MAX);
    expect(fontSizeAfterPinch(12, Number.NaN)).toBe(12);
  });

  it('cycles the guacd presets', () => {
    expect(nextColorScheme('gray-black')).toBe('black-white');
    expect(nextColorScheme('white-black')).toBe('gray-black');
    expect(nextColorScheme('foreground: rgb:ff/ff/ff')).toBe('gray-black');
  });
});
