/**
 * The real `DemoRenderer`: paints into a 2D canvas and encodes PNG.
 *
 * Platform choice. The primary path is a detached `HTMLCanvasElement` and the synchronous
 * `toDataURL('image/png')`, which every WebView we target has supported for many years
 * (iOS WKWebView, Android System WebView) and which already yields base64. The fallback, when
 * there is no `document` (for example in a worker), is `OffscreenCanvas.convertToBlob`,
 * which is asynchronous; the server then waits for a frame's tiles before sending it, so
 * instruction order is kept. If neither exists, `createCanvasRenderer` throws and the tunnel
 * reports an error instead of hanging.
 */
import { bytesToBase64 } from './protocol.ts';
import type { FontSpec, Painter, TextAlign } from './painter.ts';
import type { DemoRenderer } from './renderer.ts';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const SANS =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", Arial, sans-serif';
const MONO =
  'ui-monospace, "SF Mono", Menlo, Consolas, "Roboto Mono", "DejaVu Sans Mono", "Noto Sans Mono", monospace';

export function cssFont(f: FontSpec): string {
  return `${f.bold ? '600 ' : ''}${f.size}px ${f.mono ? MONO : SANS}`;
}

/** A `Painter` over a 2D context. */
export class CanvasPainter implements Painter {
  private readonly ctx: Ctx2D;
  constructor(ctx: Ctx2D) {
    this.ctx = ctx;
  }

  fillRect(x: number, y: number, w: number, h: number, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, w, h);
  }

  strokeRect(x: number, y: number, w: number, h: number, color: string, lineWidth = 1): void {
    const c = this.ctx;
    c.strokeStyle = color;
    c.lineWidth = lineWidth;
    const i = lineWidth / 2;
    c.strokeRect(x + i, y + i, w - lineWidth, h - lineWidth);
  }

  fillGradient(
    x: number,
    y: number,
    w: number,
    h: number,
    stops: readonly (readonly [number, string])[],
    angle: number,
  ): void {
    const c = this.ctx;
    const rad = (angle * Math.PI) / 180;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const half = (Math.abs(Math.cos(rad)) * w + Math.abs(Math.sin(rad)) * h) / 2;
    const dx = Math.cos(rad) * half;
    const dy = Math.sin(rad) * half;
    const g = c.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    for (const [o, color] of stops) g.addColorStop(o, color);
    c.fillStyle = g;
    c.fillRect(x, y, w, h);
  }

  fillCircle(cx: number, cy: number, r: number, color: string): void {
    const c = this.ctx;
    c.fillStyle = color;
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.fill();
  }

  line(x1: number, y1: number, x2: number, y2: number, color: string, lineWidth = 1): void {
    const c = this.ctx;
    c.strokeStyle = color;
    c.lineWidth = lineWidth;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x2, y2);
    c.stroke();
  }

  polygon(points: readonly number[], fill: string, stroke?: string): void {
    const c = this.ctx;
    c.beginPath();
    for (let i = 0; i + 1 < points.length; i += 2) {
      const x = points[i] as number;
      const y = points[i + 1] as number;
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.closePath();
    c.fillStyle = fill;
    c.fill();
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = 1;
      c.lineJoin = 'round';
      c.stroke();
    }
  }

  text(
    text: string,
    x: number,
    cy: number,
    font: FontSpec,
    color: string,
    align: TextAlign = 'left',
  ): void {
    const c = this.ctx;
    c.font = cssFont(font);
    c.fillStyle = color;
    c.textAlign = align;
    c.textBaseline = 'middle';
    c.fillText(text, x, cy);
  }

  save(): void {
    this.ctx.save();
  }

  clip(x: number, y: number, w: number, h: number): void {
    const c = this.ctx;
    c.beginPath();
    c.rect(x, y, w, h);
    c.clip();
  }

  restore(): void {
    this.ctx.restore();
  }
}

/** Whether this environment can create a canvas renderer. */
export function canvasRendererAvailable(): boolean {
  return typeof document !== 'undefined' || typeof OffscreenCanvas !== 'undefined';
}

/** Creates the canvas renderer. Throws if no 2D canvas is available. */
export function createCanvasRenderer(): DemoRenderer {
  const hasDocument = typeof document !== 'undefined';
  if (!hasDocument && typeof OffscreenCanvas === 'undefined') {
    throw new Error('No canvas is available to draw the demo desktop');
  }

  const makeCanvas = (w: number, h: number): HTMLCanvasElement | OffscreenCanvas => {
    if (hasDocument) {
      const el = document.createElement('canvas');
      el.width = w;
      el.height = h;
      return el;
    }
    return new OffscreenCanvas(w, h);
  };
  const context = (canvas: HTMLCanvasElement | OffscreenCanvas): Ctx2D => {
    const ctx = canvas.getContext('2d') as Ctx2D | null;
    if (!ctx) throw new Error('2D canvas context unavailable');
    return ctx;
  };

  const measureCtx = context(makeCanvas(1, 1));
  const measureText = (text: string, font: FontSpec): number => {
    measureCtx.font = cssFont(font);
    return measureCtx.measureText(text).width;
  };

  // One reusable canvas on the synchronous path; resizing it also clears it.
  const shared = hasDocument ? (makeCanvas(1, 1) as HTMLCanvasElement) : null;

  return {
    measureText,
    renderPng(x, y, w, h, paint, scale = 1) {
      const canvas = shared ?? makeCanvas(w, h);
      canvas.width = w;
      canvas.height = h;
      const ctx = context(canvas);
      ctx.setTransform(scale, 0, 0, scale, -x, -y);
      paint(new CanvasPainter(ctx));
      if (shared) {
        const url = shared.toDataURL('image/png');
        const prefix = 'data:image/png;base64,';
        if (!url.startsWith(prefix)) throw new Error('Canvas PNG encoding failed');
        return url.slice(prefix.length);
      }
      return (canvas as OffscreenCanvas)
        .convertToBlob({ type: 'image/png' })
        .then((blob) => blob.arrayBuffer())
        .then((buf) => bytesToBase64(new Uint8Array(buf)));
    },
  };
}
