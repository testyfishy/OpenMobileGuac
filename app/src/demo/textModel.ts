/**
 * A plain-text editing model for the demo's Notes window. Positions are code-point indices,
 * so Backspace and the arrow keys treat an emoji or other astral character as one unit.
 * The selection runs between `anchor` and `caret`; it is empty when they are equal.
 */
export class TextModel {
  private cps: string[] = [];
  caret = 0;
  anchor = 0;

  constructor(text = '') {
    this.setText(text);
  }

  get text(): string {
    return this.cps.join('');
  }

  /** Code points, for layout. */
  get codePoints(): readonly string[] {
    return this.cps;
  }

  get length(): number {
    return this.cps.length;
  }

  setText(text: string): void {
    this.cps = Array.from(text);
    this.caret = this.anchor = this.cps.length;
  }

  hasSelection(): boolean {
    return this.caret !== this.anchor;
  }

  /** `[start, end)` of the selection. */
  selection(): [number, number] {
    return this.caret < this.anchor ? [this.caret, this.anchor] : [this.anchor, this.caret];
  }

  selectedText(): string {
    const [s, e] = this.selection();
    return this.cps.slice(s, e).join('');
  }

  selectAll(): void {
    this.anchor = 0;
    this.caret = this.cps.length;
  }

  /** Moves the caret to `index`; extends the selection when `extend` is set. */
  moveTo(index: number, extend = false): void {
    this.caret = Math.max(0, Math.min(this.cps.length, index));
    if (!extend) this.anchor = this.caret;
  }

  /** Inserts text at the caret, replacing any selection. */
  insert(text: string): void {
    const [s, e] = this.selection();
    const add = Array.from(text);
    // concat, not splice(...add): spreading a long paste would exceed the argument limit.
    this.cps = this.cps.slice(0, s).concat(add, this.cps.slice(e));
    this.caret = this.anchor = s + add.length;
  }

  deleteSelection(): boolean {
    if (!this.hasSelection()) return false;
    this.insert('');
    return true;
  }

  backspace(): void {
    if (this.deleteSelection() || this.caret === 0) return;
    this.cps.splice(this.caret - 1, 1);
    this.caret = this.anchor = this.caret - 1;
  }

  deleteForward(): void {
    if (this.deleteSelection() || this.caret >= this.cps.length) return;
    this.cps.splice(this.caret, 1);
  }

  left(extend = false): void {
    if (!extend && this.hasSelection()) return this.moveTo(this.selection()[0]);
    this.moveTo(this.caret - 1, extend);
  }

  right(extend = false): void {
    if (!extend && this.hasSelection()) return this.moveTo(this.selection()[1]);
    this.moveTo(this.caret + 1, extend);
  }
}

/** One visual line: code points `[start, end)`, excluding any newline. */
export interface TextLine {
  readonly start: number;
  readonly end: number;
}

/**
 * Wraps text to `width` pixels. Lines break at newlines, and otherwise after the last space
 * that fits, or mid-word if a word is wider than the line. Always returns at least one line.
 */
export function layoutText(
  cps: readonly string[],
  width: number,
  charWidth: (c: string) => number,
): TextLine[] {
  const lines: TextLine[] = [];
  let start = 0;
  let x = 0;
  let lastSpace = -1;
  for (let i = 0; i < cps.length; i++) {
    const c = cps[i] as string;
    if (c === '\n') {
      lines.push({ start, end: i });
      start = i + 1;
      x = 0;
      lastSpace = -1;
      continue;
    }
    const w = charWidth(c);
    if (x + w > width && i > start) {
      const breakAt = lastSpace >= start ? lastSpace + 1 : i;
      lines.push({ start, end: breakAt });
      start = breakAt;
      x = 0;
      for (let j = start; j < i; j++) x += charWidth(cps[j] as string);
      lastSpace = -1;
    }
    if (c === ' ') lastSpace = i;
    x += w;
  }
  lines.push({ start, end: cps.length });
  return lines;
}

/** Index of the visual line holding position `index`. */
export function lineIndexOf(lines: readonly TextLine[], index: number): number {
  for (let i = lines.length - 1; i > 0; i--) {
    if ((lines[i] as TextLine).start <= index) return i;
  }
  return 0;
}

/** Pixel offset of `index` within its line. */
export function xOfIndex(
  cps: readonly string[],
  line: TextLine,
  index: number,
  charWidth: (c: string) => number,
): number {
  let x = 0;
  for (let i = line.start; i < Math.min(index, line.end); i++) x += charWidth(cps[i] as string);
  return x;
}

/** The position in `line` closest to pixel offset `x`. */
export function indexAtX(
  cps: readonly string[],
  line: TextLine,
  x: number,
  charWidth: (c: string) => number,
): number {
  let pos = 0;
  for (let i = line.start; i < line.end; i++) {
    const w = charWidth(cps[i] as string);
    if (x < pos + w / 2) return i;
    pos += w;
  }
  return line.end;
}
