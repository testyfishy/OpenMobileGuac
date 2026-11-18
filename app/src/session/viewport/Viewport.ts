/**
 * Viewport: pure maths for framing the remote desktop on the device screen.
 *
 * Covers SPEC DSP-1 (fit modes), DSP-2 (pinch zoom / pan with bounds and momentum,
 * reset to mode) and DSP-5 (follow-pointer, keep the pointer above the soft keyboard).
 *
 * All functions are pure: they take a `ViewportState` and return a new one. No DOM, no
 * timers. Time is injected (`stepFling(state, dtMs)`).
 *
 * Coordinate systems:
 * - **remote**: remote-desktop pixels, origin top-left of the remote framebuffer.
 * - **screen**: CSS pixels of the full-screen gesture overlay, origin top-left of the
 *   overlay (safe-area insets are inside this space).
 *
 * The mapping is `screen = remote * scale + offset`. `scale = baseScale(mode) * zoom`.
 *
 * Design choices:
 * - The base (fit) scale is computed from the **layout area** (screen minus safe-area
 *   insets) and deliberately ignores the soft-keyboard inset, so the desktop does not
 *   shrink every time the keyboard opens. The keyboard only reduces the **visible area**,
 *   which drives pan bounds and `ensureVisible`, so any remote point can be panned above
 *   the keyboard.
 * - User zoom is stored relative to the mode's base scale. After a rotation in fit-screen
 *   with zoom 1 the view re-fits; a zoomed-in view keeps its relative zoom.
 */

export type FitMode = 'fit-screen' | 'fit-width' | 'fit-height' | 'one-to-one';

export const FIT_MODES: readonly FitMode[] = [
  'fit-screen',
  'fit-width',
  'fit-height',
  'one-to-one',
];

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ViewportConfig {
  /** Absolute maximum scale (remote px → screen px). Raised to the base scale if lower. */
  readonly maxScale: number;
  /** Fling velocity decays as exp(-t / timeConstant). */
  readonly flingTimeConstantMs: number;
  /** Fling stops below this speed (screen px per ms). */
  readonly minFlingVelocity: number;
  /** Fling start speed is capped at this (screen px per ms). */
  readonly maxFlingVelocity: number;
}

export const DEFAULT_VIEWPORT_CONFIG: ViewportConfig = {
  maxScale: 8,
  flingTimeConstantMs: 325,
  minFlingVelocity: 0.02,
  maxFlingVelocity: 8,
};

export const ZERO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

export interface ViewportState {
  readonly remote: Size;
  readonly screen: Size;
  /** Safe-area insets (notch, gesture bar, app chrome). */
  readonly insets: Insets;
  /** Height in screen px covered by the soft keyboard, measured from the screen bottom. */
  readonly keyboardInset: number;
  readonly mode: FitMode;
  /** Zoom relative to the mode's base scale. 1 = the mode's framing. */
  readonly zoom: number;
  /** Screen position of remote (0, 0). */
  readonly offsetX: number;
  readonly offsetY: number;
  /** Fling velocity in screen px per ms. */
  readonly velocityX: number;
  readonly velocityY: number;
  readonly config: ViewportConfig;
}

export interface CreateViewportOptions {
  readonly remote: Size;
  readonly screen: Size;
  readonly insets?: Insets;
  readonly keyboardInset?: number;
  readonly mode?: FitMode;
  readonly config?: Partial<ViewportConfig>;
}

export interface Transform {
  readonly translateX: number;
  readonly translateY: number;
  readonly scale: number;
}

/** Viewport commands are data, so input models can request changes without owning state. */
export type ViewportCommand =
  | { readonly type: 'pan'; readonly dx: number; readonly dy: number }
  | {
      readonly type: 'zoom';
      readonly factor: number;
      readonly focalX: number;
      readonly focalY: number;
    }
  | { readonly type: 'fling'; readonly vx: number; readonly vy: number }
  | { readonly type: 'stop-fling' }
  | { readonly type: 'reset' }
  | {
      readonly type: 'ensure-visible';
      /** Remote coordinates. */
      readonly x: number;
      readonly y: number;
      /** Screen px margin to keep around the point. */
      readonly margin: number;
    };

// ---------------------------------------------------------------------------------------
// Helpers

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function nonNegative(value: number): number {
  return Math.max(0, finiteOr(value, 0));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sanitizeSize(size: Size): Size {
  return { width: nonNegative(size.width), height: nonNegative(size.height) };
}

function sanitizeInsets(insets: Insets): Insets {
  return {
    top: nonNegative(insets.top),
    right: nonNegative(insets.right),
    bottom: nonNegative(insets.bottom),
    left: nonNegative(insets.left),
  };
}

/** Ratio `available / content`, or 1 when either side is degenerate (avoids NaN/Infinity). */
function ratio(available: number, content: number): number {
  if (available <= 0 || content <= 0) return 1;
  return available / content;
}

// ---------------------------------------------------------------------------------------
// Geometry queries

/** Screen minus safe-area insets. Used for the fit scale. */
export function layoutRect(state: ViewportState): Rect {
  const { screen, insets } = state;
  return {
    x: insets.left,
    y: insets.top,
    width: Math.max(0, screen.width - insets.left - insets.right),
    height: Math.max(0, screen.height - insets.top - insets.bottom),
  };
}

/** Layout area further reduced by the soft keyboard. Used for pan bounds and ensureVisible. */
export function visibleRect(state: ViewportState): Rect {
  const { screen, insets } = state;
  const bottom = Math.max(insets.bottom, state.keyboardInset);
  return {
    x: insets.left,
    y: insets.top,
    width: Math.max(0, screen.width - insets.left - insets.right),
    height: Math.max(0, screen.height - insets.top - bottom),
  };
}

/** The scale at which the whole remote desktop fits the layout area. */
export function fitScreenScale(state: ViewportState): number {
  const area = layoutRect(state);
  return Math.min(ratio(area.width, state.remote.width), ratio(area.height, state.remote.height));
}

/** The scale a fit mode produces at zoom 1. */
export function baseScale(state: ViewportState, mode: FitMode = state.mode): number {
  const area = layoutRect(state);
  switch (mode) {
    case 'fit-screen':
      return fitScreenScale(state);
    case 'fit-width':
      return ratio(area.width, state.remote.width);
    case 'fit-height':
      return ratio(area.height, state.remote.height);
    case 'one-to-one':
      return 1;
  }
}

/** Current absolute scale (remote px → screen px). */
export function scaleOf(state: ViewportState): number {
  return baseScale(state) * state.zoom;
}

/** Absolute scale bounds: min = whole remote visible or the mode's base, whichever is smaller. */
export function scaleBounds(state: ViewportState): { min: number; max: number } {
  const base = baseScale(state);
  const min = Math.min(fitScreenScale(state), base);
  const max = Math.max(state.config.maxScale, base);
  return { min, max };
}

/** Zoom bounds relative to the base scale. */
export function zoomBounds(state: ViewportState): { min: number; max: number } {
  const base = baseScale(state);
  const { min, max } = scaleBounds(state);
  return { min: min / base, max: max / base };
}

export function isZoomedIn(state: ViewportState): boolean {
  return state.zoom > 1 + 1e-9;
}

/** Whether content extends beyond the visible area on either axis (i.e. panning does something). */
export function canPan(state: ViewportState): boolean {
  const scale = scaleOf(state);
  const vis = visibleRect(state);
  return (
    state.remote.width * scale > vis.width + 1e-6 || state.remote.height * scale > vis.height + 1e-6
  );
}

export function screenToRemote(state: ViewportState, p: Point): Point {
  const scale = scaleOf(state);
  return { x: (p.x - state.offsetX) / scale, y: (p.y - state.offsetY) / scale };
}

export function remoteToScreen(state: ViewportState, p: Point): Point {
  const scale = scaleOf(state);
  return { x: p.x * scale + state.offsetX, y: p.y * scale + state.offsetY };
}

/** Whether a screen point lies over the remote content (not over letterbox bars). */
export function isOverContent(state: ViewportState, screenPoint: Point): boolean {
  const r = screenToRemote(state, screenPoint);
  return r.x >= 0 && r.y >= 0 && r.x < state.remote.width && r.y < state.remote.height;
}

/** Round and clamp a remote point to a valid integer pixel of the remote framebuffer. */
export function clampToRemotePixel(state: ViewportState, p: Point): Point {
  const maxX = Math.max(0, Math.ceil(state.remote.width) - 1);
  const maxY = Math.max(0, Math.ceil(state.remote.height) - 1);
  return {
    x: clamp(Math.round(finiteOr(p.x, 0)), 0, maxX),
    y: clamp(Math.round(finiteOr(p.y, 0)), 0, maxY),
  };
}

/** Translate + scale for a CSS transform with `transform-origin: 0 0`. */
export function toTransform(state: ViewportState): Transform {
  return { translateX: state.offsetX, translateY: state.offsetY, scale: scaleOf(state) };
}

/** CSS transform string for `toTransform` (requires `transform-origin: 0 0`). */
export function toCssTransform(state: ViewportState): string {
  const t = toTransform(state);
  return `translate3d(${t.translateX}px, ${t.translateY}px, 0) scale(${t.scale})`;
}

// ---------------------------------------------------------------------------------------
// Bounds

interface AxisBounds {
  readonly min: number;
  readonly max: number;
}

/**
 * Allowed offset range on one axis. When the content is smaller than the visible extent the
 * range collapses to the centred position; otherwise content edges may not enter the
 * visible area.
 */
function axisBounds(contentSize: number, start: number, extent: number): AxisBounds {
  if (contentSize <= extent) {
    const centred = start + (extent - contentSize) / 2;
    return { min: centred, max: centred };
  }
  return { min: start + extent - contentSize, max: start };
}

export function offsetBounds(state: ViewportState): { x: AxisBounds; y: AxisBounds } {
  const scale = scaleOf(state);
  const vis = visibleRect(state);
  return {
    x: axisBounds(state.remote.width * scale, vis.x, vis.width),
    y: axisBounds(state.remote.height * scale, vis.y, vis.height),
  };
}

/** Clamp the offset into bounds; an axis that hits a bound loses its fling velocity. */
function clampPan(state: ViewportState): ViewportState {
  const b = offsetBounds(state);
  const ox = clamp(finiteOr(state.offsetX, b.x.min), b.x.min, b.x.max);
  const oy = clamp(finiteOr(state.offsetY, b.y.min), b.y.min, b.y.max);
  return {
    ...state,
    offsetX: ox,
    offsetY: oy,
    velocityX: ox === state.offsetX ? state.velocityX : 0,
    velocityY: oy === state.offsetY ? state.velocityY : 0,
  };
}

function clampZoom(state: ViewportState, zoom: number): number {
  const { min, max } = zoomBounds(state);
  return clamp(finiteOr(zoom, 1), min, max);
}

// ---------------------------------------------------------------------------------------
// Construction and mode

export function createViewport(options: CreateViewportOptions): ViewportState {
  const initial: ViewportState = {
    remote: sanitizeSize(options.remote),
    screen: sanitizeSize(options.screen),
    insets: sanitizeInsets(options.insets ?? ZERO_INSETS),
    keyboardInset: nonNegative(options.keyboardInset ?? 0),
    mode: options.mode ?? 'fit-screen',
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    velocityX: 0,
    velocityY: 0,
    config: { ...DEFAULT_VIEWPORT_CONFIG, ...options.config },
  };
  return resetToMode(initial);
}

/**
 * Return to the mode's framing: zoom 1, content centred on axes where it fits and aligned
 * top-left on axes where it overflows (like a document). Stops any fling.
 */
export function resetToMode(state: ViewportState): ViewportState {
  const s: ViewportState = { ...state, zoom: clampZoom({ ...state, zoom: 1 }, 1) };
  const vis = visibleRect(s);
  return clampPan({ ...s, offsetX: vis.x, offsetY: vis.y, velocityX: 0, velocityY: 0 });
}

export function setMode(state: ViewportState, mode: FitMode): ViewportState {
  return resetToMode({ ...state, mode });
}

// ---------------------------------------------------------------------------------------
// Zoom and pan

/** Multiply the zoom by `factor`, keeping the screen point `focal` fixed (within bounds). */
export function zoomAt(state: ViewportState, factor: number, focal: Point): ViewportState {
  if (!Number.isFinite(factor) || factor <= 0) return state;
  const oldScale = scaleOf(state);
  const zoom = clampZoom(state, state.zoom * factor);
  const next: ViewportState = { ...state, zoom };
  const applied = scaleOf(next) / oldScale;
  return clampPan({
    ...next,
    offsetX: focal.x - (focal.x - state.offsetX) * applied,
    offsetY: focal.y - (focal.y - state.offsetY) * applied,
  });
}

/** Set an absolute relative-zoom, keeping `focal` (default: visible centre) fixed. */
export function setZoom(state: ViewportState, zoom: number, focal?: Point): ViewportState {
  const vis = visibleRect(state);
  const f = focal ?? { x: vis.x + vis.width / 2, y: vis.y + vis.height / 2 };
  return zoomAt(state, zoom / state.zoom, f);
}

/** Move the content by a screen delta (content follows the finger). */
export function panBy(state: ViewportState, dx: number, dy: number): ViewportState {
  return clampPan({
    ...state,
    offsetX: state.offsetX + finiteOr(dx, 0),
    offsetY: state.offsetY + finiteOr(dy, 0),
  });
}

/**
 * Minimal pan so that the remote point is inside the visible area shrunk by `margin` screen
 * px. If the margin is larger than half the visible extent, the point is centred instead.
 * Used for follow-pointer and for keeping the pointer above the soft keyboard.
 */
export function ensureVisible(state: ViewportState, remotePoint: Point, margin = 0): ViewportState {
  const sp = remoteToScreen(state, remotePoint);
  const vis = visibleRect(state);
  const m = nonNegative(margin);
  const delta = (pos: number, start: number, extent: number): number => {
    if (m * 2 >= extent) return start + extent / 2 - pos;
    if (pos < start + m) return start + m - pos;
    if (pos > start + extent - m) return start + extent - m - pos;
    return 0;
  };
  const dx = delta(sp.x, vis.x, vis.width);
  const dy = delta(sp.y, vis.y, vis.height);
  if (dx === 0 && dy === 0) return state;
  return panBy(state, dx, dy);
}

// ---------------------------------------------------------------------------------------
// Fling / momentum

export function startFling(state: ViewportState, vx: number, vy: number): ViewportState {
  const max = state.config.maxFlingVelocity;
  const sx = clamp(finiteOr(vx, 0), -max, max);
  const sy = clamp(finiteOr(vy, 0), -max, max);
  const speed = Math.hypot(sx, sy);
  if (speed < state.config.minFlingVelocity) return stopFling(state);
  return { ...state, velocityX: sx, velocityY: sy };
}

export function stopFling(state: ViewportState): ViewportState {
  if (state.velocityX === 0 && state.velocityY === 0) return state;
  return { ...state, velocityX: 0, velocityY: 0 };
}

export function isFlinging(state: ViewportState): boolean {
  return state.velocityX !== 0 || state.velocityY !== 0;
}

/**
 * Advance a fling by `dtMs`. Velocity decays exponentially, so the distance travelled is
 * independent of how the time is sliced (up to the stop threshold). Hitting a bound stops
 * that axis.
 */
export function stepFling(state: ViewportState, dtMs: number): ViewportState {
  if (!isFlinging(state)) return state;
  const dt = nonNegative(dtMs);
  if (dt === 0) return state;
  const tau = Math.max(1, state.config.flingTimeConstantMs);
  const decay = Math.exp(-dt / tau);
  const travel = tau * (1 - decay);
  const moved = clampPan({
    ...state,
    offsetX: state.offsetX + state.velocityX * travel,
    offsetY: state.offsetY + state.velocityY * travel,
  });
  let vx = moved.velocityX * decay;
  let vy = moved.velocityY * decay;
  if (Math.hypot(vx, vy) < state.config.minFlingVelocity) {
    vx = 0;
    vy = 0;
  }
  return { ...moved, velocityX: vx, velocityY: vy };
}

// ---------------------------------------------------------------------------------------
// Layout changes

export interface LayoutChange {
  readonly screen?: Size;
  readonly insets?: Insets;
  readonly keyboardInset?: number;
  readonly remote?: Size;
}

/**
 * Apply a screen resize / rotation / fold, safe-area change, keyboard show/hide or remote
 * resize.
 *
 * - Keyboard-only change: scale untouched, offset only re-clamped (content does not jump;
 *   call `ensureVisible` afterwards to lift the focus point above the keyboard).
 * - Anything else: the remote point at the centre of the visible area is kept at the
 *   centre of the new visible area; relative zoom is preserved (so an un-zoomed view
 *   re-fits). A remote resize maps the centre point proportionally. Fling is stopped.
 */
export function relayout(state: ViewportState, change: LayoutChange): ViewportState {
  const keyboardInset =
    change.keyboardInset === undefined ? state.keyboardInset : nonNegative(change.keyboardInset);
  const onlyKeyboard =
    change.screen === undefined && change.insets === undefined && change.remote === undefined;
  if (onlyKeyboard) return clampPan({ ...state, keyboardInset });

  const oldVis = visibleRect(state);
  const centre = screenToRemote(state, {
    x: oldVis.x + oldVis.width / 2,
    y: oldVis.y + oldVis.height / 2,
  });
  const remote = change.remote ? sanitizeSize(change.remote) : state.remote;
  const rx = state.remote.width > 0 ? remote.width / state.remote.width : 1;
  const ry = state.remote.height > 0 ? remote.height / state.remote.height : 1;
  const mapped = { x: centre.x * rx, y: centre.y * ry };

  const next: ViewportState = {
    ...state,
    remote,
    screen: change.screen ? sanitizeSize(change.screen) : state.screen,
    insets: change.insets ? sanitizeInsets(change.insets) : state.insets,
    keyboardInset,
    velocityX: 0,
    velocityY: 0,
  };
  const zoomed: ViewportState = { ...next, zoom: clampZoom(next, state.zoom) };
  const vis = visibleRect(zoomed);
  const scale = scaleOf(zoomed);
  return clampPan({
    ...zoomed,
    offsetX: vis.x + vis.width / 2 - mapped.x * scale,
    offsetY: vis.y + vis.height / 2 - mapped.y * scale,
  });
}

// ---------------------------------------------------------------------------------------
// Command reducer

export function applyViewportCommand(state: ViewportState, cmd: ViewportCommand): ViewportState {
  switch (cmd.type) {
    case 'pan':
      return panBy(state, cmd.dx, cmd.dy);
    case 'zoom':
      return zoomAt(state, cmd.factor, { x: cmd.focalX, y: cmd.focalY });
    case 'fling':
      return startFling(state, cmd.vx, cmd.vy);
    case 'stop-fling':
      return stopFling(state);
    case 'reset':
      return resetToMode(state);
    case 'ensure-visible':
      return ensureVisible(state, { x: cmd.x, y: cmd.y }, cmd.margin);
  }
}

export function applyViewportCommands(
  state: ViewportState,
  cmds: readonly ViewportCommand[],
): ViewportState {
  return cmds.reduce(applyViewportCommand, state);
}
