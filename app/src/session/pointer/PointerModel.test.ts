import { describe, expect, it } from 'vitest';
import {
  GestureRecognizer,
  type Gesture,
  type GestureConfig,
  type PointerInput,
} from '../gesture/GestureRecognizer.ts';
import {
  applyViewportCommands,
  createViewport,
  isFlinging,
  relayout,
  remoteToScreen,
  scaleOf,
  visibleRect,
  zoomAt,
  type CreateViewportOptions,
  type ViewportState,
} from '../viewport/Viewport.ts';
import {
  PointerModel,
  ScrollAccumulator,
  accelerationGain,
  mapHardwareMouse,
  wheelStates,
  type HapticHint,
  type MouseState,
  type PointerConfig,
} from './PointerModel.ts';

// ---------------------------------------------------------------------------------------
// End-to-end harness: pointer events → GestureRecognizer → PointerModel → Viewport.

// Remote 2000×1000 on a 1000×500 screen: fit-screen scale 0.5, no letterbox.
const VP: CreateViewportOptions = {
  remote: { width: 2000, height: 1000 },
  screen: { width: 1000, height: 500 },
};

class Harness {
  readonly rec: GestureRecognizer;
  readonly pm: PointerModel;
  vp: ViewportState;
  mouse: MouseState[] = [];
  haptics: HapticHint[] = [];
  gestures: Gesture[] = [];

  constructor(
    pm: Partial<PointerConfig> = {},
    vp: CreateViewportOptions = VP,
    rec: Partial<GestureConfig> = {},
  ) {
    this.pm = new PointerModel(pm);
    this.rec = new GestureRecognizer({ ...this.pm.recognizerOptions(), ...rec });
    this.vp = createViewport(vp);
  }

  private feed(gs: Gesture[]) {
    for (const g of gs) {
      this.gestures.push(g);
      const out = this.pm.handle(g, this.vp);
      this.mouse.push(...out.mouse);
      this.haptics.push(...out.haptics);
      this.vp = applyViewportCommands(this.vp, out.viewport);
    }
  }

  ev(type: PointerInput['type'], id: number, x: number, y: number, t: number) {
    this.feed(this.rec.handle({ id, type, x, y, timeMs: t, pointerType: 'touch' }));
    return this;
  }
  down(id: number, x: number, y: number, t: number) {
    return this.ev('down', id, x, y, t);
  }
  move(id: number, x: number, y: number, t: number) {
    return this.ev('move', id, x, y, t);
  }
  up(id: number, x: number, y: number, t: number) {
    return this.ev('up', id, x, y, t);
  }
  cancel(id: number, x: number, y: number, t: number) {
    return this.ev('cancel', id, x, y, t);
  }
  tick(t: number) {
    this.feed(this.rec.tick(t));
    return this;
  }
  /** Slow drag of one finger in small steps (velocity ≈ 0 → no acceleration). */
  slowDrag(id: number, from: [number, number], to: [number, number], t0: number, steps = 10) {
    for (let i = 1; i <= steps; i++) {
      const x = from[0] + ((to[0] - from[0]) * i) / steps;
      const y = from[1] + ((to[1] - from[1]) * i) / steps;
      this.move(id, x, y, t0 + i * 100);
    }
    return t0 + steps * 100;
  }
  take() {
    const m = this.mouse;
    this.mouse = [];
    return m;
  }
}

function ms(x: number, y: number, b: Partial<MouseState> = {}): MouseState {
  return { x, y, left: false, middle: false, right: false, up: false, down: false, ...b };
}

/** Compact rendering: "x,y" + button letters (L/M/R/U/D). */
function fmt(states: MouseState[]): string[] {
  return states.map(
    (s) =>
      `${s.x},${s.y}` +
      (s.left ? 'L' : '') +
      (s.middle ? 'M' : '') +
      (s.right ? 'R' : '') +
      (s.up ? 'U' : '') +
      (s.down ? 'D' : ''),
  );
}

// ---------------------------------------------------------------------------------------
// PTR-1 direct mode

describe('PTR-1 direct touch mode (end to end)', () => {
  it('tap = left click at the touched remote point', () => {
    const h = new Harness().down(1, 100, 100, 0).up(1, 101, 100, 60);
    expect(fmt(h.mouse)).toEqual(['200,200', '200,200L', '200,200']);
    expect(h.haptics).toEqual(['click']);
  });

  it('double tap = double click on the first tap pixel', () => {
    const h = new Harness()
      .down(1, 100, 100, 0)
      .up(1, 100, 100, 60)
      .down(2, 108, 104, 160)
      .up(2, 108, 104, 210);
    expect(fmt(h.mouse)).toEqual(['200,200', '200,200L', '200,200', '200,200L', '200,200']);
    expect(h.haptics).toEqual(['click', 'click']);
  });

  it('long press = right click on release (haptic while held)', () => {
    const h = new Harness().down(1, 300, 200, 0).tick(500);
    expect(h.mouse).toEqual([]);
    expect(h.haptics).toEqual(['right-click']);
    h.up(1, 300, 200, 800);
    expect(fmt(h.mouse)).toEqual(['600,400', '600,400R', '600,400']);
    expect(h.haptics).toEqual(['right-click']);
  });

  it('long press then move = left drag (no right click)', () => {
    const h = new Harness().down(1, 300, 200, 0).tick(500);
    h.move(1, 320, 200, 600).move(1, 350, 250, 650).up(1, 350, 250, 700);
    expect(fmt(h.mouse)).toEqual(['600,400', '600,400L', '640,400L', '700,500L', '700,500']);
    expect(h.haptics).toEqual(['right-click', 'drag-start']);
    expect(h.mouse.some((s) => s.right)).toBe(false);
  });

  it('two-finger drag = scroll wheel at the centroid (natural direction)', () => {
    const h = new Harness()
      .down(1, 100, 300, 0)
      .down(2, 200, 300, 10)
      .move(1, 100, 260, 30)
      .move(2, 200, 260, 40) // centroid moved 40 up → start + 1 notch (30 px)
      .move(1, 100, 230, 50)
      .move(2, 200, 230, 60); // centroid moved 70 total → 2 notches
    const states = h.take();
    expect(fmt(states)).toEqual(['300,600', '300,600D', '300,600', '300,600D', '300,600']);
    h.up(1, 100, 230, 80).up(2, 200, 230, 90);
    expect(h.take()).toEqual([]);
  });

  it('pinch = zoom about the fingers, no mouse output', () => {
    const h = new Harness().down(1, 400, 250, 0).down(2, 600, 250, 0);
    const before = h.vp;
    h.move(1, 300, 250, 30).move(2, 700, 250, 40).up(1, 300, 250, 50).up(2, 700, 250, 50);
    expect(h.mouse).toEqual([]);
    expect(h.vp.zoom).toBeCloseTo(2, 6);
    // The remote point under the original focal (500, 250) is still there.
    const focalRemote = { x: (500 - before.offsetX) / scaleOf(before), y: 500 };
    expect(remoteToScreen(h.vp, focalRemote).x).toBeCloseTo(500, 6);
  });

  it('one-finger pan moves the viewport when zoomed in, with fling on release', () => {
    const h = new Harness();
    h.vp = zoomAt(h.vp, 4, { x: 500, y: 250 });
    const ox = h.vp.offsetX;
    h.down(1, 500, 250, 0).move(1, 520, 250, 10).move(1, 560, 250, 20).up(1, 600, 250, 30);
    expect(h.mouse).toEqual([]);
    expect(h.vp.offsetX - ox).toBeCloseTo(100, 6);
    expect(isFlinging(h.vp)).toBe(true);
    // Touching again stops the fling.
    h.down(2, 500, 250, 40).move(2, 540, 250, 50);
    expect(isFlinging(h.vp)).toBe(false);
  });

  it('one-finger pan can be configured to left-drag instead', () => {
    const h = new Harness({ directPan: 'drag' });
    h.down(1, 100, 100, 0).move(1, 150, 100, 30).up(1, 150, 100, 60);
    expect(fmt(h.mouse)).toEqual(['200,200', '200,200L', '300,200L', '300,200']);
    expect(h.haptics).toEqual(['drag-start']);
  });

  it('taps on letterbox bars are ignored; drags starting there do nothing', () => {
    const h = new Harness(
      {},
      { remote: { width: 1000, height: 500 }, screen: { width: 500, height: 600 } },
    );
    // scale 0.5, content 500×250 centred vertically at y = 175..425
    h.down(1, 250, 50, 0).up(1, 250, 50, 50);
    h.down(2, 250, 50, 1000).tick(1500).up(2, 250, 50, 1600);
    h.down(3, 250, 50, 3000).tick(3500).move(3, 250, 300, 3600).up(3, 250, 300, 3700);
    expect(h.mouse).toEqual([]);
    h.down(4, 250, 300, 5000).up(4, 250, 300, 5050);
    expect(fmt(h.mouse)).toEqual(['500,250', '500,250L', '500,250']);
  });

  it('drag clamps to the remote edge when the finger leaves the content', () => {
    const h = new Harness({ directPan: 'drag' });
    h.down(1, 900, 400, 0).move(1, 2000, 2000, 30).up(1, 2000, 2000, 60);
    expect(fmt(h.mouse)).toEqual(['1800,800', '1800,800L', '1999,999L', '1999,999']);
  });

  it('two/three-finger taps do nothing in direct mode', () => {
    const h = new Harness()
      .down(1, 100, 100, 0)
      .down(2, 200, 100, 10)
      .up(1, 100, 100, 60)
      .up(2, 200, 100, 70);
    expect(h.mouse).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// PTR-2 trackpad mode

describe('PTR-2 trackpad mode (end to end)', () => {
  const tp = (cfg: Partial<PointerConfig> = {}, vp?: CreateViewportOptions) =>
    new Harness({ mode: 'trackpad', ...cfg }, vp);

  it('one-finger move = relative pointer move (screen terms: ÷ scale)', () => {
    const h = tp().down(1, 100, 100, 0);
    h.slowDrag(1, [100, 100], [140, 120], 0);
    h.up(1, 140, 120, 2000);
    // Pointer starts at the remote centre (1000, 500); 40×20 screen px at scale 0.5.
    expect(h.mouse[h.mouse.length - 1]).toEqual(ms(1080, 540));
    expect(h.haptics).toEqual([]);
  });

  it('tap = left click at the pointer, after the double-tap window', () => {
    const h = tp().down(1, 700, 400, 0).up(1, 700, 400, 50);
    expect(h.mouse).toEqual([]);
    h.tick(350);
    expect(fmt(h.mouse)).toEqual(['1000,500L', '1000,500']);
    expect(h.haptics).toEqual(['click']);
  });

  it('double tap = double click at the pointer', () => {
    const h = tp()
      .down(1, 700, 400, 0)
      .up(1, 700, 400, 50)
      .down(2, 705, 400, 150)
      .up(2, 705, 400, 200);
    expect(fmt(h.mouse)).toEqual(['1000,500L', '1000,500', '1000,500L', '1000,500']);
  });

  it('two-finger tap = right click at the pointer', () => {
    const h = tp()
      .down(1, 100, 100, 0)
      .down(2, 200, 100, 10)
      .up(1, 100, 100, 80)
      .up(2, 200, 100, 90);
    expect(fmt(h.mouse)).toEqual(['1000,500R', '1000,500']);
    expect(h.haptics).toEqual(['right-click']);
  });

  it('three-finger tap = middle click at the pointer', () => {
    const h = tp()
      .down(1, 100, 100, 0)
      .down(2, 200, 100, 10)
      .down(3, 300, 100, 20)
      .up(1, 100, 100, 80)
      .up(2, 200, 100, 85)
      .up(3, 300, 100, 90);
    expect(fmt(h.mouse)).toEqual(['1000,500M', '1000,500']);
  });

  it('two-finger drag = scroll at the pointer; reversed direction option', () => {
    const run = (naturalScroll: boolean) =>
      tp({ naturalScroll })
        .down(1, 100, 100, 0)
        .down(2, 200, 100, 0)
        .move(1, 100, 140, 20)
        .move(2, 200, 140, 30)
        .up(1, 100, 140, 40)
        .up(2, 200, 140, 40).mouse;
    // Fingers moved down 40 px: natural = wheel up (content follows the fingers).
    expect(fmt(run(true))).toEqual(['1000,500U', '1000,500']);
    expect(fmt(run(false))).toEqual(['1000,500D', '1000,500']);
  });

  it('double-tap-and-hold then move = left drag, with no stray click', () => {
    const h = tp().down(1, 500, 250, 0).up(1, 500, 250, 50).down(2, 500, 250, 150);
    h.slowDrag(2, [500, 250], [550, 250], 150, 5);
    h.up(2, 550, 250, 1000).tick(5000);
    const f = fmt(h.mouse);
    expect(f[0]).toBe('1000,500L');
    expect(f[f.length - 1]).toBe('1100,500');
    expect(f.slice(1, -1).every((s) => s.endsWith('L'))).toBe(true);
    expect(h.mouse.filter((s) => s.left).length).toBeGreaterThan(1);
    expect(h.haptics).toEqual(['drag-start']);
  });

  it('double-tap-and-hold without moving still starts a drag after tapMaxMs', () => {
    const h = tp().down(1, 500, 250, 0).up(1, 500, 250, 50).down(2, 500, 250, 150).tick(450);
    expect(fmt(h.mouse)).toEqual(['1000,500L']);
    h.up(2, 500, 250, 900);
    expect(fmt(h.mouse)).toEqual(['1000,500L', '1000,500']);
  });

  it('long press = drag by default; right click when configured', () => {
    const h = tp().down(1, 500, 250, 0).tick(500);
    expect(fmt(h.mouse)).toEqual(['1000,500L']);
    h.slowDrag(1, [500, 250], [500, 300], 500, 5);
    h.up(1, 500, 300, 2000);
    expect(fmt(h.mouse).at(-1)).toBe('1000,600');

    const r = tp({ trackpadLongPress: 'right-click' })
      .down(1, 500, 250, 0)
      .tick(500)
      .up(1, 500, 250, 700);
    expect(fmt(r.mouse)).toEqual(['1000,500R', '1000,500']);
    expect(r.haptics).toEqual(['right-click']);
  });

  it('pinch = zoom', () => {
    const h = tp()
      .down(1, 400, 250, 0)
      .down(2, 600, 250, 0)
      .move(1, 300, 250, 30)
      .move(2, 700, 250, 40);
    expect(h.vp.zoom).toBeCloseTo(2, 6);
    expect(h.mouse).toEqual([]);
  });

  it('pointer speed scales motion and acceleration boosts fast flicks', () => {
    const slow = tp({ pointerSpeed: 2 }).down(1, 100, 100, 0);
    slow.slowDrag(1, [100, 100], [120, 100], 0);
    expect(slow.mouse.at(-1)?.x).toBe(1000 + 20 * 2 * 2);

    const fast = tp().down(1, 100, 100, 0).move(1, 140, 100, 10).move(1, 180, 100, 20);
    const slow2 = tp().down(1, 100, 100, 0);
    slow2.slowDrag(1, [100, 100], [180, 100], 0);
    expect(fast.mouse.at(-1)?.x ?? 0).toBeGreaterThan(slow2.mouse.at(-1)?.x ?? 0);

    const linear = tp({ pointerAcceleration: 0 })
      .down(1, 100, 100, 0)
      .move(1, 140, 100, 10)
      .move(1, 180, 100, 20);
    expect(linear.mouse.at(-1)?.x).toBe(1000 + 80 * 2);
  });

  it('motion is the same in screen terms at any zoom', () => {
    const a = tp().down(1, 100, 100, 0);
    a.slowDrag(1, [100, 100], [140, 100], 0);
    const b = tp();
    b.vp = zoomAt(b.vp, 2, { x: 500, y: 250 });
    b.down(1, 100, 100, 0);
    b.slowDrag(1, [100, 100], [140, 100], 0);
    expect((a.mouse.at(-1)?.x ?? 0) - 1000).toBe(80);
    expect((b.mouse.at(-1)?.x ?? 0) - 1000).toBe(40);
  });

  it('sub-pixel moves accumulate (precise nudge, S4)', () => {
    const h = tp({}, { ...VP, mode: 'one-to-one' });
    h.vp = zoomAt(h.vp, 8, { x: 500, y: 250 }); // 8 screen px per remote px
    h.down(1, 100, 100, 0);
    h.slowDrag(1, [100, 100], [140, 100], 0, 40); // 1 screen px per move
    expect(h.mouse.at(-1)?.x).toBe(1005);
  });

  it('follow-pointer keeps the pointer visible while zoomed', () => {
    const h = tp();
    h.vp = zoomAt(h.vp, 4, { x: 500, y: 250 });
    h.down(1, 100, 100, 0);
    h.slowDrag(1, [100, 100], [900, 100], 0, 40);
    const p = h.mouse.at(-1);
    if (!p) throw new Error('no state');
    const sp = remoteToScreen(h.vp, p);
    expect(sp.x).toBeLessThanOrEqual(1000 - 48 + 1);
    expect(sp.x).toBeGreaterThanOrEqual(0);
  });

  it('keeps the pointer above the soft keyboard (DSP-5)', () => {
    const h = tp();
    h.vp = relayout(zoomAt(h.vp, 2, { x: 500, y: 250 }), { keyboardInset: 200 });
    h.down(1, 100, 100, 0);
    h.slowDrag(1, [100, 100], [100, 400], 0, 30);
    const p = h.mouse.at(-1);
    if (!p) throw new Error('no state');
    const vis = visibleRect(h.vp);
    expect(remoteToScreen(h.vp, p).y).toBeLessThanOrEqual(vis.y + vis.height - 48 + 1);
  });

  it('pointer is clamped to the remote bounds', () => {
    const h = tp().down(1, 0, 0, 0);
    h.slowDrag(1, [0, 0], [-3000, -3000], 0, 10);
    expect(h.mouse.at(-1)).toEqual(ms(0, 0));
  });
});

// ---------------------------------------------------------------------------------------
// Scroll and options

describe('scroll and options (PTR-7)', () => {
  it('accumulates distance across moves into notches; remainder dropped at end', () => {
    const acc = new ScrollAccumulator(30);
    expect([acc.add(20), acc.add(20), acc.add(20), acc.add(-50)]).toEqual([0, 1, 1, -1]);
    acc.reset();
    expect(acc.add(29)).toBe(0);
    expect(acc.add(Number.NaN)).toBe(0);
    expect(new ScrollAccumulator(0).add(3)).toBe(3);
  });

  it('two-finger drag can pan the viewport instead of scrolling', () => {
    const h = new Harness({ twoFingerPan: 'viewport' });
    h.vp = zoomAt(h.vp, 4, { x: 500, y: 250 });
    const oy = h.vp.offsetY;
    h.down(1, 100, 100, 0).down(2, 200, 100, 0).move(1, 100, 140, 20).move(2, 200, 140, 30);
    expect(h.mouse).toEqual([]);
    expect(h.vp.offsetY - oy).toBeCloseTo(40, 6);
  });

  it('wheelStates keeps held buttons and caps runaway counts', () => {
    expect(fmt(wheelStates(ms(1, 2, { left: true }), -2))).toEqual([
      '1,2LU',
      '1,2L',
      '1,2LU',
      '1,2L',
    ]);
    expect(wheelStates(ms(0, 0), 1e9)).toHaveLength(200);
    expect(wheelStates(ms(0, 0), 0)).toEqual([]);
  });

  it('accelerationGain is monotonic and bounded', () => {
    const cfg = { pointerSpeed: 1, pointerAcceleration: 1 };
    let prev = 0;
    for (let v = 0; v <= 3; v += 0.05) {
      const g = accelerationGain(v, cfg);
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
    expect(accelerationGain(0, cfg)).toBe(1);
    expect(accelerationGain(100, cfg)).toBe(3);
    expect(accelerationGain(Number.NaN, cfg)).toBe(1);
    expect(accelerationGain(5, { pointerSpeed: 1, pointerAcceleration: 0 })).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------
// No stuck buttons

describe('held buttons are always released', () => {
  it('cancel during a long-press drag releases the button', () => {
    const h = new Harness()
      .down(1, 100, 100, 0)
      .tick(500)
      .move(1, 150, 100, 600)
      .cancel(1, 150, 100, 650);
    expect(h.mouse.at(-1)?.left).toBe(false);
  });

  it('mode switch mid-drag releases; later drag events are ignored', () => {
    const h = new Harness().down(1, 100, 100, 0).tick(500).move(1, 150, 100, 600);
    const out = h.pm.setConfig({ mode: 'trackpad' }, h.vp);
    expect(fmt(out.mouse)).toEqual(['300,200']);
    h.take();
    h.move(1, 200, 100, 700).up(1, 200, 100, 800);
    expect(h.mouse.some((s) => s.left)).toBe(false);
  });

  it.each([
    [{ directPan: 'drag' }, { directPan: 'viewport' }],
    [{ mode: 'trackpad' }, { trackpadLongPress: 'right-click' }],
  ] as [Partial<PointerConfig>, Partial<PointerConfig>][])(
    'changing a gesture option mid-drag releases (%o → %o)',
    (initial, change) => {
      const h = new Harness(initial);
      if (initial.directPan === 'drag') h.down(1, 100, 100, 0).move(1, 150, 100, 30);
      else h.down(1, 100, 100, 0).tick(500);
      expect(h.mouse.at(-1)?.left).toBe(true);
      const out = h.pm.setConfig(change, h.vp);
      expect(out.mouse.at(-1)?.left).toBe(false);
      h.take();
      h.move(1, 200, 100, 600).up(1, 200, 100, 700).tick(5000);
      // The rest of the gesture may start a fresh drag under the new option, but nothing
      // may stay held once the finger is up.
      expect(h.mouse.at(-1)?.left ?? false).toBe(false);
    },
  );

  it('changing an unrelated option keeps the drag', () => {
    const h = new Harness({ directPan: 'drag' }).down(1, 100, 100, 0).move(1, 150, 100, 30);
    expect(h.pm.setConfig({ scrollStepPx: 50 }, h.vp).mouse).toEqual([]);
    h.up(1, 150, 100, 60);
    expect(h.mouse.at(-1)?.left).toBe(false);
  });

  it('remote resize releases and clamps the pointer', () => {
    const h = new Harness({ mode: 'trackpad' }).down(1, 500, 250, 0).tick(500);
    expect(h.mouse.at(-1)?.left).toBe(true);
    h.vp = relayout(h.vp, { remote: { width: 800, height: 600 } });
    const out = h.pm.handleRemoteResize(h.vp);
    expect(out.mouse.at(-1)?.left).toBe(false);
    expect(h.pm.getPointer(h.vp)).toEqual({ x: 799, y: 500 });
  });

  it('a second finger mid long-press drag does not interrupt or leak buttons', () => {
    const h = new Harness().down(1, 100, 100, 0).tick(500).move(1, 150, 100, 600);
    h.down(2, 400, 400, 610).move(2, 450, 450, 620).up(2, 450, 450, 630);
    h.move(1, 160, 100, 640).up(1, 160, 100, 650);
    expect(fmt(h.mouse)).toEqual(['200,200', '200,200L', '300,200L', '320,200L', '320,200']);
  });

  // Deterministic fuzz: random multi-touch noise must never leave a button held and must
  // only ever produce integer, in-bounds coordinates.
  function mulberry32(seed: number) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('fuzz seed %i', (seed) => {
    const rnd = mulberry32(seed);
    for (const mode of ['direct', 'trackpad'] as const) {
      const h = new Harness({ mode, directPan: seed % 2 ? 'drag' : 'viewport' });
      const down = new Map<number, [number, number]>();
      let t = 0;
      let nextId = 1;
      for (let i = 0; i < 600; i++) {
        t += Math.floor(rnd() * 120);
        const r = rnd();
        if (r < 0.2 && down.size < 4) {
          const id = nextId++;
          const p: [number, number] = [rnd() * 1100 - 50, rnd() * 600 - 50];
          down.set(id, p);
          h.down(id, p[0], p[1], t);
        } else if (r < 0.75 && down.size > 0) {
          const ids = [...down.keys()];
          const id = ids[Math.floor(rnd() * ids.length)] ?? 0;
          const p = down.get(id) ?? [0, 0];
          const np: [number, number] = [p[0] + (rnd() - 0.5) * 80, p[1] + (rnd() - 0.5) * 80];
          down.set(id, np);
          h.move(id, np[0], np[1], t);
        } else if (r < 0.95 && down.size > 0) {
          const id = [...down.keys()][0] ?? 0;
          const p = down.get(id) ?? [0, 0];
          down.delete(id);
          h.up(id, p[0], p[1], t);
        } else if (r < 0.97 && down.size > 0) {
          const id = [...down.keys()][0] ?? 0;
          const p = down.get(id) ?? [0, 0];
          down.delete(id);
          h.cancel(id, p[0], p[1], t);
        } else {
          h.tick(t);
        }
      }
      for (const [id, p] of down) h.up(id, p[0], p[1], (t += 10));
      h.tick(t + 10_000);
      for (const s of h.mouse) {
        expect(Number.isInteger(s.x) && Number.isInteger(s.y)).toBe(true);
        expect(s.x).toBeGreaterThanOrEqual(0);
        expect(s.y).toBeGreaterThanOrEqual(0);
        expect(s.x).toBeLessThan(2000);
        expect(s.y).toBeLessThan(1000);
      }
      const last = h.mouse.at(-1);
      if (last) {
        expect([last.left, last.middle, last.right, last.up, last.down]).toEqual([
          false,
          false,
          false,
          false,
          false,
        ]);
      }
      expect(Number.isFinite(h.vp.offsetX) && Number.isFinite(h.vp.zoom)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------
// Hardware mouse bypass

describe('hardware mouse bypass (PTR-5)', () => {
  it('maps position through the viewport and buttons 1:1', () => {
    const vp = createViewport(VP);
    expect(
      mapHardwareMouse(vp, { x: 250, y: 125, left: true, middle: false, right: true }),
    ).toEqual(ms(500, 250, { left: true, right: true }));
    expect(
      mapHardwareMouse(vp, { x: -10, y: 9999, left: false, middle: true, right: false }),
    ).toEqual(ms(0, 999, { middle: true }));
  });

  it('PointerModel.handleHardwareMouse syncs the pointer and dedupes', () => {
    const pm = new PointerModel({ mode: 'trackpad' });
    const vp = createViewport(VP);
    const a = pm.handleHardwareMouse(
      { x: 10, y: 10, left: false, middle: false, right: false },
      vp,
    );
    const b = pm.handleHardwareMouse(
      { x: 10, y: 10, left: false, middle: false, right: false },
      vp,
    );
    expect(a.mouse).toHaveLength(1);
    expect(b.mouse).toHaveLength(0);
    expect(pm.getPointer(vp)).toEqual({ x: 20, y: 20 });
  });

  it('recognizer ignores mouse pointers so they cannot double-fire', () => {
    const rec = new GestureRecognizer();
    expect(
      rec.handle({ id: 1, type: 'down', x: 0, y: 0, timeMs: 0, pointerType: 'mouse' }),
    ).toEqual([]);
  });
});
