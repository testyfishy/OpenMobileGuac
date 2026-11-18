import type { MeasureText, Painter } from './painter.ts';

/**
 * Turns painted regions into PNG data. The demo server only talks to this interface, so
 * tests can stub it (see `testing.ts`) and the canvas lives in `canvasRenderer.ts`.
 */
export interface DemoRenderer {
  readonly measureText: MeasureText;
  /**
   * Paints the `w`×`h` region whose top-left corner is (`x`, `y`) in surface coordinates
   * and returns it as base64 PNG without a `data:` prefix. `paint` must be called
   * synchronously, before this returns, so it sees the current desktop state; only the
   * encoding may finish later.
   */
  renderPng(
    x: number,
    y: number,
    w: number,
    h: number,
    paint: (p: Painter) => void,
  ): string | Promise<string>;
}
