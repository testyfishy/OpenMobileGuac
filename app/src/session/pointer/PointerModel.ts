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
 * (how Guacamole encodes the wheel). Guacamole has no horizontal wheel, so horizontal
 * notches are emitted with `withShift: true`: the host holds Shift around each run of such
 * states (Shift + wheel is horizontal scrolling in most desktop apps).
 *
 * Mode summary:
 * - direct: tap = left click at the finger; double-tap = second click at the first tap's
 *   pixel (the first click was the tap); long-press = right click on release (only a
 *   haptic while held, so moving instead gives a left drag without a stray context menu);
 *   long-press-drag = left drag; one-finger pan = left drag when the whole desktop fits
 *   (nothing to pan), viewport pan with fling when zoomed in (`directPan: 'auto'`; or
 *   always drag / always pan); two-finger tap = right click and three-finger tap = middle
 *   click at the fingers' centroid; two-finger pan = wheel at the centroid (or viewport
 *   pan); pinch = zoom. Taps/presses that land on letterbox bars are ignored.
 * - trackpad: one-finger pan = relative pointer motion (speed + acceleration, in screen
 *   terms so it feels the same at every zoom); tap = left click at the pointer (with
 *   `tapDrag`, the recogniser's `pending-tap` presses on release and releases late, and a
 *   tap-and-a-half drag continues on that same press); two-finger tap = right click;
 *   three-finger tap = middle click; long-press = left drag too (or right click,
 *   `trackpadLongPress`); two-finger pan = wheel; pinch = zoom; after every pointer move the
 *   viewport is asked to keep the pointer visible (follow-pointer, also above the soft
 *   keyboard). If the pointer is outside the visible area when an interaction starts (e.g.
 *   after a pinch), it is first brought to the nearest visible point.
 * - both: three-finger double tap = reset zoom; two-finger double tap = nothing (its first
 *   tap already right-clicked; the second is swallowed so it never double right-clicks).
 *   Pinch zoom, the two- and three-finger taps and the zoom reset can each be switched off
 *   (`pinchZoom`, `twoFingerTap`, `threeFingerTap`, `threeFingerDoubleTap`): the gesture is
 *   then ignored.
 * - touch: raw multi-touch pass-through is done by the host (`TouchPassthrough`); gestures
 *   handed to this model in that mode behave as in direct mode.
 *
 * Held buttons are always released when a drag ends, is cancelled, the mode changes, or
 * the remote is resized.
 */

import type { DragGesture, Gesture, PinchGesture } from '../gesture/GestureRecognizer.ts';
import {
  canPan,
  clampToRemotePixel,
  isOverContent,
  remoteToScreen,
  scaleOf,
  screenToRemote,
  visibleRect,
  type Point,
  type ViewportCommand,
  type ViewportState,
} from '../viewport/Viewport.ts';

export type PointerMode = 'direct' | 'trackpad' | 'touch';

export const POINTER_MODES: readonly PointerMode[] = ['direct', 'trackpad', 'touch'];

export interface MouseState {
  readonly x: number;
  readonly y: number;
  readonly left: boolean;
  readonly middle: boolean;
  readonly right: boolean;
  readonly up: boolean;
  readonly down: boolean;
  /** Horizontal wheel notch: send with Shift held (see the file comment). */
  readonly withShift?: boolean;
}

export type HapticHint = 'click' | 'right-click' | 'drag-start';

export interface PointerOutput {
  readonly mouse: MouseState[];
  readonly viewport: ViewportCommand[];
  readonly haptics: HapticHint[];
}

export interface PointerConfig {
  readonly mode: PointerMode;
  /**
   * Direct mode one-finger drag: `auto` = left drag when the desktop fits the screen and
   * viewport pan when there is something to pan; `drag` = always left drag; `viewport` =
   * always pan the view.
   */
  readonly directPan: 'auto' | 'viewport' | 'drag';
  /** Trackpad tap-and-a-half drag (adds a short release delay to taps; see recogniser). */
  readonly tapDrag: boolean;
  /** Two-finger horizontal scroll as Shift + wheel; off = vertical only. */
  readonly horizontalScroll: boolean;
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
  /** Pinch zooms the view; off = pinches are ignored. */
  readonly pinchZoom: boolean;
  /** Two-finger tap = right click; off = ignored. */
  readonly twoFingerTap: boolean;
  /** Three-finger tap = middle click; off = ignored. */
  readonly threeFingerTap: boolean;
  /** Three-finger double tap = reset the zoom; off = ignored. */
  readonly threeFingerDoubleTap: boolean;
}

export const DEFAULT_POINTER_CONFIG: PointerConfig = {
  mode: 'direct',
  directPan: 'auto',
  tapDrag: true,
  horizontalScroll: true,
  twoFingerPan: 'scroll',
  naturalScroll: true,
  scrollStepPx: 30,
  pointerSpeed: 1,
  pointerAcceleration: 1,
  trackpadLongPress: 'drag',
  followMarginPx: 48,
  pinchZoom: true,
  twoFingerTap: true,
  threeFingerTap: true,
  threeFingerDoubleTap: true,
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

/**
 * Press+release states for `notches` wheel steps at `base` (positive = down). With
 * `horizontal`, positive = right: the states carry `withShift` (Shift + wheel down scrolls
 * right in most desktop apps).
 */
export function wheelStates(base: MouseState, notches: number, horizontal = false): MouseState[] {
  const out: MouseState[] = [];
  const n = Math.min(Math.abs(Math.trunc(notches)), 100);
  const key = notches > 0 ? 'down' : 'up';
  const plain = { x: base.x, y: base.y, left: base.left, middle: base.middle, right: base.right };
  const extra = horizontal ? { withShift: true } : {};
  for (let i = 0; i < n; i++) {
    out.push({ ...plain, up: false, down: false, [key]: true, ...extra });
    out.push({ ...plain, up: false, down: false, ...extra });
  }
  return out;
}

/** Travel (px) before a two-finger scroll locks onto its dominant axis. */
export const SCROLL_AXIS_LOCK_PX = 8;

/**
 * Two-finger scroll: locks onto the dominant axis once the travel reaches
 * `SCROLL_AXIS_LOCK_PX`, then accumulates notches on that axis only.
 */
export class AxisLockedScroll {
  private axis: 'x' | 'y' | null = null;
  private totalX = 0;
  private totalY = 0;
  private readonly x: ScrollAccumulator;
  private readonly y: ScrollAccumulator;

  constructor(stepPx: number) {
    this.x = new ScrollAccumulator(stepPx);
    this.y = new ScrollAccumulator(stepPx);
  }

  setStep(stepPx: number): void {
    this.x.setStep(stepPx);
    this.y.setStep(stepPx);
  }

  get lockedAxis(): 'x' | 'y' | null {
    return this.axis;
  }

  /** Add travel (positive = wheel down / right). Returns notches on the locked axis. */
  add(dx: number, dy: number, allowHorizontal: boolean): { x: number; y: number } {
    const fx = Number.isFinite(dx) ? dx : 0;
    const fy = Number.isFinite(dy) ? dy : 0;
    if (this.axis === null) {
      this.totalX += fx;
      this.totalY += fy;
      if (!allowHorizontal) this.axis = 'y';
      else if (Math.hypot(this.totalX, this.totalY) >= SCROLL_AXIS_LOCK_PX) {
        this.axis = Math.abs(this.totalX) > Math.abs(this.totalY) ? 'x' : 'y';
      } else {
        return { x: 0, y: 0 };
      }
      // Replay the travel that decided the axis.
      const replay = this.axis === 'x' ? this.totalX : this.totalY;
      return this.axis === 'x' ? { x: this.x.add(replay), y: 0 } : { x: 0, y: this.y.add(replay) };
    }
    return this.axis === 'x' ? { x: this.x.add(fx), y: 0 } : { x: 0, y: this.y.add(fy) };
  }

  reset(): void {
    this.axis = null;
    this.totalX = 0;
    this.totalY = 0;
    this.x.reset();
    this.y.reset();
  }
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

export interface RelativeMouseInput {
  /** Movement in screen px (e.g. `movementX/Y` under pointer lock). */
  readonly dx: number;
  readonly dy: number;
  readonly left: boolean;
  readonly middle: boolean;
  readonly right: boolean;
}

type DragOwner = 'pan' | 'long-press-drag' | 'double-tap-drag' | 'long-press' | 'pending-tap';

export class PointerModel {
  private config: PointerConfig;
  /** Remote-space pointer position, kept as a float so slow trackpad moves accumulate. */
  private pointer: Point = { x: 0, y: 0 };
  private pointerInitialised = false;
  private buttons: Buttons = { left: false, middle: false, right: false };
  private last: MouseState | null = null;
  private readonly scroll: AxisLockedScroll;
  /** Which gesture currently holds the left button (if any). */
  private dragOwner: DragOwner | null = null;
  /** Direct-mode long press origin (remote), or null if it landed off-content. */
  private longPressOrigin: Point | null = null;
  /** A drag whose start landed off-content is ignored until it ends. */
  private ignoring: DragOwner | null = null;
  /** Direct mode: how the current one-finger pan was resolved at its start. */
  private directPanAs: 'viewport' | 'drag' = 'viewport';

  constructor(config: Partial<PointerConfig> = {}) {
    this.config = { ...DEFAULT_POINTER_CONFIG, ...config };
    this.scroll = new AxisLockedScroll(this.config.scrollStepPx);
  }

  getConfig(): PointerConfig {
    return this.config;
  }

  get mode(): PointerMode {
    return this.config.mode;
  }

  /** Options the GestureRecognizer needs for the current mode. */
  recognizerOptions(mode: PointerMode = this.config.mode): { tapDrag: boolean } {
    return { tapDrag: mode === 'trackpad' && this.config.tapDrag };
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
      prev.tapDrag !== this.config.tapDrag ||
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
    this.dragOwner = null;
    this.push(out, state);
    return out;
  }

  /**
   * Relative hardware mouse (pointer lock): moves the pointer by screen px converted to
   * remote px (no acceleration: the OS already applied its own), buttons map 1:1, and the
   * view follows the pointer.
   */
  handleRelativeMouse(input: RelativeMouseInput, viewport: ViewportState): PointerOutput {
    const out = emptyOutput();
    this.initPointer(viewport);
    const scale = scaleOf(viewport);
    const k = scale > 0 ? 1 / scale : 1;
    const dx = Number.isFinite(input.dx) ? input.dx : 0;
    const dy = Number.isFinite(input.dy) ? input.dy : 0;
    this.pointer = clampFloat(viewport, { x: this.pointer.x + dx * k, y: this.pointer.y + dy * k });
    this.buttons = { left: input.left, middle: input.middle, right: input.right };
    this.dragOwner = null;
    this.emit(out, viewport);
    if (dx !== 0 || dy !== 0) this.follow(viewport, out);
    return out;
  }

  /**
   * Translate one gesture. `mode` overrides the configured mode for this gesture (the split
   * layout's trackpad surface is always a trackpad).
   */
  handle(g: Gesture, viewport: ViewportState, mode: PointerMode = this.config.mode): PointerOutput {
    const out = emptyOutput();
    this.initPointer(viewport);
    // Gestures common to all modes.
    switch (g.type) {
      case 'pinch':
        if (this.config.pinchZoom) this.pinch(g, out);
        return out;
      case 'two-finger-pan':
        this.twoFingerPan(g, viewport, out, mode);
        return out;
      case 'three-finger-double-tap':
        if (!this.config.threeFingerDoubleTap) return out;
        out.viewport.push({ type: 'reset' });
        out.haptics.push('click');
        return out;
      case 'two-finger-tap':
        if (!this.config.twoFingerTap) return out;
        break;
      case 'three-finger-tap':
        if (!this.config.threeFingerTap) return out;
        break;
      case 'two-finger-double-tap':
        // The first two-finger tap already right-clicked; never send a second one.
        return out;
      default:
        break;
    }
    if (mode === 'trackpad') this.trackpad(g, viewport, out);
    else this.direct(g, viewport, out);
    return out;
  }

  // -------------------------------------------------------------------------------------
  // Direct mode

  private direct(g: Gesture, vp: ViewportState, out: PointerOutput): void {
    switch (g.type) {
      case 'tap':
        if (this.moveToScreen(vp, g, out)) this.click(vp, out, 'left');
        return;
      case 'pending-tap':
        // Only produced with tapDrag (trackpad); handled as a press/release at the finger.
        if (g.phase === 'start') {
          if (this.moveToScreen(vp, g, out)) this.press(vp, out, 'pending-tap', 'click');
        } else if (this.dragOwner === 'pending-tap') {
          this.release(vp, out);
        }
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
      case 'pan': {
        if (g.phase === 'start') {
          const mode = this.config.directPan;
          this.directPanAs =
            mode === 'drag' || (mode === 'auto' && !canPan(vp)) ? 'drag' : 'viewport';
        }
        if (this.directPanAs === 'drag') {
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
      }
      case 'two-finger-tap':
        // Consistent with trackpad mode: right click, here at the fingers' centroid.
        if (this.moveToScreen(vp, g, out)) this.click(vp, out, 'right');
        return;
      case 'three-finger-tap':
        if (this.moveToScreen(vp, g, out)) this.click(vp, out, 'middle');
        return;
      case 'pinch':
      case 'two-finger-pan':
      case 'two-finger-double-tap':
      case 'three-finger-double-tap':
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
        this.bringIntoView(vp, out);
        this.click(vp, out, 'left');
        return;
      case 'pending-tap':
        if (g.phase === 'start') {
          this.bringIntoView(vp, out);
          this.press(vp, out, 'pending-tap', 'click');
        } else if (this.dragOwner === 'pending-tap') {
          this.release(vp, out);
        }
        return;
      case 'double-tap':
        this.click(vp, out, 'left');
        return;
      case 'two-finger-tap':
        this.bringIntoView(vp, out);
        this.click(vp, out, 'right');
        return;
      case 'three-finger-tap':
        this.bringIntoView(vp, out);
        this.click(vp, out, 'middle');
        return;
      case 'long-press':
        if (g.phase === 'start') this.bringIntoView(vp, out);
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
          if (this.dragOwner === 'pending-tap') {
            // Tap-and-a-half: keep the button pressed by the first tap (no up/down pair,
            // so the remote never sees a double-click-drag).
            this.dragOwner = 'double-tap-drag';
            out.haptics.push('drag-start');
          } else {
            this.press(vp, out, 'double-tap-drag');
          }
          return;
        }
        if (this.dragOwner !== 'double-tap-drag') return;
        this.relativeMove(g, vp, out);
        if (g.phase === 'end') this.release(vp, out);
        return;
      case 'pan':
        if (g.phase === 'start') {
          out.viewport.push({ type: 'stop-fling' });
          this.bringIntoView(vp, out);
        } else this.relativeMove(g, vp, out);
        return;
      case 'pinch':
      case 'two-finger-pan':
      case 'two-finger-double-tap':
      case 'three-finger-double-tap':
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
    this.follow(vp, out);
  }

  private follow(vp: ViewportState, out: PointerOutput): void {
    const p = clampToRemotePixel(vp, this.pointer);
    out.viewport.push({
      type: 'ensure-visible',
      x: p.x,
      y: p.y,
      margin: this.config.followMarginPx,
    });
  }

  /**
   * Trackpad: if the pointer is outside the visible area (e.g. the user pinched or panned
   * away from it), move it to the nearest point inside, `followMarginPx` from the edge, so
   * the next click lands where the user can see the cursor.
   */
  private bringIntoView(vp: ViewportState, out: PointerOutput): void {
    if (vp.remote.width <= 0 || vp.remote.height <= 0) return;
    const vis = visibleRect(vp);
    if (vis.width <= 0 || vis.height <= 0) return;
    const s = remoteToScreen(vp, this.pointer);
    const inside =
      s.x >= vis.x && s.y >= vis.y && s.x <= vis.x + vis.width && s.y <= vis.y + vis.height;
    if (inside) return;
    const m = Math.min(this.config.followMarginPx, vis.width / 2, vis.height / 2);
    const target = {
      x: Math.min(vis.x + vis.width - m, Math.max(vis.x + m, s.x)),
      y: Math.min(vis.y + vis.height - m, Math.max(vis.y + m, s.y)),
    };
    this.pointer = clampFloat(vp, screenToRemote(vp, target));
    this.emit(out, vp);
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

  private twoFingerPan(
    g: DragGesture,
    vp: ViewportState,
    out: PointerOutput,
    mode: PointerMode,
  ): void {
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
      // Direct mode scrolls whatever is under the fingers; trackpad scrolls at the pointer.
      if (mode !== 'trackpad' && isOverContent(vp, g)) this.moveToScreen(vp, g, out);
      else if (mode === 'trackpad') this.bringIntoView(vp, out);
      return;
    }
    const sign = this.config.naturalScroll ? -1 : 1;
    const n = this.scroll.add(sign * g.dx, sign * g.dy, this.config.horizontalScroll);
    if (n.y !== 0) for (const s of wheelStates(this.current(vp), n.y)) this.push(out, s);
    if (n.x !== 0) for (const s of wheelStates(this.current(vp), n.x, true)) this.push(out, s);
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

  private press(
    vp: ViewportState,
    out: PointerOutput,
    owner: DragOwner,
    haptic: HapticHint = 'drag-start',
  ): void {
    if (this.dragOwner !== null || this.buttons.left) return;
    this.dragOwner = owner;
    this.buttons = { ...this.buttons, left: true };
    this.emit(out, vp);
    out.haptics.push(haptic);
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
      l.down === s.down &&
      (l.withShift ?? false) === (s.withShift ?? false)
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
