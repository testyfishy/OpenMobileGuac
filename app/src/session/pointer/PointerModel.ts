/**
 * PointerModel: semantic gestures + the current Viewport in, remote mouse states, viewport
 * commands and haptic hints out (SPEC PTR-1, PTR-2, PTR-3, PTR-7, PTR-4 hints).
 *
 * Pure TypeScript: no DOM, no timers. The model never mutates the viewport; it returns
 * `ViewportCommand`s that the host applies with `applyViewportCommand` before handing the
 * next gesture in.
 *
 * Mouse states mirror the library's `Guacamole.Mouse.State` fields (x, y, left, middle,
 * right, up, down) in integer remote pixels, clamped to the remote framebuffer. Each
 * gesture yields an ordered list (e.g. a direct tap = move, press, release). A state equal
 * to the previously emitted one is skipped. Wheel notches are press+release of `up`/`down`
 * (how Guacamole encodes the wheel); there is no horizontal wheel in that state.
 *
 * Mode summary:
 * - direct: tap = left click at the finger; double-tap = second click at the first tap's
 *   pixel (the first click was the tap); long-press = right click on release (only a
 *   haptic while held, so moving instead gives a left drag without a stray context menu);
 *   long-press-drag = left drag; one-finger pan = viewport pan with fling (or left drag,
 *   `directPan: 'drag'`); two-finger pan = wheel at the fingers' centroid (or viewport pan);
 *   pinch = zoom. Taps/presses that land on letterbox bars outside the remote are ignored.
 * - trackpad: one-finger pan = relative pointer motion (speed + acceleration, in screen
 *   terms so it feels the same at every zoom); tap = left click at the pointer; two-finger
 *   tap = right click; three-finger tap = middle click; double-tap-and-hold = left drag;
 *   long-press = left drag too (or right click, `trackpadLongPress`); two-finger pan =
 *   wheel; pinch = zoom; after every pointer move the viewport is asked to keep the
 *   pointer visible (follow-pointer, also above the soft keyboard).
 *
 * Held buttons are always released when a drag ends, is cancelled, the mode changes, or
 * the remote is resized.
 */

import type { DragGesture, Gesture, PinchGesture } from '../gesture/GestureRecognizer.ts';
import {
  clampToRemotePixel,
  isOverContent,
  scaleOf,
  screenToRemote,
  type Point,
  type ViewportCommand,
  type ViewportState,
} from '../viewport/Viewport.ts';

export type PointerMode = 'direct' | 'trackpad';

export interface MouseState {
  readonly x: number;
  readonly y: number;
  readonly left: boolean;
  readonly middle: boolean;
  readonly right: boolean;
  readonly up: boolean;
  readonly down: boolean;
}

export type HapticHint = 'click' | 'right-click' | 'drag-start';

export interface PointerOutput {
  readonly mouse: MouseState[];
  readonly viewport: ViewportCommand[];
  readonly haptics: HapticHint[];
}

export interface PointerConfig {
  readonly mode: PointerMode;
  /** Direct mode one-finger pan: move the viewport, or left-drag on the remote. */
  readonly directPan: 'viewport' | 'drag';
  /** Two-finger drag: scroll wheel, or move the viewport (PTR-7). */
  readonly twoFingerPan: 'scroll' | 'viewport';
  /** Natural scrolling: content follows the fingers (fingers up = wheel down). */
  readonly naturalScroll: boolean;
  /** Finger travel (screen px) per wheel notch. */
  readonly scrollStepPx: number;
  /** Trackpad base gain: screen px of pointer travel per px of finger travel. */
  readonly pointerSpeed: number;
  /** Trackpad acceleration: 0 = linear; gain grows up to (1 + 2 * acceleration)×. */
  readonly pointerAcceleration: number;
  /** Trackpad long press: start a left drag, or right click on release. */
  readonly trackpadLongPress: 'drag' | 'right-click';
  /** Margin (screen px) kept around the pointer by follow-pointer. */
  readonly followMarginPx: number;
}

export const DEFAULT_POINTER_CONFIG: PointerConfig = {
  mode: 'direct',
  directPan: 'viewport',
  twoFingerPan: 'scroll',
  naturalScroll: true,
  scrollStepPx: 30,
  pointerSpeed: 1,
  pointerAcceleration: 1,
  trackpadLongPress: 'drag',
  followMarginPx: 48,
};

/** Finger speeds (screen px/ms) between which the acceleration ramps in. */
const ACCEL_LOW_SPEED = 0.1;
const ACCEL_HIGH_SPEED = 1.5;

/**
 * Trackpad gain for a finger speed (px/ms). Monotonic, equals `pointerSpeed` for slow
 * movement (so precise nudges are 1:1-ish) and reaches `pointerSpeed * (1 + 2 * accel)`
 * for fast flicks, with a smoothstep in between.
 */
export function accelerationGain(
  speedPxPerMs: number,
  config: Pick<PointerConfig, 'pointerSpeed' | 'pointerAcceleration'>,
): number {
  const base = Math.max(0, config.pointerSpeed);
  const accel = Math.max(0, config.pointerAcceleration);
  const v = Number.isFinite(speedPxPerMs) ? Math.abs(speedPxPerMs) : 0;
  const u = Math.min(1, Math.max(0, (v - ACCEL_LOW_SPEED) / (ACCEL_HIGH_SPEED - ACCEL_LOW_SPEED)));
  const smooth = u * u * (3 - 2 * u);
  return base * (1 + 2 * accel * smooth);
}

/**
 * Accumulates finger travel into discrete wheel notches. Positive = wheel down.
 * The remainder carries over between moves and is dropped on `reset()`.
 */
export class ScrollAccumulator {
  private acc = 0;
  private stepPx: number;

  constructor(stepPx: number) {
    this.stepPx = stepPx;
  }

  setStep(stepPx: number): void {
    this.stepPx = stepPx;
  }

  /** Add travel; returns whole notches (positive = down, negative = up). */
  add(amount: number): number {
    if (!Number.isFinite(amount)) return 0;
    const step = this.stepPx > 0 ? this.stepPx : 1;
    this.acc += amount;
    const notches = Math.trunc(this.acc / step);
    this.acc -= notches * step;
    return notches;
  }

  reset(): void {
    this.acc = 0;
  }
}

/** Press+release states for `notches` wheel steps at `base` (positive = down). */
export function wheelStates(base: MouseState, notches: number): MouseState[] {
  const out: MouseState[] = [];
  const n = Math.min(Math.abs(Math.trunc(notches)), 100);
  const key = notches > 0 ? 'down' : 'up';
  for (let i = 0; i < n; i++) {
    out.push({ ...base, up: false, down: false, [key]: true });
    out.push({ ...base, up: false, down: false });
  }
  return out;
}

export interface HardwareMouseInput {
  /** Screen coordinates. */
  readonly x: number;
  readonly y: number;
  readonly left: boolean;
  readonly middle: boolean;
  readonly right: boolean;
}

/**
 * Hardware mouse / trackpad / stylus hover bypass (PTR-5): the position maps straight
 * through the viewport and buttons map 1:1. Use `wheelStates` + `ScrollAccumulator` for the
 * wheel.
 */
export function mapHardwareMouse(viewport: ViewportState, input: HardwareMouseInput): MouseState {
  const p = clampToRemotePixel(viewport, screenToRemote(viewport, input));
  return {
    x: p.x,
    y: p.y,
    left: input.left,
    middle: input.middle,
    right: input.right,
    up: false,
    down: false,
  };
}

interface Buttons {
  left: boolean;
  middle: boolean;
  right: boolean;
}

type DragOwner = 'pan' | 'long-press-drag' | 'double-tap-drag' | 'long-press';

export class PointerModel {
  private config: PointerConfig;
  /** Remote-space pointer position, kept as a float so slow trackpad moves accumulate. */
  private pointer: Point = { x: 0, y: 0 };
  private pointerInitialised = false;
  private buttons: Buttons = { left: false, middle: false, right: false };
  private last: MouseState | null = null;
  private readonly scroll: ScrollAccumulator;
  /** Which gesture currently holds the left button (if any). */
  private dragOwner: DragOwner | null = null;
  /** Direct-mode long press origin (remote), or null if it landed off-content. */
  private longPressOrigin: Point | null = null;
  /** A drag whose start landed off-content is ignored until it ends. */
  private ignoring: DragOwner | null = null;

  constructor(config: Partial<PointerConfig> = {}) {
    this.config = { ...DEFAULT_POINTER_CONFIG, ...config };
    this.scroll = new ScrollAccumulator(this.config.scrollStepPx);
  }

  getConfig(): PointerConfig {
    return this.config;
  }

  get mode(): PointerMode {
    return this.config.mode;
  }

  /** Options the GestureRecognizer needs for the current mode. */
  recognizerOptions(): { deferTapForDoubleTapDrag: boolean } {
    return { deferTapForDoubleTapDrag: this.config.mode === 'trackpad' };
  }

  /** Current pointer in remote pixels (rounded). */
  getPointer(viewport: ViewportState): Point {
    this.initPointer(viewport);
    return clampToRemotePixel(viewport, this.pointer);
  }

  /** Move the trackpad pointer (e.g. to sync with the remote cursor). Emits nothing. */
  setPointer(remote: Point): void {
    this.pointer = { x: remote.x, y: remote.y };
    this.pointerInitialised = true;
  }

  /**
   * Change config. A mode change releases held buttons (the host should also `reset()` the
   * GestureRecognizer and apply `recognizerOptions()`).
   */
  setConfig(config: Partial<PointerConfig>, viewport: ViewportState): PointerOutput {
    const prev = this.config;
    this.config = { ...this.config, ...config };
    this.scroll.setStep(this.config.scrollStepPx);
    // Changing anything that decides how an in-flight gesture ends must release held
    // buttons, or the gesture's end would take a different branch and never release.
    const behaviourChanged =
      prev.mode !== this.config.mode ||
      prev.directPan !== this.config.directPan ||
      prev.trackpadLongPress !== this.config.trackpadLongPress ||
      prev.twoFingerPan !== this.config.twoFingerPan;
    if (behaviourChanged) return this.releaseAll(viewport);
    return emptyOutput();
  }

  /** Release every held button and forget in-flight gestures. */
  releaseAll(viewport: ViewportState): PointerOutput {
    const out = emptyOutput();
    this.initPointer(viewport);
    if (this.buttons.left || this.buttons.middle || this.buttons.right) {
      this.buttons = { left: false, middle: false, right: false };
      this.emit(out, viewport);
    }
    this.dragOwner = null;
    this.longPressOrigin = null;
    this.ignoring = null;
    this.scroll.reset();
    return out;
  }

  /** Call after the remote framebuffer changes size: clamps the pointer, releases buttons. */
  handleRemoteResize(viewport: ViewportState): PointerOutput {
    const out = this.releaseAll(viewport);
    this.pointer = clampFloat(viewport, this.pointer);
    return out;
  }

  /** Hardware mouse bypass that also keeps the model's pointer and buttons in sync. */
  handleHardwareMouse(input: HardwareMouseInput, viewport: ViewportState): PointerOutput {
    const out = emptyOutput();
    const state = mapHardwareMouse(viewport, input);
    this.pointer = { x: state.x, y: state.y };
    this.pointerInitialised = true;
    this.buttons = { left: input.left, middle: input.middle, right: input.right };
    this.push(out, state);
    return out;
  }

  /** Translate one gesture. */
  handle(g: Gesture, viewport: ViewportState): PointerOutput {
    const out = emptyOutput();
    this.initPointer(viewport);
    // Gestures common to both modes.
    switch (g.type) {
      case 'pinch':
        this.pinch(g, out);
        return out;
      case 'two-finger-pan':
        this.twoFingerPan(g, viewport, out);
        return out;
      default:
        break;
    }
    if (this.config.mode === 'direct') this.direct(g, viewport, out);
    else this.trackpad(g, viewport, out);
    return out;
  }

  // -------------------------------------------------------------------------------------
  // Direct mode

  private direct(g: Gesture, vp: ViewportState, out: PointerOutput): void {
    switch (g.type) {
      case 'tap':
        if (this.moveToScreen(vp, g, out)) this.click(vp, out, 'left');
        return;
      case 'double-tap':
        // The first click was the tap; land the second on the first tap's pixel.
        if (this.moveToScreen(vp, { x: g.firstX, y: g.firstY }, out)) this.click(vp, out, 'left');
        return;
      case 'long-press':
        if (g.phase === 'start') {
          if (isOverContent(vp, g)) {
            this.longPressOrigin = screenToRemote(vp, g);
            out.haptics.push('right-click');
          } else {
            this.longPressOrigin = null;
          }
        } else {
          const origin = this.longPressOrigin;
          this.longPressOrigin = null;
          if (origin && !g.cancelled) {
            this.pointer = origin;
            this.emit(out, vp);
            // The haptic was already given when the long press was recognised.
            this.click(vp, out, 'right', false);
          }
        }
        return;
      case 'long-press-drag':
      case 'double-tap-drag':
        this.longPressOrigin = null;
        this.directDrag(g, vp, out);
        return;
      case 'pan':
        if (this.config.directPan === 'drag') {
          this.directDrag(g, vp, out);
          return;
        }
        if (g.phase === 'start') out.viewport.push({ type: 'stop-fling' });
        else if (g.phase === 'move') out.viewport.push({ type: 'pan', dx: g.dx, dy: g.dy });
        else {
          if (g.dx !== 0 || g.dy !== 0) out.viewport.push({ type: 'pan', dx: g.dx, dy: g.dy });
          if (!g.cancelled && (g.vx !== 0 || g.vy !== 0)) {
            out.viewport.push({ type: 'fling', vx: g.vx, vy: g.vy });
          }
        }
        return;
      case 'two-finger-tap':
      case 'three-finger-tap':
        // Not mapped in direct mode (PTR-1 does not define them).
        return;
      case 'pinch':
      case 'two-finger-pan':
        return;
    }
  }

  private directDrag(g: DragGesture, vp: ViewportState, out: PointerOutput): void {
    const owner: DragOwner = g.type === 'two-finger-pan' ? 'pan' : g.type;
    if (g.phase === 'start') {
      if (!isOverContent(vp, g)) {
        this.ignoring = owner;
        return;
      }
      this.ignoring = null;
      this.moveToScreen(vp, g, out);
      this.press(vp, out, owner);
      return;
    }
    if (this.ignoring === owner) {
      if (g.phase === 'end') this.ignoring = null;
      return;
    }
    if (this.dragOwner !== owner) return;
    this.pointer = clampFloat(vp, screenToRemote(vp, g));
    if (g.phase === 'move') this.emit(out, vp);
    else this.release(vp, out);
  }

  // -------------------------------------------------------------------------------------
  // Trackpad mode

  private trackpad(g: Gesture, vp: ViewportState, out: PointerOutput): void {
    switch (g.type) {
      case 'tap':
        this.click(vp, out, 'left');
        return;
      case 'double-tap':
        this.click(vp, out, 'left');
        return;
      case 'two-finger-tap':
        this.click(vp, out, 'right');
        return;
      case 'three-finger-tap':
        this.click(vp, out, 'middle');
        return;
      case 'long-press':
        if (this.config.trackpadLongPress === 'drag') {
          if (g.phase === 'start') this.press(vp, out, 'long-press');
          else if (this.dragOwner === 'long-press') this.release(vp, out);
        } else if (g.phase === 'start') {
          out.haptics.push('right-click');
        } else if (!g.cancelled) {
          this.click(vp, out, 'right', false);
        }
        return;
      case 'long-press-drag':
        if (g.phase === 'start') {
          // With long-press = drag the button is already down; just hand ownership over.
          if (this.dragOwner === 'long-press') this.dragOwner = 'long-press-drag';
          else this.press(vp, out, 'long-press-drag');
          return;
        }
        if (this.dragOwner !== 'long-press-drag') return;
        this.relativeMove(g, vp, out);
        if (g.phase === 'end') this.release(vp, out);
        return;
      case 'double-tap-drag':
        if (g.phase === 'start') {
          this.press(vp, out, 'double-tap-drag');
          return;
        }
        if (this.dragOwner !== 'double-tap-drag') return;
        this.relativeMove(g, vp, out);
        if (g.phase === 'end') this.release(vp, out);
        return;
      case 'pan':
        if (g.phase === 'start') out.viewport.push({ type: 'stop-fling' });
        else this.relativeMove(g, vp, out);
        return;
      case 'pinch':
      case 'two-finger-pan':
        return;
    }
  }

  private relativeMove(
    g: { dx: number; dy: number; vx: number; vy: number },
    vp: ViewportState,
    out: PointerOutput,
  ): void {
    if (g.dx === 0 && g.dy === 0) return;
    const gain = accelerationGain(Math.hypot(g.vx, g.vy), this.config);
    const scale = scaleOf(vp);
    const k = scale > 0 ? gain / scale : gain;
    this.pointer = clampFloat(vp, {
      x: this.pointer.x + g.dx * k,
      y: this.pointer.y + g.dy * k,
    });
    this.emit(out, vp);
    const p = clampToRemotePixel(vp, this.pointer);
    out.viewport.push({
      type: 'ensure-visible',
      x: p.x,
      y: p.y,
      margin: this.config.followMarginPx,
    });
  }

  // -------------------------------------------------------------------------------------
  // Shared

  private pinch(g: PinchGesture, out: PointerOutput): void {
    if (g.phase === 'start') {
      out.viewport.push({ type: 'stop-fling' });
      return;
    }
    // Zoom about the previous focal point, then follow the focal point's movement, so the
    // remote point under the fingers stays under the fingers.
    if (g.scale !== 1) {
      out.viewport.push({ type: 'zoom', factor: g.scale, focalX: g.x - g.dx, focalY: g.y - g.dy });
    }
    if (g.dx !== 0 || g.dy !== 0) out.viewport.push({ type: 'pan', dx: g.dx, dy: g.dy });
  }

  private twoFingerPan(g: DragGesture, vp: ViewportState, out: PointerOutput): void {
    if (this.config.twoFingerPan === 'viewport') {
      if (g.phase === 'start') out.viewport.push({ type: 'stop-fling' });
      else if (g.dx !== 0 || g.dy !== 0) out.viewport.push({ type: 'pan', dx: g.dx, dy: g.dy });
      if (g.phase === 'end' && !g.cancelled && (g.vx !== 0 || g.vy !== 0)) {
        out.viewport.push({ type: 'fling', vx: g.vx, vy: g.vy });
      }
      return;
    }
    if (g.phase === 'start') {
      this.scroll.reset();
      // Direct mode scrolls whatever is under the fingers.
      if (this.config.mode === 'direct' && isOverContent(vp, g)) this.moveToScreen(vp, g, out);
      return;
    }
    const travel = this.config.naturalScroll ? -g.dy : g.dy;
    const notches = this.scroll.add(travel);
    if (notches !== 0) {
      for (const s of wheelStates(this.current(vp), notches)) this.push(out, s);
    }
    if (g.phase === 'end') this.scroll.reset();
  }

  private initPointer(vp: ViewportState): void {
    if (this.pointerInitialised) return;
    this.pointer = { x: vp.remote.width / 2, y: vp.remote.height / 2 };
    this.pointerInitialised = true;
  }

  /** Move the pointer to a screen point if it is over the content. Returns false otherwise. */
  private moveToScreen(vp: ViewportState, p: Point, out: PointerOutput): boolean {
    if (!isOverContent(vp, p)) return false;
    this.pointer = screenToRemote(vp, p);
    this.emit(out, vp);
    return true;
  }

  private click(vp: ViewportState, out: PointerOutput, button: keyof Buttons, haptic = true): void {
    if (this.buttons[button]) return; // already held by a drag; do not double-press
    this.buttons = { ...this.buttons, [button]: true };
    this.emit(out, vp);
    this.buttons = { ...this.buttons, [button]: false };
    this.emit(out, vp);
    if (haptic) out.haptics.push(button === 'right' ? 'right-click' : 'click');
  }

  private press(vp: ViewportState, out: PointerOutput, owner: DragOwner): void {
    if (this.dragOwner !== null) return;
    this.dragOwner = owner;
    this.buttons = { ...this.buttons, left: true };
    this.emit(out, vp);
    out.haptics.push('drag-start');
  }

  private release(vp: ViewportState, out: PointerOutput): void {
    this.dragOwner = null;
    if (!this.buttons.left) return;
    this.buttons = { ...this.buttons, left: false };
    this.emit(out, vp);
  }

  private current(vp: ViewportState): MouseState {
    const p = clampToRemotePixel(vp, this.pointer);
    return { x: p.x, y: p.y, ...this.buttons, up: false, down: false };
  }

  private emit(out: PointerOutput, vp: ViewportState): void {
    this.push(out, this.current(vp));
  }

  private push(out: PointerOutput, s: MouseState): void {
    const l = this.last;
    if (
      l &&
      l.x === s.x &&
      l.y === s.y &&
      l.left === s.left &&
      l.middle === s.middle &&
      l.right === s.right &&
      l.up === s.up &&
      l.down === s.down
    ) {
      return;
    }
    out.mouse.push(s);
    this.last = s;
  }
}

function emptyOutput(): PointerOutput {
  return { mouse: [], viewport: [], haptics: [] };
}

/** Clamp a float remote point into [0, size - 1] without rounding. */
function clampFloat(vp: ViewportState, p: Point): Point {
  const maxX = Math.max(0, vp.remote.width - 1);
  const maxY = Math.max(0, vp.remote.height - 1);
  const x = Number.isFinite(p.x) ? p.x : 0;
  const y = Number.isFinite(p.y) ? p.y : 0;
  return { x: Math.min(maxX, Math.max(0, x)), y: Math.min(maxY, Math.max(0, y)) };
}
