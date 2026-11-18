/**
 * High-DPI support for the demo desktop. The app asks for a desktop in device pixels and
 * sends `GUAC_DPI` = 96 × devicePixelRatio. Drawn 1:1, the demo's 12 px text would be tiny on
 * a phone, so the desktop is laid out in logical pixels (device ÷ scale) and every
 * instruction the server sends is multiplied back up: the UI keeps its normal size and is
 * drawn crisply at the device resolution. `DemoDesktop` only ever sees logical pixels; the
 * server converts at the wire boundary.
 */
import { clampSize, MAX_HEIGHT, MAX_WIDTH, MIN_HEIGHT, MIN_WIDTH } from './desktop.ts';
import { roundOut, type Rect } from './geometry.ts';

export const MAX_SCALE = 4;

/** Device pixels per logical pixel for a `GUAC_DPI` value: dpi / 96 within [1, 4]. */
export function scaleForDpi(dpi: number): number {
  if (!Number.isFinite(dpi) || dpi <= 0) return 1;
  return Math.max(1, Math.min(MAX_SCALE, dpi / 96));
}

/**
 * Lowers `scale` (not below 1) so a `width` × `height` device-pixel desktop still has the
 * minimum logical size.
 */
export function fitScale(scale: number, width: number, height: number): number {
  const s = Math.min(scale, width / MIN_WIDTH, height / MIN_HEIGHT);
  return Number.isFinite(s) ? Math.max(1, s) : 1;
}

export interface DemoSizes {
  /** Desktop size in logical pixels (what `DemoDesktop` uses). */
  readonly logical: { readonly width: number; readonly height: number };
  /** Size of layer 0 in device pixels: the requested size, when it was in range. */
  readonly device: { readonly width: number; readonly height: number };
}

/** Converts between logical and device pixels at a fixed scale. */
export class DemoScale {
  readonly scale: number;
  constructor(scale: number) {
    this.scale = Number.isFinite(scale) && scale >= 1 ? scale : 1;
  }

  get isInteger(): boolean {
    return Number.isInteger(this.scale);
  }

  /** A logical coordinate or length in device pixels. */
  dev(v: number): number {
    return Math.round(v * this.scale);
  }

  /** The device-pixel rectangle covering a logical one. */
  devRect(r: Rect): Rect {
    const s = this.scale;
    // Round edges to the nearest pixel first so tiny float errors do not add a column.
    const e = (v: number) => Math.round(v * s * 1e6) / 1e6;
    return roundOut({ x: e(r.x), y: e(r.y), w: e(r.x + r.w) - e(r.x), h: e(r.y + r.h) - e(r.y) });
  }

  /** A device-pixel coordinate from the client (pointer) in logical pixels. */
  toLogical(v: number): number {
    return Math.max(0, Math.floor(v / this.scale));
  }

  /**
   * Sizes for a requested device-pixel desktop. The logical size is rounded up, so layer 0
   * can be exactly the requested size and the app shows it without resampling.
   */
  sizes(width: number, height: number): DemoSizes {
    const req = clampSize(width, height);
    const dw = Math.min(MAX_WIDTH, req.width);
    const dh = Math.min(MAX_HEIGHT, req.height);
    const logical = clampSize(Math.ceil(dw / this.scale), Math.ceil(dh / this.scale));
    const fits = (dev: number, log: number) => Math.ceil(dev / this.scale) === log;
    return {
      logical,
      device: {
        width: fits(dw, logical.width) ? dw : this.dev(logical.width),
        height: fits(dh, logical.height) ? dh : this.dev(logical.height),
      },
    };
  }
}
