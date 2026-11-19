/**
 * Last-screen thumbnails (CON-4), captured by the shell from the session's DOM.
 *
 * Interim approach: `SessionScreen` does not expose a capture hook yet, so this draws the
 * largest canvas inside the session's display (Guacamole's default layer) into a small JPEG.
 * Cursor and secondary layers are not included. Replace with `SessionScreen`'s own
 * `captureThumbnail` once it exists (see the report / docs/checklists/app-device.md).
 */

export const THUMB_WIDTH = 320;

export function captureThumbnail(root: HTMLElement | null): string | undefined {
  if (!root) return undefined;
  const canvases = [...root.querySelectorAll<HTMLCanvasElement>('.omg-display canvas, canvas')];
  let best: HTMLCanvasElement | undefined;
  for (const c of canvases) {
    if (c.width < 16 || c.height < 16) continue;
    if (!best || c.width * c.height > best.width * best.height) best = c;
  }
  if (!best) return undefined;
  const scale = Math.min(1, THUMB_WIDTH / best.width);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(best.width * scale));
  out.height = Math.max(1, Math.round(best.height * scale));
  const ctx = out.getContext('2d');
  if (!ctx) return undefined;
  try {
    ctx.drawImage(best, 0, 0, out.width, out.height);
    const url = out.toDataURL('image/jpeg', 0.6);
    return url.startsWith('data:image/jpeg') ? url : undefined;
  } catch {
    // A tainted canvas (should not happen: Guacamole draws from blobs) or no memory.
    return undefined;
  }
}
