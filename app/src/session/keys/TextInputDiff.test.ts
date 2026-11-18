import { describe, expect, it } from 'vitest';
import { KEYSYM, KeyModel } from './KeyModel.ts';
import {
  DEFAULT_SENTINEL,
  diffTextInput,
  initialTextInput,
  textInputKeyEvents,
  type TextInputOptions,
  type TextInputUpdate,
} from './TextInputDiff.ts';

const S = DEFAULT_SENTINEL;

/** Simulates the host: feeds successive field values, applying resets like the bridge would. */
function session(
  values: [string, boolean][],
  options: Partial<TextInputOptions> = {},
): { updates: TextInputUpdate[]; remote: string } {
  let baseline = initialTextInput(options);
  let remote = '';
  const updates: TextInputUpdate[] = [];
  for (const [value, composing] of values) {
    const u = diffTextInput(baseline, value, composing, options);
    updates.push(u);
    const r = [...remote];
    r.splice(Math.max(0, r.length - u.backspaces), u.backspaces);
    remote = r.join('') + u.text;
    baseline = u.baseline;
  }
  return { updates, remote };
}

describe('diffTextInput', () => {
  // [name, baseline, value, composing, backspaces, text, reset]
  const rows: [string, string, string, boolean, number, string, boolean][] = [
    ['plain insert', S, S + 'a', false, 0, 'a', false],
    ['insert after existing text', S + 'ab', S + 'abc', false, 0, 'c', false],
    ['backspace on typed text', S + 'ab', S + 'a', false, 1, '', false],
    ['backspace on the sentinel', S, '', false, 1, '', true],
    ['no change', S + 'ab', S + 'ab', false, 0, '', false],
    ['space ends the word: reset', S + 'hi', S + 'hi ', false, 0, ' ', true],
    ['newline: reset', S + 'ls', S + 'ls\n', false, 0, '\n', true],
    ['autocorrect replaces the word on space', S + 'teh', S + 'the ', false, 2, 'he ', true],
    ['suggestion replaces the whole word', S + 'helo', S + 'hello', false, 1, 'lo', false],
    [
      'paste of multi-char text',
      S,
      S + 'https://example.org/a?b=c',
      false,
      0,
      'https://example.org/a?b=c',
      false,
    ],
    [
      'paste ending in a newline resets',
      S,
      S + 'line one\nline two\n',
      false,
      0,
      'line one\nline two\n',
      true,
    ],
    ['word delete', S + 'foo bar', S + 'foo ', false, 3, '', true],
    ['select-all + type replaces everything (sentinel lost)', S + 'ab', 'x', false, 3, 'x', true],
    ['astral char backspace counts one code point', S + 'a😀', S + 'a', false, 1, '', false],
    ['sentinel characters are never typed', S, S + 'a' + S + 'b', false, 0, 'ab', false],
    ['composing: never reset even at a space', S + 'ab', S + 'ab ', true, 0, ' ', false],
    ['composing: never reset even without the sentinel', S, '', true, 1, '', false],
  ];

  it.each(rows)('%s', (_n, baseline, value, composing, backspaces, text, reset) => {
    const u = diffTextInput(baseline, value, composing);
    expect({ backspaces: u.backspaces, text: u.text, reset: u.reset }).toEqual({
      backspaces,
      text,
      reset,
    });
    expect(u.baseline).toBe(reset ? S : value);
  });

  it('resets after maxLength code points', () => {
    const u = diffTextInput(S + 'abc', S + 'abcd', false, { maxLength: 4 });
    expect(u.reset).toBe(true);
    expect(diffTextInput(S + 'ab', S + 'abc', false, { maxLength: 4 }).reset).toBe(false);
  });

  it('multi-character sentinel: backspace into it sends one Backspace and resets', () => {
    const sentinel = S + S + S;
    const u = diffTextInput(sentinel, S + S, false, { sentinel });
    expect([u.backspaces, u.text, u.reset, u.baseline]).toEqual([1, '', true, sentinel]);
  });

  it('empty sentinel option falls back to the default', () => {
    expect(initialTextInput({ sentinel: '' })).toBe(S);
    expect(diffTextInput(S, S + 'a', false, { sentinel: '' }).text).toBe('a');
  });
});

describe('IME composition', () => {
  // Japanese romaji input: k → か → かn → かな → 仮名 (conversion) → commit.
  const kana: [string, boolean][] = [
    [S + 'k', true],
    [S + 'か', true],
    [S + 'かn', true],
    [S + 'かな', true],
    [S + '仮名', true],
    [S + '仮名', false], // compositionend + final input
  ];

  it('incremental (default): sends updates live, remote ends correct', () => {
    const { updates, remote } = session(kana);
    expect(updates.map((u) => [u.backspaces, u.text])).toEqual([
      [0, 'k'],
      [1, 'か'],
      [0, 'n'],
      [1, 'な'],
      [2, '仮名'],
      [0, ''],
    ]);
    expect(remote).toBe('仮名');
    expect(updates.every((u) => !u.reset)).toBe(true);
  });

  it('commit mode: nothing while composing, the committed text on end', () => {
    const { updates, remote } = session(kana, { composition: 'commit' });
    expect(updates.slice(0, 5).every((u) => u.backspaces === 0 && u.text === '')).toBe(true);
    expect(updates[5]).toMatchObject({ backspaces: 0, text: '仮名' });
    expect(remote).toBe('仮名');
  });

  it('Android-style composing Latin word with autocorrect on space', () => {
    const { remote, updates } = session([
      [S + 't', true],
      [S + 'te', true],
      [S + 'teh', true],
      [S + 'the ', false], // keyboard commits its correction together with the space
      [S + 'c', true],
      [S + 'ca', true],
      [S + 'cat', false],
    ]);
    expect(remote).toBe('the cat');
    expect(updates[3]?.reset).toBe(true);
  });

  it('swipe typing inserts whole words and the auto-space', () => {
    const { remote } = session([
      [S + 'hello', true],
      [S + 'hello', false],
      [S + 'hello world', true],
      [S + 'hello world', false],
    ]);
    expect(remote).toBe('hello world');
  });

  it('backspace during composition shrinks the composing text', () => {
    const { remote } = session([
      [S + 'abc', true],
      [S + 'ab', true],
      [S + 'ab', false],
    ]);
    expect(remote).toBe('ab');
  });

  it('repeated backspace on an empty field keeps working after each reset', () => {
    const { updates } = session([
      ['', false],
      ['', false],
      ['', false],
    ]);
    expect(updates.map((u) => u.backspaces)).toEqual([1, 1, 1]);
    expect(updates.every((u) => u.reset)).toBe(true);
  });
});

describe('textInputKeyEvents', () => {
  it('sends Backspaces then the text, honouring sticky modifiers on the first key', () => {
    const keys = new KeyModel();
    keys.tapModifier('Ctrl');
    const events = textInputKeyEvents({ backspaces: 2, text: 'x', baseline: S, reset: true }, keys);
    const ctrl = 0xffe3;
    const bs = KEYSYM.BackSpace;
    expect(events).toEqual([
      { keysym: ctrl, pressed: true },
      { keysym: bs, pressed: true },
      { keysym: bs, pressed: false },
      { keysym: ctrl, pressed: false },
      { keysym: bs, pressed: true },
      { keysym: bs, pressed: false },
      { keysym: 0x78, pressed: true },
      { keysym: 0x78, pressed: false },
    ]);
  });

  it('no-op update produces no events', () => {
    expect(
      textInputKeyEvents({ backspaces: 0, text: '', baseline: S, reset: false }, new KeyModel()),
    ).toEqual([]);
  });
});
