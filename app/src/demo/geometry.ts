/** Integer rectangles used for layout, hit-testing and damage tracking. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export function rect(x: number, y: number, w: number, h: number): Rect {
  return { x, y, w, h };
}

export function contains(r: Rect, px: number, py: number): boolean {
  return px >= r.x && py >= r.y && px < r.x + r.w && py < r.y + r.h;
}

export function isEmpty(r: Rect): boolean {
  return r.w <= 0 || r.h <= 0;
}

export function intersect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return { x, y, w: Math.max(0, w), h: Math.max(0, h) };
}

export function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

export function overlaps(a: Rect, b: Rect): boolean {
  return !isEmpty(intersect(a, b));
}

export function offset(r: Rect, dx: number, dy: number): Rect {
  return { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h };
}

/** Rounds outwards to whole pixels. */
export function roundOut(r: Rect): Rect {
  const x = Math.floor(r.x);
  const y = Math.floor(r.y);
  return { x, y, w: Math.ceil(r.x + r.w) - x, h: Math.ceil(r.y + r.h) - y };
}

/**
 * Merges a damage list: overlapping or touching rectangles are combined when their union
 * adds little area, and if the list is still long it collapses to its bounding box. Empty
 * rectangles are dropped.
 */
export function mergeRects(rects: readonly Rect[], maxCount = 8): Rect[] {
  const area = (r: Rect) => r.w * r.h;
  const out: Rect[] = [];
  for (const r of rects) {
    if (isEmpty(r)) continue;
    let cur = r;
    for (let i = 0; i < out.length;) {
      const o = out[i] as Rect;
      const grown = { x: o.x - 1, y: o.y - 1, w: o.w + 2, h: o.h + 2 };
      const u = union(o, cur);
      if (overlaps(grown, cur) && area(u) <= (area(o) + area(cur)) * 1.25) {
        cur = u;
        out.splice(i, 1);
        i = 0;
      } else {
        i++;
      }
    }
    out.push(cur);
  }
  if (out.length > maxCount) return [out.reduce(union)];
  return out;
}

/** Splits a rectangle into tiles no larger than `size` on either side. */
export function tiles(r: Rect, size: number): Rect[] {
  const out: Rect[] = [];
  for (let y = r.y; y < r.y + r.h; y += size) {
    for (let x = r.x; x < r.x + r.w; x += size) {
      out.push({ x, y, w: Math.min(size, r.x + r.w - x), h: Math.min(size, r.y + r.h - y) });
    }
  }
  return out;
}
