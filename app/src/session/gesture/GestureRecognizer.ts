/**
 * GestureRecognizer: plain pointer samples in, semantic touch gestures out.
 *
 * Pure and deterministic: no DOM types, no timers. Time comes from the events and from
 * `tick(timeMs)`; before handling any event the recogniser first fires every timer that is
 * due at that event's time, so the output does not depend on how often the host ticks.
 * `nextDeadline()` tells the host when the next timer is due.
 *
 * Mouse pointers (`pointerType: 'mouse'`) are ignored: hardware mice bypass gesture
 * recognition (see `mapHardwareMouse` in PointerModel). Pen is treated like touch here; the
 * session host routes pens to the precise pointer path instead.
 *
 * Ambiguity rules (all deterministic):
 * - **Tap vs pan**: a single pointer is a tap if it is released within `tapSlopPx` of where
 *   it landed and before the long press fires (`longPressMs`). There is no dead zone: any
 *   stationary press shorter than a long press is a tap. Leaving the slop starts a pan; the
 *   first pan move carries the whole distance from the landing point, so no motion is lost.
 * - **Long press** fires while held (`long-press` start) once `longPressMs` elapses with no
 *   slop exit. It is then closed by exactly one of: `long-press` end (released in place),
 *   `long-press` end with `cancelled` (second finger / cancel), or a `long-press-drag` start
 *   (moved out of slop). With `longPress` off the timer never runs: a press held in place
 *   for any time is a tap on release, and moving out of slop is a pan.
 * - **Double tap**: a second tap landing within `doubleTapSlopPx` of the first and within
 *   `doubleTapWindowMs` of the first release. A `double-tap` always follows the gesture(s)
 *   for the first tap, so consumers treat it as "one more click".
 * - **Tap-and-a-half drag** (`tapDrag`, trackpad mode): the first tap is reported as
 *   `pending-tap` start **on release, with no delay** (consumers press the button), and its
 *   `pending-tap` end (release the button) is held back for a short adaptive window. Then:
 *   - nothing else happens: `pending-tap` end when the window expires (a click whose
 *     button-up is late by the window; the button-down is instant);
 *   - a quick second tap near it: `pending-tap` end, then `double-tap` (a double click);
 *   - a second touch near it that moves out of slop or is held for `tapMaxMs`:
 *     `double-tap-drag` start **while the button is still down**, so the remote sees one
 *     press, motion, one release (a plain drag, never a double-click-drag);
 *   - a touch far away, a second finger, a cancel or a reset: `pending-tap` end at once.
 *   The window adapts to the user: it starts at `tapDragInitialWindowMs` (180 ms, or
 *   1.5 × a slower gap already seen) and, after three observed second-touch gaps, becomes
 *   1.5 × the largest recent gap, always clamped to [`tapDragMinWindowMs`,
 *   `doubleTapWindowMs`]. Second touches that arrive after the window but inside
 *   `doubleTapWindowMs` are recorded too (and are still a double click), so the window
 *   grows for slow double-tappers.
 *   With `tapDrag` off, taps are emitted as `tap` on release and nothing is held back.
 * - **Two/three-finger tap vs pinch vs two-finger pan**: while 2+ fingers are down and none
 *   has left `multiTouchSlopPx`, a release of all fingers before `longPressMs` (from the
 *   first landing) is an N-finger tap (N = most fingers down at once, 2 or 3). Otherwise,
 *   for the first two fingers, the change of finger span and the movement of their centroid
 *   since landing are compared: `pinch` when the span change reaches `pinchThresholdPx` and
 *   is at least `pinchDominance` × the centroid movement; `two-finger-pan` when the centroid
 *   movement reaches `twoFingerPanThresholdPx` and it is not a pinch. The decision is
 *   locked for the rest of the gesture (a scroll never zooms and vice versa).
 * - **Multi-finger double taps**: a two-finger tap is emitted at once (right click without
 *   latency); a second two-finger tap within `doubleTapWindowMs` is reported as
 *   `two-finger-double-tap` instead of a second `two-finger-tap`, so a hurried double tap
 *   never sends two right clicks. A three-finger tap is held back for `doubleTapWindowMs`
 *   (middle click pastes on X11, so it must not fire speculatively): a second three-finger
 *   tap in the window gives `three-finger-double-tap` (zoom reset) and no middle click;
 *   anything else first flushes the held `three-finger-tap`.
 * - **Second finger mid-pan**: the pan ends with zero velocity (no fling) and the two
 *   fingers continue as a pinch/two-finger-pan candidate (never a tap).
 * - **Extra fingers during a drag/pinch/pan** are ignored. After any multi-finger gesture
 *   or any finger lifting from one, nothing else fires until every finger is up.
 * - **Cancel** ends whatever is active with `cancelled: true`, releases a pending tap,
 *   drops a held-back three-finger tap and waits for all fingers to be up. A repeated `down`
 *   for an id already down is treated as a cancel of the current state first.
 */

export type PointerKind = 'touch' | 'mouse' | 'pen';

export interface PointerInput {
  readonly id: number;
  readonly type: 'down' | 'move' | 'up' | 'cancel';
  readonly x: number;
  readonly y: number;
  readonly timeMs: number;
  readonly pointerType: PointerKind;
}

export type GesturePhase = 'start' | 'move' | 'end';

export interface TapGesture {
  readonly type:
    | 'tap'
    | 'two-finger-tap'
    | 'three-finger-tap'
    | 'two-finger-double-tap'
    | 'three-finger-double-tap';
  /** Screen position (centroid of the landing points for multi-finger taps). */
  readonly x: number;
  readonly y: number;
  readonly timeMs: number;
}

/** Tap-and-a-half mode: `start` = press now (tap released), `end` = release now. */
export interface PendingTapGesture {
  readonly type: 'pending-tap';
  readonly phase: 'start' | 'end';
  readonly x: number;
  readonly y: number;
  readonly timeMs: number;
}

export interface DoubleTapGesture {
  readonly type: 'double-tap';
  readonly x: number;
  readonly y: number;
  /** Where the first tap landed; double clicks should use this point. */
  readonly firstX: number;
  readonly firstY: number;
  readonly timeMs: number;
}

export interface LongPressGesture {
  readonly type: 'long-press';
  readonly phase: 'start' | 'end';
  readonly x: number;
  readonly y: number;
  readonly cancelled: boolean;
  readonly timeMs: number;
}

export interface DragGesture {
  readonly type: 'pan' | 'long-press-drag' | 'double-tap-drag' | 'two-finger-pan';
  readonly phase: GesturePhase;
  /** Current screen position (centroid for two-finger pan). */
  readonly x: number;
  readonly y: number;
  /** Delta since the previous event of this gesture (0 on start). */
  readonly dx: number;
  readonly dy: number;
  /** Recent velocity, screen px per ms. 0 when the finger paused before lifting. */
  readonly vx: number;
  readonly vy: number;
  readonly cancelled: boolean;
  readonly timeMs: number;
}

export interface PinchGesture {
  readonly type: 'pinch';
  readonly phase: GesturePhase;
  /** Current focal point (centroid of the two fingers). */
  readonly x: number;
  readonly y: number;
  /** Focal point delta since the previous event. */
  readonly dx: number;
  readonly dy: number;
  /** Span ratio since the previous event (multiply the zoom by this). */
  readonly scale: number;
  /** Span ratio since the fingers landed. */
  readonly totalScale: number;
  readonly cancelled: boolean;
  readonly timeMs: number;
}

export type Gesture =
  TapGesture | PendingTapGesture | DoubleTapGesture | LongPressGesture | DragGesture | PinchGesture;

export interface GestureConfig {
  /** Max movement (screen px) for a touch to still count as a tap / press in place. */
  readonly tapSlopPx: number;
  /** Hold time of the second touch that arms a tap-and-a-half drag (`tapDrag` only). */
  readonly tapMaxMs: number;
  /** Max time between the first release and the second landing for a double tap. */
  readonly doubleTapWindowMs: number;
  /** Max distance between the first and second tap of a double tap. */
  readonly doubleTapSlopPx: number;
  /** Hold time for a long press; a stationary release before it is a tap. */
  readonly longPressMs: number;
  /**
   * Recognise long presses. Off: a finger held in place never becomes a long press; it is a
   * tap when it lifts within the slop and a pan when it moves out of it. `longPressMs` still
   * bounds multi-finger taps.
   */
  readonly longPress: boolean;
  /** Tap-and-a-half drag: press on the first tap's release, release late (trackpad). */
  readonly tapDrag: boolean;
  /** Lower bound of the adaptive tap-drag window. */
  readonly tapDragMinWindowMs: number;
  /** Tap-drag window before the user's double-tap rhythm is known. */
  readonly tapDragInitialWindowMs: number;
  /** Per-finger slop for multi-finger taps. */
  readonly multiTouchSlopPx: number;
  /** Span change (px) needed to recognise a pinch. */
  readonly pinchThresholdPx: number;
  /** Centroid movement (px) needed to recognise a two-finger pan. */
  readonly twoFingerPanThresholdPx: number;
  /** Pinch wins when spanChange >= pinchDominance * centroidMovement. */
  readonly pinchDominance: number;
  /** Window over which velocity is measured. */
  readonly velocityWindowMs: number;
}

export const DEFAULT_GESTURE_CONFIG: GestureConfig = {
  tapSlopPx: 10,
  tapMaxMs: 250,
  doubleTapWindowMs: 300,
  doubleTapSlopPx: 40,
  longPressMs: 500,
  longPress: true,
  tapDrag: false,
  tapDragMinWindowMs: 150,
  tapDragInitialWindowMs: 180,
  multiTouchSlopPx: 16,
  pinchThresholdPx: 24,
  twoFingerPanThresholdPx: 16,
  pinchDominance: 1,
  velocityWindowMs: 80,
};

/** Second-touch gaps remembered for the adaptive tap-drag window. */
const GAP_HISTORY = 8;
const GAPS_BEFORE_ADAPTING = 3;

interface Sample {
  readonly x: number;
  readonly y: number;
  readonly t: number;
}

interface Track {
  readonly id: number;
  startX: number;
  startY: number;
  readonly downTime: number;
  x: number;
  y: number;
  /** Last position reported in a gesture event. */
  lastX: number;
  lastY: number;
  samples: Sample[];
}

interface PrevTap {
  readonly x: number;
  readonly y: number;
  readonly upTime: number;
  /** Tap-drag mode: the button is down and its release is still held back. */
  readonly pending: boolean;
}

interface PrevMulti {
  readonly count: 2 | 3;
  readonly x: number;
  readonly y: number;
  readonly upTime: number;
  /** A held-back three-finger tap that has not been emitted yet. */
  readonly held: boolean;
}

type State =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'single';
      readonly id: number;
      /** This touch may be the second half of a double tap. */
      readonly secondTap: boolean;
    }
  | { readonly kind: 'pan'; readonly id: number }
  | { readonly kind: 'long-pressed'; readonly id: number }
  | { readonly kind: 'lp-drag'; readonly id: number }
  | { readonly kind: 'dt-drag'; readonly id: number }
  | {
      readonly kind: 'multi';
      readonly ids: number[];
      readonly startTime: number;
      /** Landing points of the fingers counted for an N-finger tap. */
      readonly landings: { x: number; y: number }[];
      tapEligible: boolean;
      lifted: boolean;
      maxCount: number;
    }
  | {
      readonly kind: 'two-pan' | 'pinch';
      readonly a: number;
      readonly b: number;
      lastCx: number;
      lastCy: number;
      lastSpan: number;
      readonly startSpan: number;
    }
  | { readonly kind: 'wait-all-up' };

const IDLE: State = { kind: 'idle' };

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

export class GestureRecognizer {
  private config: GestureConfig;
  private readonly tracks = new Map<number, Track>();
  private state: State = IDLE;
  private prevTap: PrevTap | null = null;
  private prevMulti: PrevMulti | null = null;
  private lastTime = Number.NEGATIVE_INFINITY;
  /** Recent gaps between a tap's release and the next touch near it (adaptive window). */
  private gaps: number[] = [];

  constructor(config: Partial<GestureConfig> = {}) {
    this.config = { ...DEFAULT_GESTURE_CONFIG, ...config };
  }

  getConfig(): GestureConfig {
    return this.config;
  }

  /** Update thresholds. Turning `tapDrag` off releases a pending tap. */
  setConfig(config: Partial<GestureConfig>): Gesture[] {
    const out: Gesture[] = [];
    this.config = { ...this.config, ...config };
    if (!this.config.tapDrag && this.prevTap?.pending) {
      this.endPendingTap(out, this.lastTime);
    }
    return out;
  }

  /** Number of touch pointers currently down. */
  get activePointers(): number {
    return this.tracks.size;
  }

  /** Current tap-and-a-half window (ms): how long a tap's button-up is held back. */
  tapDragWindowMs(): number {
    const c = this.config;
    const max = Math.max(0, c.doubleTapWindowMs);
    const min = Math.min(max, Math.max(0, c.tapDragMinWindowMs));
    const fromGaps = this.gaps.length > 0 ? Math.round(1.5 * Math.max(...this.gaps)) : 0;
    // Until the user's own rhythm is known, start short but never below a gap already seen.
    const value =
      this.gaps.length < GAPS_BEFORE_ADAPTING
        ? Math.max(c.tapDragInitialWindowMs, fromGaps)
        : fromGaps;
    return Math.min(max, Math.max(min, value));
  }

  /** When the next timer fires (ms), or null if none is pending. */
  nextDeadline(): number | null {
    const c = this.config;
    let deadline: number | null = null;
    const consider = (t: number) => {
      if (deadline === null || t < deadline) deadline = t;
    };
    const s = this.state;
    if (s.kind === 'single') {
      const track = this.tracks.get(s.id);
      if (track) {
        if (s.secondTap && this.prevTap?.pending) consider(track.downTime + c.tapMaxMs);
        if (c.longPress) consider(track.downTime + c.longPressMs);
      }
    } else if (s.kind === 'idle') {
      if (this.prevTap?.pending) consider(this.prevTap.upTime + this.tapDragWindowMs());
      if (this.prevMulti?.held) consider(this.prevMulti.upTime + c.doubleTapWindowMs);
    }
    return deadline;
  }

  /** Fire timers due at `timeMs`. */
  tick(timeMs: number): Gesture[] {
    const out: Gesture[] = [];
    this.runTimers(this.advance(timeMs), out);
    return out;
  }

  /** Handle one pointer sample. */
  handle(e: PointerInput): Gesture[] {
    const out: Gesture[] = [];
    if (e.pointerType === 'mouse') return out;
    if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) return out;
    const t = this.advance(e.timeMs);
    this.runTimers(t, out);
    switch (e.type) {
      case 'down':
        this.onDown(e, t, out);
        break;
      case 'move':
        this.onMove(e, t, out);
        break;
      case 'up':
        this.onUp(e, t, out);
        break;
      case 'cancel':
        this.onCancel(e, t, out);
        break;
    }
    return out;
  }

  /**
   * Abort everything (e.g. app backgrounded, mode switch). Ends active gestures as
   * cancelled and releases a pending tap; a held-back three-finger tap is dropped.
   */
  reset(timeMs: number = this.lastTime): Gesture[] {
    const out: Gesture[] = [];
    const t = Number.isFinite(timeMs) ? timeMs : 0;
    this.cancelActive(t, out);
    if (this.prevTap?.pending) this.endPendingTap(out, t);
    this.prevTap = null;
    this.prevMulti = null;
    this.tracks.clear();
    this.state = IDLE;
    return out;
  }

  // -------------------------------------------------------------------------------------

  /** Monotonic time: a timestamp going backwards is treated as "now". */
  private advance(timeMs: number): number {
    const t = Number.isFinite(timeMs) ? Math.max(timeMs, this.lastTime) : this.lastTime;
    this.lastTime = Number.isFinite(t) ? t : 0;
    return this.lastTime;
  }

  private recordGap(gap: number): void {
    if (!Number.isFinite(gap) || gap < 0) return;
    this.gaps.push(gap);
    if (this.gaps.length > GAP_HISTORY) this.gaps.shift();
  }

  private runTimers(t: number, out: Gesture[]): void {
    const c = this.config;
    const s = this.state;
    if (s.kind === 'single') {
      const track = this.tracks.get(s.id);
      if (!track) return;
      if (s.secondTap && this.prevTap?.pending && t >= track.downTime + c.tapMaxMs) {
        // Tap-and-a-half held in place: the drag starts with the button still down.
        this.prevTap = null;
        this.state = { kind: 'dt-drag', id: s.id };
        this.emitDrag(out, 'double-tap-drag', 'start', track, track.downTime + c.tapMaxMs);
        return;
      }
      if (c.longPress && t >= track.downTime + c.longPressMs) {
        const at = track.downTime + c.longPressMs;
        this.flushMulti(out, at);
        if (this.prevTap?.pending) this.endPendingTap(out, at);
        this.prevTap = null;
        this.state = { kind: 'long-pressed', id: s.id };
        out.push({
          type: 'long-press',
          phase: 'start',
          x: track.startX,
          y: track.startY,
          cancelled: false,
          timeMs: at,
        });
      }
      return;
    }
    if (s.kind !== 'idle') return;
    const p = this.prevTap;
    if (p?.pending) {
      const due = p.upTime + this.tapDragWindowMs();
      if (t >= due) this.endPendingTap(out, due);
    }
    const m = this.prevMulti;
    if (m?.held && t >= m.upTime + c.doubleTapWindowMs) {
      this.flushMulti(out, m.upTime + c.doubleTapWindowMs);
    }
  }

  /** Release a pending tap (tap-drag mode). Keeps `prevTap` for double-tap matching. */
  private endPendingTap(out: Gesture[], timeMs: number): void {
    const p = this.prevTap;
    if (!p?.pending) return;
    out.push({ type: 'pending-tap', phase: 'end', x: p.x, y: p.y, timeMs });
    this.prevTap = { ...p, pending: false };
  }

  /** Emit a held-back three-finger tap, if any, and forget the previous multi tap. */
  private flushMulti(out: Gesture[], timeMs: number): void {
    const m = this.prevMulti;
    if (!m) return;
    if (m.held) out.push({ type: 'three-finger-tap', x: m.x, y: m.y, timeMs });
    this.prevMulti = null;
  }

  private onDown(e: PointerInput, t: number, out: Gesture[]): void {
    if (this.tracks.has(e.id)) {
      // Missed up/cancel for this id: abandon the current state first.
      this.cancelActive(t, out);
      if (this.prevTap?.pending) this.endPendingTap(out, t);
      this.prevTap = null;
      this.flushMulti(out, t);
      this.tracks.clear();
      this.state = IDLE;
    }
    const track: Track = {
      id: e.id,
      startX: e.x,
      startY: e.y,
      downTime: t,
      x: e.x,
      y: e.y,
      lastX: e.x,
      lastY: e.y,
      samples: [{ x: e.x, y: e.y, t }],
    };
    this.tracks.set(e.id, track);
    const c = this.config;
    const s = this.state;
    switch (s.kind) {
      case 'idle': {
        const m = this.prevMulti;
        if (m && t > m.upTime + c.doubleTapWindowMs) this.flushMulti(out, t);
        let secondTap = false;
        const p = this.prevTap;
        if (p) {
          const gap = t - p.upTime;
          if (gap <= c.doubleTapWindowMs && dist(p.x, p.y, e.x, e.y) <= c.doubleTapSlopPx) {
            secondTap = true;
            if (c.tapDrag) this.recordGap(gap);
          } else {
            if (p.pending) this.endPendingTap(out, t);
            this.prevTap = null;
          }
        }
        this.state = { kind: 'single', id: e.id, secondTap };
        return;
      }
      case 'single': {
        if (this.prevTap?.pending) this.endPendingTap(out, t);
        this.prevTap = null;
        const first = this.tracks.get(s.id);
        this.state = {
          kind: 'multi',
          ids: [s.id, e.id],
          startTime: first?.downTime ?? t,
          landings: [
            { x: first?.startX ?? e.x, y: first?.startY ?? e.y },
            { x: e.x, y: e.y },
          ],
          tapEligible: true,
          lifted: false,
          maxCount: 2,
        };
        return;
      }
      case 'pan': {
        const first = this.tracks.get(s.id);
        if (first) this.emitDrag(out, 'pan', 'end', first, t, false, true);
        this.startNonTapMulti([s.id, e.id], t);
        return;
      }
      case 'long-pressed': {
        const first = this.tracks.get(s.id);
        if (first) {
          out.push({
            type: 'long-press',
            phase: 'end',
            x: first.x,
            y: first.y,
            cancelled: true,
            timeMs: t,
          });
        }
        this.startNonTapMulti([s.id, e.id], t);
        return;
      }
      case 'multi': {
        if (s.tapEligible && !s.lifted && s.ids.length < 3) {
          s.ids.push(e.id);
          s.landings.push({ x: e.x, y: e.y });
          s.maxCount = Math.max(s.maxCount, s.ids.length);
        } else if (s.lifted || s.ids.length >= 3) {
          this.flushMulti(out, t);
          this.state = { kind: 'wait-all-up' };
        }
        // Otherwise (non-tap candidate with two fingers): ignore the extra finger.
        return;
      }
      case 'lp-drag':
      case 'dt-drag':
      case 'two-pan':
      case 'pinch':
      case 'wait-all-up':
        // Extra finger: ignored.
        return;
    }
  }

  /** Two fingers that can only become a pinch or a two-finger pan, measured from now. */
  private startNonTapMulti(ids: number[], t: number): void {
    for (const id of ids) {
      const tr = this.tracks.get(id);
      if (tr) {
        tr.startX = tr.x;
        tr.startY = tr.y;
      }
    }
    this.state = {
      kind: 'multi',
      ids,
      startTime: t,
      landings: [],
      tapEligible: false,
      lifted: false,
      maxCount: ids.length,
    };
  }

  private onMove(e: PointerInput, t: number, out: Gesture[]): void {
    const track = this.tracks.get(e.id);
    if (!track) return;
    this.updateTrack(track, e.x, e.y, t);
    this.afterMove(track, t, out);
  }

  private updateTrack(track: Track, x: number, y: number, t: number): void {
    track.x = x;
    track.y = y;
    track.samples.push({ x, y, t });
    const horizon = t - this.config.velocityWindowMs * 2;
    while (track.samples.length > 2 && (track.samples[0]?.t ?? t) < horizon) {
      track.samples.shift();
    }
  }

  private afterMove(track: Track, t: number, out: Gesture[]): void {
    const c = this.config;
    const s = this.state;
    switch (s.kind) {
      case 'single': {
        if (s.id !== track.id) return;
        if (dist(track.x, track.y, track.startX, track.startY) <= c.tapSlopPx) return;
        this.flushMulti(out, t);
        if (s.secondTap && this.prevTap?.pending) {
          // Tap-and-a-half: the button from the first tap is still down.
          this.prevTap = null;
          this.state = { kind: 'dt-drag', id: track.id };
          this.emitDragStartAndMove(out, 'double-tap-drag', track, t);
        } else {
          if (this.prevTap?.pending) this.endPendingTap(out, t);
          this.prevTap = null;
          this.state = { kind: 'pan', id: track.id };
          this.emitDragStartAndMove(out, 'pan', track, t);
        }
        return;
      }
      case 'long-pressed': {
        if (s.id !== track.id) return;
        if (dist(track.x, track.y, track.startX, track.startY) <= c.tapSlopPx) return;
        this.state = { kind: 'lp-drag', id: track.id };
        this.emitDragStartAndMove(out, 'long-press-drag', track, t);
        return;
      }
      case 'pan':
        if (s.id === track.id) this.emitDrag(out, 'pan', 'move', track, t);
        return;
      case 'lp-drag':
        if (s.id === track.id) this.emitDrag(out, 'long-press-drag', 'move', track, t);
        return;
      case 'dt-drag':
        if (s.id === track.id) this.emitDrag(out, 'double-tap-drag', 'move', track, t);
        return;
      case 'multi':
        this.multiMove(s, track, t, out);
        return;
      case 'two-pan':
      case 'pinch':
        if (track.id === s.a || track.id === s.b) this.twoFingerMove(s, t, out);
        return;
      case 'idle':
      case 'wait-all-up':
        return;
    }
  }

  private multiMove(
    s: Extract<State, { kind: 'multi' }>,
    track: Track,
    t: number,
    out: Gesture[],
  ): void {
    const c = this.config;
    if (!s.ids.includes(track.id)) return;
    if (dist(track.x, track.y, track.startX, track.startY) > c.multiTouchSlopPx) {
      s.tapEligible = false;
    }
    if (s.lifted || s.maxCount >= 3) {
      if (!s.tapEligible) {
        this.flushMulti(out, t);
        this.state = { kind: 'wait-all-up' };
      }
      return;
    }
    const [ida, idb] = s.ids;
    const a = ida === undefined ? undefined : this.tracks.get(ida);
    const b = idb === undefined ? undefined : this.tracks.get(idb);
    if (!a || !b) return;
    const startSpan = dist(a.startX, a.startY, b.startX, b.startY);
    const span = dist(a.x, a.y, b.x, b.y);
    const scx = (a.startX + b.startX) / 2;
    const scy = (a.startY + b.startY) / 2;
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    const spanChange = Math.abs(span - startSpan);
    const centroidMove = dist(cx, cy, scx, scy);
    const isPinch =
      spanChange >= c.pinchThresholdPx && spanChange >= c.pinchDominance * centroidMove;
    const isPan = !isPinch && centroidMove >= c.twoFingerPanThresholdPx;
    if (!isPinch && !isPan) return;

    this.flushMulti(out, t);
    const kind = isPinch ? 'pinch' : 'two-pan';
    const safeStartSpan = startSpan > 0 ? startSpan : 1;
    const next: Extract<State, { kind: 'two-pan' | 'pinch' }> = {
      kind,
      a: a.id,
      b: b.id,
      lastCx: scx,
      lastCy: scy,
      lastSpan: safeStartSpan,
      startSpan: safeStartSpan,
    };
    this.state = next;
    if (kind === 'pinch') {
      out.push({
        type: 'pinch',
        phase: 'start',
        x: scx,
        y: scy,
        dx: 0,
        dy: 0,
        scale: 1,
        totalScale: 1,
        cancelled: false,
        timeMs: t,
      });
    } else {
      out.push({
        type: 'two-finger-pan',
        phase: 'start',
        x: scx,
        y: scy,
        dx: 0,
        dy: 0,
        vx: 0,
        vy: 0,
        cancelled: false,
        timeMs: t,
      });
    }
    this.twoFingerMove(next, t, out);
  }

  private twoFingerMove(
    s: Extract<State, { kind: 'two-pan' | 'pinch' }>,
    t: number,
    out: Gesture[],
    phase: GesturePhase = 'move',
    cancelled = false,
  ): void {
    const a = this.tracks.get(s.a);
    const b = this.tracks.get(s.b);
    if (!a || !b) return;
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    const dx = cx - s.lastCx;
    const dy = cy - s.lastCy;
    if (s.kind === 'pinch') {
      const span = Math.max(1, dist(a.x, a.y, b.x, b.y));
      const scale = span / s.lastSpan;
      if (phase === 'move' && dx === 0 && dy === 0 && scale === 1) return;
      out.push({
        type: 'pinch',
        phase,
        x: cx,
        y: cy,
        dx,
        dy,
        scale,
        totalScale: span / s.startSpan,
        cancelled,
        timeMs: t,
      });
      s.lastSpan = span;
    } else {
      if (phase === 'move' && dx === 0 && dy === 0) return;
      const va = this.velocity(a, t);
      const vb = this.velocity(b, t);
      out.push({
        type: 'two-finger-pan',
        phase,
        x: cx,
        y: cy,
        dx,
        dy,
        vx: cancelled ? 0 : (va.vx + vb.vx) / 2,
        vy: cancelled ? 0 : (va.vy + vb.vy) / 2,
        cancelled,
        timeMs: t,
      });
    }
    s.lastCx = cx;
    s.lastCy = cy;
  }

  private onUp(e: PointerInput, t: number, out: Gesture[]): void {
    const track = this.tracks.get(e.id);
    if (!track) return;
    if (track.x !== e.x || track.y !== e.y) {
      this.updateTrack(track, e.x, e.y, t);
      this.afterMove(track, t, out);
    }
    const c = this.config;
    const s = this.state;
    switch (s.kind) {
      case 'single': {
        // Still 'single' means: within slop and released before the long press fired (or
        // with long presses off, released in place after any hold).
        this.tracks.delete(e.id);
        this.state = IDLE;
        this.flushMulti(out, t);
        if (s.secondTap) {
          const p = this.prevTap;
          if (p) {
            if (p.pending) this.endPendingTap(out, t);
            out.push({
              type: 'double-tap',
              x: track.x,
              y: track.y,
              firstX: p.x,
              firstY: p.y,
              timeMs: t,
            });
          }
          this.prevTap = null;
          return;
        }
        if (c.tapDrag) {
          out.push({
            type: 'pending-tap',
            phase: 'start',
            x: track.startX,
            y: track.startY,
            timeMs: t,
          });
          this.prevTap = { x: track.startX, y: track.startY, upTime: t, pending: true };
        } else {
          out.push({ type: 'tap', x: track.startX, y: track.startY, timeMs: t });
          this.prevTap = { x: track.startX, y: track.startY, upTime: t, pending: false };
        }
        return;
      }
      case 'pan':
        this.emitDrag(out, 'pan', 'end', track, t);
        break;
      case 'long-pressed':
        out.push({
          type: 'long-press',
          phase: 'end',
          x: track.startX,
          y: track.startY,
          cancelled: false,
          timeMs: t,
        });
        break;
      case 'lp-drag':
        if (s.id === track.id) this.emitDrag(out, 'long-press-drag', 'end', track, t);
        else {
          this.tracks.delete(e.id);
          return;
        }
        break;
      case 'dt-drag':
        if (s.id === track.id) this.emitDrag(out, 'double-tap-drag', 'end', track, t);
        else {
          this.tracks.delete(e.id);
          return;
        }
        break;
      case 'multi': {
        this.tracks.delete(e.id);
        if (s.ids.includes(e.id)) s.lifted = true;
        if (this.tracks.size > 0) return;
        this.state = IDLE;
        if (s.tapEligible && t - s.startTime < c.longPressMs) {
          this.emitMultiTap(s, t, out);
        } else {
          this.flushMulti(out, t);
        }
        return;
      }
      case 'two-pan':
      case 'pinch':
        if (track.id === s.a || track.id === s.b) this.twoFingerMove(s, t, out, 'end');
        else {
          this.tracks.delete(e.id);
          return;
        }
        break;
      case 'idle':
      case 'wait-all-up':
        break;
    }
    this.tracks.delete(e.id);
    this.state = this.tracks.size > 0 ? { kind: 'wait-all-up' } : IDLE;
  }

  private emitMultiTap(s: Extract<State, { kind: 'multi' }>, t: number, out: Gesture[]): void {
    const n = s.landings.length;
    if (n === 0) return;
    let sx = 0;
    let sy = 0;
    for (const p of s.landings) {
      sx += p.x;
      sy += p.y;
    }
    const x = sx / n;
    const y = sy / n;
    const count: 2 | 3 = s.maxCount >= 3 ? 3 : 2;
    const window = this.config.doubleTapWindowMs;
    const prev = this.prevMulti;
    const isDouble = prev !== null && prev.count === count && s.startTime - prev.upTime <= window;
    if (isDouble) {
      // The first of the pair was either emitted (two fingers) or held back (three).
      this.prevMulti = null;
      out.push({
        type: count === 3 ? 'three-finger-double-tap' : 'two-finger-double-tap',
        x,
        y,
        timeMs: t,
      });
      return;
    }
    this.flushMulti(out, t);
    if (count === 3) {
      this.prevMulti = { count, x, y, upTime: t, held: true };
    } else {
      out.push({ type: 'two-finger-tap', x, y, timeMs: t });
      this.prevMulti = { count, x, y, upTime: t, held: false };
    }
  }

  private onCancel(e: PointerInput, t: number, out: Gesture[]): void {
    if (!this.tracks.has(e.id)) return;
    this.cancelActive(t, out);
    if (this.prevTap?.pending) this.endPendingTap(out, t);
    this.prevTap = null;
    this.prevMulti = null;
    this.tracks.delete(e.id);
    this.state = this.tracks.size > 0 ? { kind: 'wait-all-up' } : IDLE;
  }

  /** End the active gesture, if any, as cancelled. Does not touch tracks. */
  private cancelActive(t: number, out: Gesture[]): void {
    const s = this.state;
    switch (s.kind) {
      case 'pan':
      case 'lp-drag':
      case 'dt-drag': {
        const track = this.tracks.get(s.id);
        const type =
          s.kind === 'pan' ? 'pan' : s.kind === 'lp-drag' ? 'long-press-drag' : 'double-tap-drag';
        if (track) this.emitDrag(out, type, 'end', track, t, true);
        break;
      }
      case 'long-pressed': {
        const track = this.tracks.get(s.id);
        if (track) {
          out.push({
            type: 'long-press',
            phase: 'end',
            x: track.x,
            y: track.y,
            cancelled: true,
            timeMs: t,
          });
        }
        break;
      }
      case 'two-pan':
      case 'pinch':
        this.twoFingerMove(s, t, out, 'end', true);
        break;
      case 'idle':
      case 'single':
      case 'multi':
      case 'wait-all-up':
        break;
    }
    this.state = { kind: 'wait-all-up' };
  }

  private emitDragStartAndMove(
    out: Gesture[],
    type: DragGesture['type'],
    track: Track,
    t: number,
  ): void {
    const curX = track.x;
    const curY = track.y;
    track.lastX = track.startX;
    track.lastY = track.startY;
    out.push({
      type,
      phase: 'start',
      x: track.startX,
      y: track.startY,
      dx: 0,
      dy: 0,
      vx: 0,
      vy: 0,
      cancelled: false,
      timeMs: t,
    });
    if (curX !== track.startX || curY !== track.startY) this.emitDrag(out, type, 'move', track, t);
  }

  private emitDrag(
    out: Gesture[],
    type: DragGesture['type'],
    phase: GesturePhase,
    track: Track,
    t: number,
    cancelled = false,
    noVelocity = false,
  ): void {
    const dx = phase === 'start' ? 0 : track.x - track.lastX;
    const dy = phase === 'start' ? 0 : track.y - track.lastY;
    const v =
      cancelled || noVelocity || phase === 'start' ? { vx: 0, vy: 0 } : this.velocity(track, t);
    out.push({
      type,
      phase,
      x: phase === 'start' ? track.startX : track.x,
      y: phase === 'start' ? track.startY : track.y,
      dx,
      dy,
      vx: v.vx,
      vy: v.vy,
      cancelled,
      timeMs: t,
    });
    if (phase !== 'start') {
      track.lastX = track.x;
      track.lastY = track.y;
    }
  }

  /** Velocity over the recent window; 0 if the finger has not moved within the window. */
  private velocity(track: Track, t: number): { vx: number; vy: number } {
    const w = this.config.velocityWindowMs;
    const samples = track.samples;
    const last = samples[samples.length - 1];
    if (!last || t - last.t > w) return { vx: 0, vy: 0 };
    let first: Sample = last;
    for (const s of samples) {
      if (s.t >= last.t - w) {
        first = s;
        break;
      }
    }
    const dt = last.t - first.t;
    if (dt <= 0) return { vx: 0, vy: 0 };
    return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
  }
}
