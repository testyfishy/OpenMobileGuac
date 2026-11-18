/**
 * Canvas-free stand-ins for tests (here and in UI code): a painter that records calls and
 * a renderer whose "PNG" is a base64 label naming the tile.
 */
import type { FontSpec, Painter, TextAlign } from './painter.ts';
import type { DemoRenderer } from './renderer.ts';

export type PaintCall = { readonly op: string; readonly args: readonly unknown[] };

export class RecordingPainter implements Painter {
  readonly calls: PaintCall[] = [];
  private rec(op: string, args: unknown[]): void {
    this.calls.push({ op, args });
  }
  fillRect(...a: [number, number, number, number, string]): void {
    this.rec('fillRect', a);
  }
  strokeRect(...a: [number, number, number, number, string, number?]): void {
    this.rec('strokeRect', a);
  }
  fillGradient(
    ...a: [number, number, number, number, readonly (readonly [number, string])[], number]
  ): void {
    this.rec('fillGradient', a);
  }
  fillCircle(...a: [number, number, number, string]): void {
    this.rec('fillCircle', a);
  }
  line(...a: [number, number, number, number, string, number?]): void {
    this.rec('line', a);
  }
  polygon(...a: [readonly number[], string, string?]): void {
    this.rec('polygon', a);
  }
  text(
    text: string,
    x: number,
    cy: number,
    font: FontSpec,
    color: string,
    align?: TextAlign,
  ): void {
    this.rec('text', [text, x, cy, font, color, align]);
  }
  save(): void {
    this.rec('save', []);
  }
  clip(...a: [number, number, number, number]): void {
    this.rec('clip', a);
  }
  restore(): void {
    this.rec('restore', []);
  }
  /** Every string drawn with `text`. */
  texts(): string[] {
    return this.calls.filter((c) => c.op === 'text').map((c) => c.args[0] as string);
  }
}

/** Fixed-pitch measuring: 7 px per code point at 12 px, scaled with the font size. */
export const stubMeasure = (text: string, font: FontSpec): number =>
  Array.from(text).length * Math.round((font.size * 7) / 12);

export interface StubRenderer extends DemoRenderer {
  /** Every region rendered, with the painter used. */
  readonly renders: { x: number; y: number; w: number; h: number; painter: RecordingPainter }[];
}

/**
 * A renderer that records each region and returns `btoa("tile x,y wxh")` as its PNG. With
 * `async: true` the data arrives in a resolved promise, like the `OffscreenCanvas` path.
 */
export function createStubRenderer(options: { async?: boolean } = {}): StubRenderer {
  const renders: StubRenderer['renders'] = [];
  return {
    renders,
    measureText: stubMeasure,
    renderPng(x, y, w, h, paint) {
      const painter = new RecordingPainter();
      paint(painter);
      renders.push({ x, y, w, h, painter });
      const data = btoa(`tile ${x},${y} ${w}x${h}`);
      return options.async ? Promise.resolve(data) : data;
    },
  };
}
