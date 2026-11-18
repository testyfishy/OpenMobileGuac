/**
 * TextInputDiff: pure logic behind the hidden-text-field technique (SPEC §8.4).
 *
 * The host (`TextInputBridge`, T1.7) keeps a visually hidden, focused text field whose value
 * starts with a sentinel (by default one zero-width space, as upstream's text-input mode
 * uses U+200B padding) so that Backspace always has something to delete and therefore
 * always produces an input event. The caret is kept at the end of the field.
 *
 * After every `input` event, and once more on `compositionend` with `composing = false`,
 * the host calls `diffTextInput(baseline, field.value, composing)` where `baseline` is the
 * value the remote is believed to mirror (initially the sentinel). The extra call matters:
 * on Chromium / Android WebView the last `input` of a composition can arrive before
 * `compositionend` (still composing) with no `input` after it, so without it commit mode
 * would never send the text and the reset check would be skipped. Calling twice with the
 * same value is harmless (the second call is a no-op diff).
 * The result says how many Backspaces to send, what text to type, the new baseline, and
 * whether to reset the field to the sentinel.
 *
 * Diff: longest common prefix in **code points**; everything after it in the old baseline
 * is erased with Backspace, everything after it in the new value is typed. This handles
 * plain inserts, backspace (including into the sentinel), autocorrect / suggestion
 * replacing a word, paste, and IME updates, as long as the caret is at the end (the field
 * is hidden, so it is). Sentinel characters are never typed.
 *
 * IME composition strategy: **incremental** by default. Composition updates are diffed
 * and sent as they happen (with Backspaces when the composing text changes, e.g. kana →
 * kanji conversion). Reason: Android keyboards (Gboard, Samsung) put ordinary Latin typing
 * inside a composition region for the whole word, so commit-only would show nothing on the
 * remote until the word ends, which breaks password fields and live feedback. Cost: the
 * remote sees intermediate composing text and the Backspaces that replace it; this is
 * correct in plain text fields but noisy, and an app on the remote that reacts to every
 * keystroke will see the churn. `composition: 'commit'` (upstream's behaviour) is
 * available: nothing is sent while composing, and the committed result is diffed when
 * composition ends.
 *
 * Reset policy: never while composing (resetting the value mid-composition breaks IMEs).
 * Otherwise reset when the sentinel was damaged, when the value ends with whitespace (a
 * word boundary: keeps the current word available to autocorrect/suggestions but no more),
 * or when the typed content reaches `maxLength` code points.
 *
 * Backspace counting is per code point. Whether the remote deletes one code point or one
 * grapheme per Backspace depends on the remote application; for combining sequences and
 * emoji ZWJ sequences the two differ (KEY-2 scopes emoji out).
 */

import type { KeyEvent, KeyModel } from './KeyModel.ts';

export const SENTINEL_CHAR = '​';
export const DEFAULT_SENTINEL = SENTINEL_CHAR;

export interface TextInputOptions {
  /** Field content that represents "empty". Must be non-empty. */
  readonly sentinel: string;
  /** Reset once this many code points beyond the sentinel have accumulated. */
  readonly maxLength: number;
  readonly composition: 'incremental' | 'commit';
}

export const DEFAULT_TEXT_INPUT_OPTIONS: TextInputOptions = {
  sentinel: DEFAULT_SENTINEL,
  maxLength: 64,
  composition: 'incremental',
};

export interface TextInputUpdate {
  /** Backspaces to send first. */
  readonly backspaces: number;
  /** Text to type after the Backspaces (never contains sentinel characters). */
  readonly text: string;
  /** Value the remote now mirrors; pass it as `baseline` next time. */
  readonly baseline: string;
  /** Host should set the field to `baseline` (which is then the sentinel), caret at end. */
  readonly reset: boolean;
}

function cps(s: string): string[] {
  return [...s];
}

/** Compute what to send for a change of the hidden field from `baseline` to `value`. */
export function diffTextInput(
  baseline: string,
  value: string,
  composing: boolean,
  options: Partial<TextInputOptions> = {},
): TextInputUpdate {
  const opts = { ...DEFAULT_TEXT_INPUT_OPTIONS, ...options };
  const sentinel = opts.sentinel.length > 0 ? opts.sentinel : DEFAULT_SENTINEL;

  if (composing && opts.composition === 'commit') {
    return { backspaces: 0, text: '', baseline, reset: false };
  }

  const a = cps(baseline);
  const b = cps(value);
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  const backspaces = a.length - p;
  const sentinelChars = new Set(cps(sentinel));
  const text = b
    .slice(p)
    .filter((c) => !sentinelChars.has(c))
    .join('');

  let reset = false;
  if (!composing) {
    const typedLength = b.length - cps(sentinel).length;
    reset =
      !value.startsWith(sentinel) ||
      /\s$/u.test(value.slice(sentinel.length)) ||
      typedLength >= opts.maxLength;
  }
  return { backspaces, text, baseline: reset ? sentinel : value, reset };
}

/** Initial state for the field and baseline. */
export function initialTextInput(options: Partial<TextInputOptions> = {}): string {
  const s = options.sentinel ?? DEFAULT_SENTINEL;
  return s.length > 0 ? s : DEFAULT_SENTINEL;
}

/**
 * Key events for an update: Backspaces first, then the text. Uses the KeyModel so sticky
 * modifiers apply to the first key (e.g. sticky Ctrl + Backspace = delete word).
 */
export function textInputKeyEvents(update: TextInputUpdate, keys: KeyModel): KeyEvent[] {
  const out: KeyEvent[] = [];
  for (let i = 0; i < update.backspaces; i++) out.push(...keys.pressKey('Backspace'));
  if (update.text !== '') out.push(...keys.typeText(update.text));
  return out;
}
