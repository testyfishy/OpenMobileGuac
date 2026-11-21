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
  /**
   * `live` (default): send every change as it happens. `word`: the fallback for keyboards
   * that misbehave with live diffing (upstream-like): new text is held in the field until
   * a word boundary (whitespace or punctuation), `maxLength`, a deletion of text already
   * sent, or a `flush` (blur, Enter from the key bar, a click). Composition is held too.
   */
  readonly commit: 'live' | 'word';
  /** Send whatever is held (word mode). */
  readonly flush: boolean;
  /**
   * Keep what was typed in the field across spaces, so the keyboard app has the sentence
   * to work with (autocorrect of an earlier word, double space → full stop, sentence
   * capitals). The field is then reset only on a damaged sentinel or a line break, and at
   * `maxLength` it is trimmed to its last few words instead of emptied. The host must reset
   * the field whenever anything else reaches the remote (a click, a key bar key).
   */
  readonly keepContext: boolean;
}

/** Code points of context kept when a `keepContext` field is trimmed. */
const CONTEXT_TAIL = 24;

/** The last whole words of `body` (at most `CONTEXT_TAIL` code points). */
function contextTail(body: string): string {
  const c = cps(body);
  if (c.length <= CONTEXT_TAIL) return body;
  const tail = c.slice(-CONTEXT_TAIL);
  if (/\s/u.test(c[c.length - CONTEXT_TAIL - 1] ?? '')) return tail.join('');
  const gap = tail.findIndex((ch) => /\s/u.test(ch));
  return gap < 0 ? '' : tail.slice(gap + 1).join('');
}

export const DEFAULT_TEXT_INPUT_OPTIONS: TextInputOptions = {
  sentinel: DEFAULT_SENTINEL,
  maxLength: 64,
  composition: 'incremental',
  commit: 'live',
  flush: false,
  keepContext: false,
};

/** A word boundary for commit-on-word mode. */
const BOUNDARY = /[\s\p{P}\p{S}]/u;

export interface TextInputUpdate {
  /** Backspaces to send first. */
  readonly backspaces: number;
  /** Text to type after the Backspaces (never contains sentinel characters). */
  readonly text: string;
  /** Value the remote now mirrors; pass it as `baseline` next time. */
  readonly baseline: string;
  /**
   * Host should set the field to `baseline`, caret at end. That is the sentinel, or with
   * `keepContext` the sentinel followed by the last few words.
   */
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

  const word = opts.commit === 'word';
  const hold = { backspaces: 0, text: '', baseline, reset: false };
  if (composing && (opts.composition === 'commit' || (word && !opts.flush))) return hold;

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

  if (word && !opts.flush && backspaces === 0 && value.startsWith(sentinel)) {
    const typedLength = b.length - cps(sentinel).length;
    // Pure addition after what was sent, no boundary yet: keep it in the field.
    if (!BOUNDARY.test(text) && typedLength < opts.maxLength) return hold;
  }

  let reset = false;
  let next = sentinel;
  if (!composing) {
    const intact = value.startsWith(sentinel);
    const body = intact ? value.slice(sentinel.length) : '';
    const typedLength = b.length - cps(sentinel).length;
    const atSpace = /\s$/u.test(body);
    if (!intact || !opts.keepContext) {
      reset = !intact || atSpace || typedLength >= opts.maxLength;
    } else if (/[\n\r]$/u.test(body)) {
      reset = true;
    } else if ((typedLength >= opts.maxLength && atSpace) || typedLength >= opts.maxLength * 2) {
      // Long enough: keep the last few words so the keyboard still has its context.
      reset = true;
      next = sentinel + contextTail(body);
    }
  }
  return { backspaces, text, baseline: reset ? next : value, reset };
}

export interface CaretResync {
  /** Arrow presses to send: negative = Left, positive = Right. */
  readonly arrows: number;
  /** Put the caret back at the end of the field. */
  readonly restoreCaret: boolean;
  /** Reset the field and baseline to the sentinel (what is left of the caret is stale). */
  readonly reset: boolean;
}

const NO_RESYNC: CaretResync = { arrows: 0, restoreCaret: false, reset: false };

/**
 * The caret of the hidden field moved away from the end without the text changing (iOS
 * space-bar trackpad, Android cursor keys / swipe on the space bar, a long-press
 * selection). The remote caret sits at the end of what was typed, so:
 * - a collapsed caret moved left: the field is re-synced to the sentinel with the caret at
 *   the end, and nothing is sent, so the next keystrokes continue at the remote caret
 *   instead of producing a garbled diff (`followCaret` opts in to also moving the remote
 *   caret with `n` Left presses; not used by default because some keyboards park the caret
 *   transiently);
 * - a selection (non-collapsed) is just collapsed back to the end, nothing is sent;
 * - nothing happens while composing (IMEs move the selection inside their composition).
 * Positions are UTF-16 indices as reported by `selectionStart` / `selectionEnd`.
 */
export function caretResync(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  composing: boolean,
  sentinel: string = DEFAULT_SENTINEL,
  followCaret = false,
): CaretResync {
  if (composing) return NO_RESYNC;
  const end = value.length;
  if (selectionStart >= end && selectionEnd >= end) return NO_RESYNC;
  if (!Number.isFinite(selectionStart) || !Number.isFinite(selectionEnd)) return NO_RESYNC;
  if (selectionStart !== selectionEnd) return { arrows: 0, restoreCaret: true, reset: false };
  const from = Math.max(
    Math.min(selectionStart, end),
    value.startsWith(sentinel) ? sentinel.length : 0,
  );
  const n = cps(value.slice(from)).length;
  if (n === 0) return { arrows: 0, restoreCaret: true, reset: false };
  return { arrows: followCaret ? -n : 0, restoreCaret: true, reset: true };
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
