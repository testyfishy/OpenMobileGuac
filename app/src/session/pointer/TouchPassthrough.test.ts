import { describe, expect, it } from 'vitest';
import { createViewport } from '../viewport/Viewport.ts';
import {
  DEFAULT_CONTACT_RADIUS_PX,
  TouchPassthrough,
  type TouchInput,
} from './TouchPassthrough.ts';

// Remote 2000×1000 on a 1000×500 screen: scale 0.5.
const vp = createViewport({
  remote: { width: 2000, height: 1000 },
  screen: { width: 1000, height: 500 },
});

const t = (
  type: TouchInput['type'],
  id: number,
  x: number,
  y: number,
  extra: Partial<TouchInput> = {},
) => ({ type, id, x, y, ...extra }) as TouchInput;

describe('TouchPassthrough (PTR-6)', () => {
  it('maps contacts to remote px with small slot ids, force 0 on lift', () => {
    const tp = new TouchPassthrough(10);
    const a = tp.handle(t('down', 41, 100, 100, { width: 20, height: 10, pressure: 0.5 }), vp);
    expect(a).toEqual([{ id: 0, x: 200, y: 200, radiusX: 20, radiusY: 10, angle: 0, force: 0.5 }]);
    const b = tp.handle(t('down', 77, 300, 100), vp);
    expect(b[0]).toMatchObject({ id: 1, x: 600, y: 200, force: 1 });
    expect(b[0]?.radiusX).toBe(DEFAULT_CONTACT_RADIUS_PX * 2);
    expect(tp.handle(t('up', 41, 110, 100), vp)).toEqual([
      {
        id: 0,
        x: 220,
        y: 200,
        radiusX: DEFAULT_CONTACT_RADIUS_PX * 2,
        radiusY: DEFAULT_CONTACT_RADIUS_PX * 2,
        angle: 0,
        force: 0,
      },
    ]);
    // Slot 0 is free again.
    expect(tp.handle(t('down', 99, 50, 50), vp)[0]?.id).toBe(0);
  });

  it('does not resend unchanged moves; clamps to the remote', () => {
    const tp = new TouchPassthrough(2);
    tp.handle(t('down', 1, 100, 100), vp);
    expect(tp.handle(t('move', 1, 100, 100), vp)).toEqual([]);
    expect(tp.handle(t('move', 1, 5000, -50), vp)[0]).toMatchObject({ x: 1999, y: 0 });
  });

  it('respects the declared limit and ignores letterbox landings', () => {
    const tp = new TouchPassthrough(1);
    tp.handle(t('down', 1, 100, 100), vp);
    expect(tp.handle(t('down', 2, 200, 100), vp)).toEqual([]);
    expect(tp.handle(t('move', 2, 210, 100), vp)).toEqual([]);
    expect(tp.handle(t('up', 2, 210, 100), vp)).toEqual([]);
    const letterboxed = createViewport({
      remote: { width: 1000, height: 500 },
      screen: { width: 500, height: 600 },
    });
    const tp2 = new TouchPassthrough(5);
    expect(tp2.handle(t('down', 1, 250, 20), letterboxed)).toEqual([]);
  });

  it('cancel and releaseAll lift every contact', () => {
    const tp = new TouchPassthrough(5);
    tp.handle(t('down', 1, 100, 100), vp);
    tp.handle(t('down', 2, 200, 100), vp);
    expect(tp.handle(t('cancel', 1, 0, 0), vp)).toEqual([
      expect.objectContaining({ id: 0, x: 200, y: 200, force: 0 }),
    ]);
    expect(tp.releaseAll()).toEqual([expect.objectContaining({ id: 1, force: 0 })]);
    expect(tp.activeCount).toBe(0);
  });

  it('a zero limit forwards nothing', () => {
    const tp = new TouchPassthrough(0);
    expect(tp.handle(t('down', 1, 100, 100), vp)).toEqual([]);
  });
});
