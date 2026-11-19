/**
 * TouchPassthrough (SPEC PTR-6): raw multi-touch to the remote instead of mouse emulation,
 * for RDP connections whose server declared multi-touch support.
 *
 * Pure: pointer samples (screen px) and the Viewport in, `TouchContact`s out. The host
 * turns each contact into a `Guacamole.Touch.State` and calls
 * `client.sendTouchState(state, false)` (coordinates are already remote px). Upstream's
 * `Guacamole.Touch` DOM handling is not used: in 1.6.0 its `touchstart` handler dispatches
 * "touchmove", so a consumer listening for touchstart never sees new contacts.
 *
 * Wire format (Client.js `sendTouchState`): `touch id x y radiusX radiusY angle force`,
 * where force 0 means the contact was lifted. Note `new Guacamole.Touch.State({force: 0})`
 * stores 1 (it uses `template.force || 1.0`), so the host must assign `force` after
 * construction.
 *
 * Rules: contact ids are small slots (lowest free integer from 0), reused after lift; at
 * most `maxTouches` contacts (what the server declared) are forwarded and extra fingers are
 * ignored until they lift; a contact that lands outside the remote content (letterbox) is
 * ignored; moves are clamped to the remote; unchanged moves are not resent; a cancel lifts
 * the contact. `releaseAll` lifts every contact (blur, mode switch, disconnect).
 */

import {
  clampToRemotePixel,
  isOverContent,
  scaleOf,
  screenToRemote,
  type ViewportState,
} from '../viewport/Viewport.ts';

export interface TouchInput {
  readonly id: number;
  readonly type: 'down' | 'move' | 'up' | 'cancel';
  /** Screen px. */
  readonly x: number;
  readonly y: number;
  /** Contact size in screen px (`PointerEvent.width/height`), 0 or absent if unknown. */
  readonly width?: number;
  readonly height?: number;
  /** `PointerEvent.pressure` (0..1), 0 or absent if unknown. */
  readonly pressure?: number;
}

export interface TouchContact {
  /** Slot id sent to the remote. */
  readonly id: number;
  /** Remote px (integers). */
  readonly x: number;
  readonly y: number;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly angle: number;
  /** 0 = lifted, otherwise (0, 1]. */
  readonly force: number;
}

/** Contact radius (screen px) when the device does not report the contact size. */
export const DEFAULT_CONTACT_RADIUS_PX = 12;

interface Active {
  readonly slot: number;
  last: TouchContact;
}

export class TouchPassthrough {
  private maxTouches: number;
  private readonly active = new Map<number, Active>();
  /** Pointer ids ignored until they lift (off-content or over the limit). */
  private readonly ignored = new Set<number>();

  constructor(maxTouches: number) {
    this.maxTouches = sanitizeMax(maxTouches);
  }

  setMaxTouches(n: number): void {
    this.maxTouches = sanitizeMax(n);
  }

  get activeCount(): number {
    return this.active.size;
  }

  handle(e: TouchInput, vp: ViewportState): TouchContact[] {
    if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) return [];
    switch (e.type) {
      case 'down':
        return this.down(e, vp);
      case 'move': {
        const a = this.active.get(e.id);
        if (!a) return [];
        const next = this.contact(a.slot, e, vp, forceOf(e.pressure));
        if (
          next.x === a.last.x &&
          next.y === a.last.y &&
          next.radiusX === a.last.radiusX &&
          next.radiusY === a.last.radiusY
        ) {
          return [];
        }
        a.last = next;
        return [next];
      }
      case 'up':
      case 'cancel': {
        if (this.ignored.delete(e.id)) return [];
        const a = this.active.get(e.id);
        if (!a) return [];
        this.active.delete(e.id);
        const lifted = e.type === 'up' ? this.contact(a.slot, e, vp, 0) : { ...a.last, force: 0 };
        return [lifted];
      }
    }
  }

  /** Lift every contact. */
  releaseAll(): TouchContact[] {
    const out: TouchContact[] = [];
    for (const a of this.active.values()) out.push({ ...a.last, force: 0 });
    this.active.clear();
    this.ignored.clear();
    return out;
  }

  private down(e: TouchInput, vp: ViewportState): TouchContact[] {
    const out: TouchContact[] = [];
    const existing = this.active.get(e.id);
    if (existing) {
      // Missed up for this id: lift it first.
      this.active.delete(e.id);
      out.push({ ...existing.last, force: 0 });
    }
    this.ignored.delete(e.id);
    if (!isOverContent(vp, e) || this.active.size >= this.maxTouches) {
      this.ignored.add(e.id);
      return out;
    }
    const slot = this.freeSlot();
    const c = this.contact(slot, e, vp, forceOf(e.pressure));
    this.active.set(e.id, { slot, last: c });
    out.push(c);
    return out;
  }

  private freeSlot(): number {
    const used = new Set([...this.active.values()].map((a) => a.slot));
    let s = 0;
    while (used.has(s)) s++;
    return s;
  }

  private contact(slot: number, e: TouchInput, vp: ViewportState, force: number): TouchContact {
    const p = clampToRemotePixel(vp, screenToRemote(vp, e));
    const scale = scaleOf(vp);
    const k = scale > 0 ? 1 / scale : 1;
    const rx = positive(e.width) ? (e.width as number) / 2 : DEFAULT_CONTACT_RADIUS_PX;
    const ry = positive(e.height) ? (e.height as number) / 2 : DEFAULT_CONTACT_RADIUS_PX;
    return {
      id: slot,
      x: p.x,
      y: p.y,
      radiusX: Math.max(1, Math.round(rx * k)),
      radiusY: Math.max(1, Math.round(ry * k)),
      angle: 0,
      force,
    };
  }
}

function positive(v: number | undefined): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function forceOf(pressure: number | undefined): number {
  return positive(pressure) ? Math.min(1, pressure as number) : 1;
}

function sanitizeMax(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
