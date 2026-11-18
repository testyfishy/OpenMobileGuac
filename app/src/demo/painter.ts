/**
 * The small drawing API the demo desktop paints with. The canvas implementation is in
 * `canvasRenderer.ts`; tests use `RecordingPainter` (see `testing.ts`). Keeping the desktop
 * behind this interface means its logic never touches a canvas.
 *
 * Coordinates are in pixels of the surface being painted. Colours are CSS colour strings.
 */

export interface FontSpec {
  /** Pixel size. */
  readonly size: number;
  readonly bold?: boolean;
  /** Monospaced instead of the UI sans-serif. */
  readonly mono?: boolean;
}

export type TextAlign = 'left' | 'center' | 'right';

export interface Painter {
  fillRect(x: number, y: number, w: number, h: number, color: string): void;
  /** A 1-pixel-aligned outline drawn inside the rectangle. */
  strokeRect(x: number, y: number, w: number, h: number, color: string, lineWidth?: number): void;
  /** A gradient fill. `angle` is in degrees: 0 is left to right, 90 top to bottom. */
  fillGradient(
    x: number,
    y: number,
    w: number,
    h: number,
    stops: readonly (readonly [number, string])[],
    angle: number,
  ): void;
  fillCircle(cx: number, cy: number, r: number, color: string): void;
  line(x1: number, y1: number, x2: number, y2: number, color: string, lineWidth?: number): void;
  /** A closed polygon from `[x0, y0, x1, y1, ...]`, filled and optionally outlined. */
  polygon(points: readonly number[], fill: string, stroke?: string): void;
  /** Draws one line of text vertically centred on `cy`. */
  text(text: string, x: number, cy: number, font: FontSpec, color: string, align?: TextAlign): void;
  /** Restricts drawing to a rectangle until the matching `restore`. */
  save(): void;
  clip(x: number, y: number, w: number, h: number): void;
  restore(): void;
}

/** Measures the advance width of `text` in pixels. */
export type MeasureText = (text: string, font: FontSpec) => number;
