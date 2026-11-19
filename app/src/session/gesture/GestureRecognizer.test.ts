import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GESTURE_CONFIG,
  GestureRecognizer,
  type DragGesture,
  type Gesture,
  type GestureConfig,
  type PinchGesture,
  type PointerInput,
} from './GestureRecognizer.ts';

// ---------------------------------------------------------------------------------------
// Tiny script DSL: each step is a pointer event or a tick.

type Step =
  | ['d' | 'm' | 'u' | 'c', number, number, number, number] // kind, id, x, y, t
  | ['t', number]; // tick(t)

const KIND = { d: 'down', m: 'move', u: 'up', c: 'cancel' } as const;

function run(steps: Step[], config: Partial<GestureConfig> = {}, rec?: GestureRecognizer) {
  const r = rec ?? new GestureRecognizer(config);
  const out: Gesture[] = [];
  for (const s of steps) {
    if (s[0] === 't') out.push(...r.tick(s[1]));
    else {
      const [k, id, x, y, t] = s;
      const e: PointerInput = { id, type: KIND[k], x, y, timeMs: t, pointerType: 'touch' };
      out.push(...r.handle(e));
    }
  }
  return { out, r };
}

/** Compact names: 'tap', 'pan:start', 'long-press:end!' (! = cancelled). */
function names(gs: Gesture[]): string[] {
  return gs.map((g) => {
    if ('phase' in g) return `${g.type}:${g.phase}${'cancelled' in g && g.cancelled ? '!' : ''}`;
    return g.type;
  });
}

function find<T extends Gesture['type']>(gs: Gesture[], type: T, phase?: string) {
  const g = gs.find(
    (x) => x.type === type && (phase === undefined || ('phase' in x && x.phase === phase)),
  );
  if (!g) throw new Error(`no ${type} ${phase ?? ''} in ${names(gs).join(',')}`);
  return g as Gesture & { type: T };
}

const TAP_DRAG = { tapDrag: true };
const C = DEFAULT_GESTURE_CONFIG;

describe('GestureRecognizer: table of sequences', () => {
  const rows: [string, Step[], Partial<GestureConfig>, string[]][] = [
    [
      'tap',
      [
        ['d', 1, 100, 100, 0],
        ['u', 1, 102, 101, 80],
      ],
      {},
      ['tap'],
    ],
    [
      'tap with jitter inside slop',
      [
        ['d', 1, 100, 100, 0],
        ['m', 1, 106, 96, 30],
        ['m', 1, 95, 104, 60],
        ['u', 1, 100, 100, 90],
      ],
      {},
      ['tap'],
    ],
    [
      'slow release before the long press is still a tap (no dead zone)',
      [
        ['d', 1, 100, 100, 0],
        ['u', 1, 100, 100, 400],
      ],
      {},
      ['tap'],
    ],
    [
      'release just before the long-press threshold is a tap',
      [
        ['d', 1, 100, 100, 0],
        ['u', 1, 100, 100, 499],
      ],
      {},
      ['tap'],
    ],
    [
      'pan',
      [
        ['d', 1, 100, 100, 0],
        ['m', 1, 130, 100, 50],
        ['m', 1, 160, 100, 70],
        ['u', 1, 160, 100, 80],
      ],
      {},
      ['pan:start', 'pan:move', 'pan:move', 'pan:end'],
    ],
    [
      'quick flick that leaves slop only on release',
      [
        ['d', 1, 100, 100, 0],
        ['u', 1, 150, 100, 40],
      ],
      {},
      ['pan:start', 'pan:move', 'pan:end'],
    ],
    [
      'long press (tick)',
      [
        ['d', 1, 100, 100, 0],
        ['t', 500],
        ['u', 1, 100, 100, 700],
      ],
      {},
      ['long-press:start', 'long-press:end'],
    ],
    [
      'long press fires on the next event even without a tick',
      [
        ['d', 1, 100, 100, 0],
        ['m', 1, 101, 100, 650],
        ['u', 1, 101, 100, 700],
      ],
      {},
      ['long-press:start', 'long-press:end'],
    ],
    [
      'long press then move = long-press-drag',
      [
        ['d', 1, 100, 100, 0],
        ['t', 520],
        ['m', 1, 150, 120, 600],
        ['m', 1, 160, 130, 620],
        ['u', 1, 160, 130, 640],
      ],
      {},
      [
        'long-press:start',
        'long-press-drag:start',
        'long-press-drag:move',
        'long-press-drag:move',
        'long-press-drag:end',
      ],
    ],
    [
      'moving before the timeout is a pan, never a long press',
      [
        ['d', 1, 100, 100, 0],
        ['m', 1, 140, 100, 100],
        ['t', 2000],
        ['u', 1, 140, 100, 2100],
      ],
      {},
      ['pan:start', 'pan:move', 'pan:end'],
    ],
    [
      'double tap (immediate): tap then double-tap',
      [
        ['d', 1, 100, 100, 0],
        ['u', 1, 100, 100, 60],
        ['d', 2, 110, 105, 200],
        ['u', 2, 110, 105, 260],
      ],
      {},
      ['tap', 'double-tap'],
    ],
    [
      'second tap after the window is a new tap',
      [
        ['d', 1, 100, 100, 0],
        ['u', 1, 100, 100, 60],
        ['d', 2, 100, 100, 400],
        ['u', 2, 100, 100, 450],
      ],
      {},
      ['tap', 'tap'],
    ],
    [
      'second tap too far away is a new tap',
      [
        ['d', 1, 100, 100, 0],
        ['u', 1, 100, 100, 60],
        ['d', 2, 200, 100, 150],
        ['u', 2, 200, 100, 200],
      ],
      {},
      ['tap', 'tap'],
    ],
    [
      'triple tap = tap, double-tap, tap',
      [
        ['d', 1, 100, 100, 0],
        ['u', 1, 100, 100, 50],
        ['d', 2, 100, 100, 150],
        ['u', 2, 100, 100, 200],
        ['d', 3, 100, 100, 300],
        ['u', 3, 100, 100, 350],
      ],
      {},
      ['tap', 'double-tap', 'tap'],
    ],
    [
      'immediate mode: tap then touch-and-move is tap + pan (no double-tap drag)',
      [
        ['d', 1, 100, 100, 0],
        ['u', 1, 100, 100, 50],
        ['d', 2, 100, 100, 150],
        ['m', 2, 150, 100, 200],
        ['u', 2, 150, 100, 250],
      ],
      {},
      ['tap', 'pan:start', 'pan:move', 'pan:end'],
    ],
    [
      'tap-drag: the press is sent on release, the release when the window expires',
      [
        ['d', 1, 100, 100, 0],
        ['u', 1, 100, 100, 60],
        ['t', 359],
        ['t', 360],
      ],
      TAP_DRAG,
      ['pending-tap:start', 'pending-tap:end'],
    ],
    [
      'tap-drag: double tap = release, then one more click',
      [
        ['d', 1, 100, 100, 0],
        ['u', 1, 100, 100, 60],
        ['d', 2, 104, 100, 200],
        ['u', 2, 104, 100, 260],
        ['t', 2000],
      ],
      TAP_DRAG,
      ['pending-tap:start', 'pending-tap:end', 'double-tap'],
    ],
    [
      'tap-drag: tap-and-a-half then move = drag on the held button (no release first)',
      [
        ['d', 1, 100, 100, 0],
        ['u', 1, 100, 100, 60],
        ['d', 2, 100, 100, 200],
        ['m', 2, 140, 100, 250],
        ['u', 2, 140, 100, 300],
        ['t', 3000],
      ],
      TAP_DRAG,
      ['pending-tap:start', 'double-tap-drag:start', 'double-tap-drag:move', 'double-tap-drag:end'],
    ],
    [
      'tap-drag: tap-and-a-half held still arms the drag after tapMaxMs',
      [
        ['d', 1, 100, 100, 0],
        ['u', 1, 100, 100, 60],
        ['d', 2, 100, 100, 200],
        ['t', 450],
        ['u', 2, 100, 100, 900],
      ],
      TAP_DRAG,
      ['pending-tap:start', 'double-tap-drag:start', 'double-tap-drag:end'],
    ],
    [
      'tap-drag: a slow but still second tap released before tapMaxMs is a double tap',
      [
        ['d', 1, 100, 100, 0],
        ['u', 1, 100, 100, 60],
        ['d', 2, 100, 100, 200],
        ['u', 2, 100, 100, 440],
      ],
      TAP_DRAG,
      ['pending-tap:start', 'pending-tap:end', 'double-tap'],
    ],
    [
      'tap-drag: second touch far away releases the first tap at once',
      [
        ['d', 1, 100, 100, 0],
        ['u', 1, 100, 100, 60],
        ['d', 2, 300, 300, 100],
      ],
      TAP_DRAG,
      ['pending-tap:start', 'pending-tap:end'],
    ],
    [
      'tap-drag: a second finger joining releases the pending tap',
      [
        ['d', 1, 100, 100, 0],
        ['u', 1, 100, 100, 60],
        ['d', 2, 100, 100, 100],
        ['d', 3, 180, 100, 110],
      ],
      TAP_DRAG,
      ['pending-tap:start', 'pending-tap:end'],
    ],
    [
      'tap-drag: cancel releases the held button',
      [
        ['d', 1, 100, 100, 0],
        ['u', 1, 100, 100, 60],
        ['d', 2, 100, 100, 100],
        ['c', 2, 100, 100, 120],
        ['t', 5000],
      ],
      TAP_DRAG,
      ['pending-tap:start', 'pending-tap:end'],
    ],
    [
      'tap-drag: a second touch after the window but inside the double-tap window = plain pan',
      [
        ['d', 1, 100, 100, 0],
        ['u', 1, 100, 100, 60],
        ['t', 360],
        ['d', 2, 100, 100, 360],
        ['m', 2, 150, 100, 380],
        ['u', 2, 150, 100, 400],
      ],
      { ...TAP_DRAG, doubleTapWindowMs: 300 },
      ['pending-tap:start', 'pending-tap:end', 'pan:start', 'pan:move', 'pan:end'],
    ],
    [
      'tap-drag: long press on a fresh touch still works',
      [
        ['d', 1, 100, 100, 0],
        ['t', 500],
        ['u', 1, 100, 100, 600],
      ],
      TAP_DRAG,
      ['long-press:start', 'long-press:end'],
    ],
    [
      'two-finger tap',
      [
        ['d', 1, 100, 100, 0],
        ['d', 2, 200, 100, 20],
        ['u', 1, 100, 100, 100],
        ['u', 2, 200, 100, 120],
      ],
      {},
      ['two-finger-tap'],
    ],
    [
      'slow two-finger tap (no dead zone) is still a tap',
      [
        ['d', 1, 100, 100, 0],
        ['d', 2, 200, 100, 20],
        ['u', 1, 100, 100, 350],
        ['u', 2, 200, 100, 450],
      ],
      {},
      ['two-finger-tap'],
    ],
    [
      'two-finger press held past the long-press time is nothing',
      [
        ['d', 1, 100, 100, 0],
        ['d', 2, 200, 100, 20],
        ['u', 1, 100, 100, 520],
        ['u', 2, 200, 100, 530],
      ],
      {},
      [],
    ],
    [
      'two-finger double tap never sends a second right click',
      [
        ['d', 1, 100, 100, 0],
        ['d', 2, 200, 100, 10],
        ['u', 1, 100, 100, 60],
        ['u', 2, 200, 100, 70],
        ['d', 3, 100, 100, 200],
        ['d', 4, 200, 100, 205],
        ['u', 3, 100, 100, 260],
        ['u', 4, 200, 100, 270],
      ],
      {},
      ['two-finger-tap', 'two-finger-double-tap'],
    ],
    [
      'two two-finger taps far apart in time are two right clicks',
      [
        ['d', 1, 100, 100, 0],
        ['d', 2, 200, 100, 10],
        ['u', 1, 100, 100, 60],
        ['u', 2, 200, 100, 70],
        ['d', 3, 100, 100, 800],
        ['d', 4, 200, 100, 805],
        ['u', 3, 100, 100, 860],
        ['u', 4, 200, 100, 870],
      ],
      {},
      ['two-finger-tap', 'two-finger-tap'],
    ],
    [
      'three-finger tap is held for the double-tap window',
      [
        ['d', 1, 100, 100, 0],
        ['d', 2, 200, 100, 10],
        ['d', 3, 300, 100, 20],
        ['u', 2, 200, 100, 90],
        ['u', 1, 100, 100, 100],
        ['u', 3, 300, 100, 110],
        ['t', 409],
        ['t', 410],
      ],
      {},
      ['three-finger-tap'],
    ],
    [
      'three-finger double tap = zoom reset, no middle click',
      [
        ['d', 1, 100, 100, 0],
        ['d', 2, 200, 100, 10],
        ['d', 3, 300, 100, 20],
        ['u', 1, 100, 100, 80],
        ['u', 2, 200, 100, 85],
        ['u', 3, 300, 100, 90],
        ['d', 4, 100, 100, 200],
        ['d', 5, 200, 100, 205],
        ['d', 6, 300, 100, 210],
        ['u', 4, 100, 100, 260],
        ['u', 5, 200, 100, 265],
        ['u', 6, 300, 100, 270],
        ['t', 5000],
      ],
      {},
      ['three-finger-double-tap'],
    ],
    [
      'a held three-finger tap is flushed before the next gesture',
      [
        ['d', 1, 100, 100, 0],
        ['d', 2, 200, 100, 10],
        ['d', 3, 300, 100, 20],
        ['u', 1, 100, 100, 80],
        ['u', 2, 200, 100, 85],
        ['u', 3, 300, 100, 90],
        ['d', 4, 100, 100, 150],
        ['u', 4, 100, 100, 200],
      ],
      {},
      ['three-finger-tap', 'tap'],
    ],
    [
      'four fingers produce nothing',
      [
        ['d', 1, 100, 100, 0],
        ['d', 2, 200, 100, 10],
        ['d', 3, 300, 100, 20],
        ['d', 4, 400, 100, 30],
        ['u', 1, 100, 100, 60],
        ['u', 2, 200, 100, 60],
        ['u', 3, 300, 100, 60],
        ['u', 4, 400, 100, 60],
      ],
      {},
      [],
    ],
    [
      'two-finger jitter past slop but below thresholds: neither tap nor gesture',
      // Fingers rotate around their centre: span and centroid unchanged.
      [
        ['d', 1, 100, 100, 0],
        ['d', 2, 200, 100, 10],
        ['m', 1, 100, 120, 40],
        ['m', 2, 200, 80, 50],
        ['u', 1, 100, 120, 90],
        ['u', 2, 200, 80, 100],
      ],
      {},
      [],
    ],
    [
      'pinch out',
      [
        ['d', 1, 100, 100, 0],
        ['d', 2, 200, 100, 10],
        ['m', 1, 70, 100, 40],
        ['m', 2, 230, 100, 50],
        ['u', 1, 70, 100, 90],
        ['u', 2, 230, 100, 100],
      ],
      {},
      ['pinch:start', 'pinch:move', 'pinch:move', 'pinch:end'],
    ],
    [
      'two-finger pan',
      [
        ['d', 1, 100, 100, 0],
        ['d', 2, 200, 100, 10],
        ['m', 1, 100, 140, 40],
        ['m', 2, 200, 140, 50],
        ['u', 1, 100, 140, 90],
        ['u', 2, 200, 140, 100],
      ],
      {},
      ['two-finger-pan:start', 'two-finger-pan:move', 'two-finger-pan:move', 'two-finger-pan:end'],
    ],
    [
      'one finger lifts in a multi-touch and the other moves: nothing',
      [
        ['d', 1, 100, 100, 0],
        ['d', 2, 200, 100, 10],
        ['u', 1, 100, 100, 50],
        ['m', 2, 300, 300, 80],
        ['u', 2, 300, 300, 120],
      ],
      {},
      [],
    ],
    [
      'a finger re-landing after a lift voids the two-finger tap',
      [
        ['d', 1, 100, 100, 0],
        ['d', 2, 200, 100, 10],
        ['u', 1, 100, 100, 50],
        ['d', 3, 100, 100, 60],
        ['u', 2, 200, 100, 90],
        ['u', 3, 100, 100, 100],
      ],
      {},
      [],
    ],
    [
      'second finger mid-pan ends the pan and can become a pinch, never a tap',
      [
        ['d', 1, 100, 100, 0],
        ['m', 1, 140, 100, 40],
        ['d', 2, 240, 100, 60],
        ['u', 2, 240, 100, 100],
        ['u', 1, 140, 100, 110],
      ],
      {},
      ['pan:start', 'pan:move', 'pan:end'],
    ],
    [
      'second finger mid-pan then spread = pinch',
      [
        ['d', 1, 100, 100, 0],
        ['m', 1, 140, 100, 40],
        ['d', 2, 240, 100, 60],
        ['m', 2, 300, 100, 80],
        ['u', 2, 300, 100, 100],
        ['u', 1, 140, 100, 110],
      ],
      {},
      ['pan:start', 'pan:move', 'pan:end', 'pinch:start', 'pinch:move', 'pinch:end'],
    ],
    [
      'second finger during a long press cancels it',
      [
        ['d', 1, 100, 100, 0],
        ['t', 600],
        ['d', 2, 200, 100, 650],
        ['u', 2, 200, 100, 700],
        ['u', 1, 100, 100, 710],
      ],
      {},
      ['long-press:start', 'long-press:end!'],
    ],
    [
      'extra finger during a long-press drag is ignored',
      [
        ['d', 1, 100, 100, 0],
        ['t', 500],
        ['m', 1, 130, 100, 550],
        ['d', 2, 300, 300, 560],
        ['m', 2, 400, 400, 570],
        ['u', 2, 400, 400, 580],
        ['m', 1, 140, 100, 590],
        ['u', 1, 140, 100, 600],
      ],
      {},
      [
        'long-press:start',
        'long-press-drag:start',
        'long-press-drag:move',
        'long-press-drag:move',
        'long-press-drag:end',
      ],
    ],
    [
      'cancel mid-pan ends it as cancelled and ignores the rest',
      [
        ['d', 1, 100, 100, 0],
        ['m', 1, 140, 100, 40],
        ['c', 1, 140, 100, 50],
        ['m', 1, 200, 100, 60],
        ['u', 1, 200, 100, 70],
      ],
      {},
      ['pan:start', 'pan:move', 'pan:end!'],
    ],
    [
      'cancel of one finger in a pinch ends it; the other finger is ignored',
      [
        ['d', 1, 100, 100, 0],
        ['d', 2, 200, 100, 10],
        ['m', 2, 260, 100, 40],
        ['c', 1, 100, 100, 50],
        ['m', 2, 300, 100, 60],
        ['u', 2, 300, 100, 70],
        ['d', 3, 50, 50, 80],
        ['u', 3, 50, 50, 100],
      ],
      {},
      ['pinch:start', 'pinch:move', 'pinch:end!', 'tap'],
    ],
    [
      'move/up for unknown ids are ignored',
      [
        ['m', 9, 1, 1, 0],
        ['u', 9, 1, 1, 10],
        ['c', 9, 1, 1, 20],
      ],
      {},
      [],
    ],
    [
      'duplicate down for the same id cancels the current gesture first',
      [
        ['d', 1, 100, 100, 0],
        ['m', 1, 150, 100, 30],
        ['d', 1, 300, 300, 60],
        ['u', 1, 300, 300, 100],
      ],
      {},
      ['pan:start', 'pan:move', 'pan:end!', 'tap'],
    ],
    [
      'time going backwards is treated as now',
      [
        ['d', 1, 100, 100, 1000],
        ['u', 1, 100, 100, 900],
      ],
      {},
      ['tap'],
    ],
  ];

  it.each(rows)('%s', (_name, steps, config, expected) => {
    expect(names(run(steps, config).out)).toEqual(expected);
  });
});

describe('GestureRecognizer: payloads', () => {
  it('pan deltas sum to the total movement, starting from the landing point', () => {
    const { out } = run([
      ['d', 1, 100, 100, 0],
      ['m', 1, 105, 100, 10],
      ['m', 1, 125, 110, 20],
      ['m', 1, 140, 90, 30],
      ['u', 1, 140, 90, 40],
    ]);
    const start = find(out, 'pan', 'start');
    expect([start.x, start.y]).toEqual([100, 100]);
    const moves = out.filter((g) => g.type === 'pan') as DragGesture[];
    const sx = moves.reduce((a, g) => a + g.dx, 0);
    const sy = moves.reduce((a, g) => a + g.dy, 0);
    expect([sx, sy]).toEqual([40, -10]);
  });

  it('pan end carries velocity, or zero after a pause', () => {
    const fast = run([
      ['d', 1, 0, 0, 0],
      ['m', 1, 20, 0, 10],
      ['m', 1, 40, 0, 20],
      ['m', 1, 60, 0, 30],
      ['u', 1, 60, 0, 30],
    ]).out;
    expect(find(fast, 'pan', 'end').vx).toBeCloseTo(2, 6);
    const paused = run([
      ['d', 1, 0, 0, 0],
      ['m', 1, 20, 0, 10],
      ['m', 1, 60, 0, 30],
      ['u', 1, 60, 0, 300],
    ]).out;
    expect(find(paused, 'pan', 'end').vx).toBe(0);
  });

  it('second finger mid-pan ends the pan with zero velocity (no fling)', () => {
    const { out } = run([
      ['d', 1, 0, 0, 0],
      ['m', 1, 30, 0, 10],
      ['m', 1, 60, 0, 20],
      ['d', 2, 200, 0, 25],
    ]);
    const end = find(out, 'pan', 'end');
    expect([end.vx, end.vy, end.cancelled]).toEqual([0, 0, false]);
  });

  it('double-tap reports the first tap location', () => {
    const { out } = run([
      ['d', 1, 100, 100, 0],
      ['u', 1, 100, 100, 50],
      ['d', 2, 120, 90, 150],
      ['u', 2, 120, 90, 200],
    ]);
    const dt = find(out, 'double-tap');
    expect([dt.firstX, dt.firstY, dt.x, dt.y]).toEqual([100, 100, 120, 90]);
  });

  it('tap-drag: the press has no latency; the release comes at the window deadline', () => {
    const r = new GestureRecognizer(TAP_DRAG);
    const { out } = run(
      [
        ['d', 1, 10, 20, 0],
        ['u', 1, 10, 20, 70],
      ],
      {},
      r,
    );
    expect(out).toEqual([{ type: 'pending-tap', phase: 'start', x: 10, y: 20, timeMs: 70 }]);
    expect(r.nextDeadline()).toBe(70 + C.tapDragInitialWindowMs);
    expect(r.tick(70 + C.tapDragInitialWindowMs - 1)).toEqual([]);
    // A late tick still reports the deadline time, not the tick time.
    expect(r.tick(5000)).toEqual([
      { type: 'pending-tap', phase: 'end', x: 10, y: 20, timeMs: 250 },
    ]);
    expect(r.nextDeadline()).toBeNull();
  });

  it('tap-drag: the window adapts to the observed second-touch gaps, within bounds', () => {
    const r = new GestureRecognizer({
      ...TAP_DRAG,
      doubleTapWindowMs: 300,
      tapDragMinWindowMs: 150,
    });
    expect(r.tapDragWindowMs()).toBe(180); // initial, before the rhythm is known
    // Three quick double taps with gaps of 80, 90 and 100 ms.
    let t = 0;
    for (const gap of [80, 90, 100]) {
      run(
        [
          ['d', 1, 0, 0, t],
          ['u', 1, 0, 0, t + 50],
          ['d', 2, 0, 0, t + 50 + gap],
          ['u', 2, 0, 0, t + 100 + gap],
        ],
        {},
        r,
      );
      t += 2000;
    }
    expect(r.tapDragWindowMs()).toBe(150); // 1.5 × 100
    // A very fast user cannot push it under the minimum; a slow second tap grows it again.
    run(
      [
        ['d', 1, 0, 0, t],
        ['u', 1, 0, 0, t + 50],
        ['t', t + 220],
        ['d', 2, 0, 0, t + 50 + 190],
        ['u', 2, 0, 0, t + 300],
      ],
      {},
      r,
    );
    expect(r.tapDragWindowMs()).toBe(285);
  });

  it('tap-drag: what the remote would see for each case', () => {
    // press = pending-tap:start / double-tap-drag holds it; release = pending-tap:end / drag end.
    const lone = run(
      [
        ['d', 1, 0, 0, 0],
        ['u', 1, 0, 0, 50],
        ['t', 1000],
      ],
      TAP_DRAG,
    ).out;
    expect(names(lone)).toEqual(['pending-tap:start', 'pending-tap:end']);
    const drag = run(
      [
        ['d', 1, 0, 0, 0],
        ['u', 1, 0, 0, 50],
        ['d', 2, 0, 0, 150],
        ['m', 2, 40, 0, 200],
        ['u', 2, 40, 0, 250],
      ],
      TAP_DRAG,
    ).out;
    // Exactly one press and one release around the motion.
    expect(names(drag).filter((n) => n.endsWith(':end'))).toEqual(['double-tap-drag:end']);
  });

  it('immediate taps add no latency', () => {
    const { out } = run([
      ['d', 1, 10, 20, 0],
      ['u', 1, 10, 20, 70],
    ]);
    expect(out).toEqual([{ type: 'tap', x: 10, y: 20, timeMs: 70 }]);
  });

  it('two-finger tap reports the centroid of the landing points', () => {
    const { out } = run([
      ['d', 1, 100, 100, 0],
      ['d', 2, 200, 200, 10],
      ['m', 1, 104, 100, 20],
      ['u', 1, 104, 100, 50],
      ['u', 2, 200, 200, 60],
    ]);
    const t = find(out, 'two-finger-tap');
    expect([t.x, t.y]).toEqual([150, 150]);
  });

  it('pinch scale factors multiply to the total scale; focal point is the centroid', () => {
    const { out } = run([
      ['d', 1, 100, 100, 0],
      ['d', 2, 200, 100, 0],
      ['m', 1, 50, 100, 20],
      ['m', 2, 250, 100, 30],
      ['m', 2, 350, 100, 40],
      ['u', 1, 50, 100, 50],
      ['u', 2, 350, 100, 50],
    ]);
    const pinches = out.filter((g) => g.type === 'pinch') as PinchGesture[];
    const product = pinches.reduce((a, g) => a * g.scale, 1);
    expect(product).toBeCloseTo(3, 9);
    const last = pinches[pinches.length - 1];
    expect(last?.totalScale).toBeCloseTo(3, 9);
    const start = find(out, 'pinch', 'start');
    expect([start.x, start.y]).toEqual([150, 100]);
    const sumDx = pinches.reduce((a, g) => a + g.dx, 0);
    expect(sumDx).toBeCloseTo(200 - 150, 9);
  });

  it('one stationary finger with the other moving away is a pinch', () => {
    const { out } = run([
      ['d', 1, 100, 100, 0],
      ['d', 2, 200, 100, 0],
      ['m', 2, 260, 100, 30],
    ]);
    expect(names(out)).toEqual(['pinch:start', 'pinch:move']);
  });

  it('decision is locked: a two-finger pan that later spreads stays a pan', () => {
    const { out } = run([
      ['d', 1, 100, 100, 0],
      ['d', 2, 200, 100, 0],
      ['m', 1, 100, 140, 20],
      ['m', 2, 200, 140, 30],
      ['m', 1, 0, 140, 40],
      ['m', 2, 400, 140, 50],
    ]);
    expect(out.every((g) => g.type === 'two-finger-pan')).toBe(true);
  });

  it('pinch dominance is configurable', () => {
    // First move decides nothing; after the second the span grew ~36 px while the centroid
    // moved ~43 px: a pan by default, a pinch with dominance 0.5.
    const steps: Step[] = [
      ['d', 1, 100, 100, 0],
      ['d', 2, 200, 100, 0],
      ['m', 1, 100, 120, 10],
      ['m', 2, 230, 160, 20],
    ];
    expect(names(run(steps).out)[0]).toBe('two-finger-pan:start');
    expect(names(run(steps, { pinchDominance: 0.5 }).out)[0]).toBe('pinch:start');
  });

  it('two fingers landing on the same point do not divide by zero', () => {
    const { out } = run([
      ['d', 1, 100, 100, 0],
      ['d', 2, 100, 100, 0],
      ['m', 2, 160, 100, 30],
    ]);
    for (const g of out) {
      if (g.type === 'pinch') {
        expect(Number.isFinite(g.scale)).toBe(true);
        expect(Number.isFinite(g.totalScale)).toBe(true);
      }
    }
  });

  it('ignores mouse pointers and non-finite coordinates', () => {
    const r = new GestureRecognizer();
    expect(r.handle({ id: 1, type: 'down', x: 1, y: 1, timeMs: 0, pointerType: 'mouse' })).toEqual(
      [],
    );
    expect(r.activePointers).toBe(0);
    expect(
      r.handle({ id: 1, type: 'down', x: Number.NaN, y: 1, timeMs: 0, pointerType: 'touch' }),
    ).toEqual([]);
    expect(r.activePointers).toBe(0);
    // Pen behaves like touch.
    r.handle({ id: 2, type: 'down', x: 1, y: 1, timeMs: 0, pointerType: 'pen' });
    expect(
      names(r.handle({ id: 2, type: 'up', x: 1, y: 1, timeMs: 50, pointerType: 'pen' })),
    ).toEqual(['tap']);
  });

  it('nextDeadline tracks long press and double-tap-hold timers', () => {
    const r = new GestureRecognizer(TAP_DRAG);
    expect(r.nextDeadline()).toBeNull();
    run([['d', 1, 0, 0, 100]], {}, r);
    expect(r.nextDeadline()).toBe(100 + C.longPressMs);
    run(
      [
        ['u', 1, 0, 0, 150],
        ['d', 2, 0, 0, 200],
      ],
      {},
      r,
    );
    expect(r.nextDeadline()).toBe(200 + C.tapMaxMs);
  });

  it('setConfig turning tap-drag off releases a pending tap', () => {
    const r = new GestureRecognizer(TAP_DRAG);
    run(
      [
        ['d', 1, 5, 5, 0],
        ['u', 1, 5, 5, 50],
      ],
      {},
      r,
    );
    expect(names(r.setConfig({ tapDrag: false }))).toEqual(['pending-tap:end']);
    expect(r.tick(10_000)).toEqual([]);
  });

  it('reset releases a pending tap', () => {
    const r = new GestureRecognizer(TAP_DRAG);
    run(
      [
        ['d', 1, 5, 5, 0],
        ['u', 1, 5, 5, 50],
      ],
      {},
      r,
    );
    expect(names(r.reset(60))).toEqual(['pending-tap:end']);
  });

  it('reset ends an active drag as cancelled and forgets everything', () => {
    const r = new GestureRecognizer();
    run(
      [
        ['d', 1, 0, 0, 0],
        ['m', 1, 50, 0, 20],
      ],
      {},
      r,
    );
    expect(names(r.reset())).toEqual(['pan:end!']);
    expect(r.activePointers).toBe(0);
    expect(
      names(
        run(
          [
            ['d', 2, 0, 0, 100],
            ['u', 2, 0, 0, 150],
          ],
          {},
          r,
        ).out,
      ),
    ).toEqual(['tap']);
  });

  it('long press is reported at its own deadline time and landing point', () => {
    const { out } = run([
      ['d', 1, 30, 40, 1000],
      ['m', 1, 33, 42, 1100],
      ['t', 9999],
    ]);
    expect(out).toEqual([
      { type: 'long-press', phase: 'start', x: 30, y: 40, cancelled: false, timeMs: 1500 },
    ]);
  });
});
