/**
 * Remote cursor images. Each is painted once into its own off-screen buffer layer (negative
 * index) and selected with `cursor,<hotX>,<hotY>,<layer>,0,0,<w>,<h>`. Original artwork.
 */
import type { CursorShape } from './desktop.ts';
import type { Painter } from './painter.ts';

export interface CursorImage {
  readonly w: number;
  readonly h: number;
  readonly hotX: number;
  readonly hotY: number;
  /** Buffer layer index (negative). */
  readonly buffer: number;
  paint(p: Painter): void;
}

export const CURSORS: Readonly<Record<CursorShape, CursorImage>> = {
  arrow: {
    w: 13,
    h: 20,
    hotX: 1,
    hotY: 1,
    buffer: -1,
    paint(p) {
      p.polygon(
        [1.5, 1.5, 1.5, 16.5, 5, 13, 8, 18.5, 10.5, 17.5, 7.5, 12, 12, 12],
        '#ffffff',
        '#101418',
      );
    },
  },
  text: {
    w: 9,
    h: 18,
    hotX: 4,
    hotY: 9,
    buffer: -2,
    paint(p) {
      for (const [color, w] of [
        ['#ffffff', 3],
        ['#101418', 1],
      ] as const) {
        p.line(4.5, 2, 4.5, 16, color, w);
        p.line(1, 1.5, 8, 1.5, color, w);
        p.line(1, 16.5, 8, 16.5, color, w);
      }
    },
  },
  move: {
    w: 19,
    h: 19,
    hotX: 9,
    hotY: 9,
    buffer: -3,
    paint(p) {
      const arrow = (pts: number[]) => p.polygon(pts, '#101418', '#ffffff');
      p.line(9.5, 3, 9.5, 16, '#ffffff', 4);
      p.line(3, 9.5, 16, 9.5, '#ffffff', 4);
      p.line(9.5, 3, 9.5, 16, '#101418', 2);
      p.line(3, 9.5, 16, 9.5, '#101418', 2);
      arrow([9.5, 0.5, 13, 4.5, 6, 4.5]);
      arrow([9.5, 18.5, 13, 14.5, 6, 14.5]);
      arrow([0.5, 9.5, 4.5, 6, 4.5, 13]);
      arrow([18.5, 9.5, 14.5, 6, 14.5, 13]);
    },
  },
};
