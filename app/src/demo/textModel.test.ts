import { describe, expect, it } from 'vitest';
import {
  TextModel,
  indexAtX,
  layoutText,
  lineIndexOf,
  xOfIndex,
  type TextLine,
} from './textModel.ts';

const w10 = () => 10;

describe('TextModel', () => {
  it('inserts at the caret and backspaces by code point', () => {
    const t = new TextModel('');
    t.insert('ab');
    t.insert('🙂');
    t.insert('é');
    expect(t.text).toBe('ab🙂é');
    expect(t.length).toBe(4);
    t.backspace();
    t.backspace();
    expect(t.text).toBe('ab');
    t.left();
    t.insert('X');
    expect(t.text).toBe('aXb');
    t.moveTo(0);
    t.backspace();
    expect(t.text).toBe('aXb');
    t.deleteForward();
    expect(t.text).toBe('Xb');
  });

  it('replaces and deletes selections', () => {
    const t = new TextModel('hello world');
    t.selectAll();
    expect(t.selectedText()).toBe('hello world');
    t.insert('hi');
    expect(t.text).toBe('hi');
    t.left(true);
    expect(t.selectedText()).toBe('i');
    t.backspace();
    expect(t.text).toBe('h');
    expect(t.hasSelection()).toBe(false);
  });

  it('collapses a selection with an arrow key', () => {
    const t = new TextModel('abc');
    t.selectAll();
    t.left();
    expect(t.caret).toBe(0);
    expect(t.hasSelection()).toBe(false);
    t.selectAll();
    t.right();
    expect(t.caret).toBe(3);
  });
});

describe('layoutText', () => {
  const cps = (s: string) => Array.from(s);

  it('breaks at newlines and keeps an empty last line', () => {
    expect(layoutText(cps('ab\ncd\n'), 100, w10)).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
      { start: 6, end: 6 },
    ]);
  });

  it('wraps after the last space that fits, or mid-word', () => {
    // 5 characters per line.
    expect(layoutText(cps('aa bb cc'), 50, w10)).toEqual([
      { start: 0, end: 3 },
      { start: 3, end: 8 },
    ]);
    expect(layoutText(cps('abcdefgh'), 50, w10)).toEqual([
      { start: 0, end: 5 },
      { start: 5, end: 8 },
    ]);
  });

  it('maps between positions and pixels', () => {
    const c = cps('ab\ncdef');
    const lines = layoutText(c, 100, w10);
    expect(lineIndexOf(lines, 4)).toBe(1);
    expect(xOfIndex(c, lines[1] as TextLine, 5, w10)).toBe(20);
    expect(indexAtX(c, lines[1] as TextLine, 26, w10)).toBe(6);
    expect(indexAtX(c, lines[1] as TextLine, 999, w10)).toBe(7);
  });
});
