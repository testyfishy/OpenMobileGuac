/**
 * SessionController: the imperative heart of the session screen. It owns the Guacamole
 * client and tunnel, the display element, the pure session models (Viewport,
 * GestureRecognizer, PointerModel, KeyModel, TextInputDiff) and all DOM listeners, and
 * writes per-frame state (display transform, cursor position) straight to the DOM.
 *
 * React only renders the chrome; it reads discrete state through `subscribe` /
 * `getSnapshot` (for `useSyncExternalStore`) and calls the command methods.
 */

import Guacamole from '../../vendor/guacamole-common-js';
import { optimalDisplaySize } from '../../core/api/tunnel.ts';
import { TunnelState, type TunnelLike } from '../../core/transport/TunnelLike.ts';
import { GestureRecognizer, type Gesture } from '../../session/gesture/GestureRecognizer.ts';
import {
  KeyModel,
  type Combo,
  type KeyEvent,
  type Modifier,
  type ModifierState,
} from '../../session/keys/KeyModel.ts';
import {
  diffTextInput,
  initialTextInput,
  textInputKeyEvents,
} from '../../session/keys/TextInputDiff.ts';
import {
  PointerModel,
  ScrollAccumulator,
  wheelStates,
  type HapticHint,
  type MouseState,
  type PointerOutput,
} from '../../session/pointer/PointerModel.ts';
import {
  applyViewportCommands,
  createViewport,
  ensureVisible,
  isFlinging,
  isZoomedIn,
  relayout,
  remoteToScreen,
  resetToMode,
  scaleOf,
  screenToRemote,
  setMode,
  stepFling,
  toCssTransform,
  visibleRect,
  zoomAt,
  type Insets,
  type Size,
  type ViewportState,
} from '../../session/viewport/Viewport.ts';
import {
  decideHardwareKey,
  missingModifierKeysyms,
  pointerButtons,
  pointerKind,
  toGuacMouseTemplate,
  wheelDeltaPx,
} from './inputMapping.ts';
import { computeLayout, cursorDrawScale, visualViewportInset } from './layout.ts';
import { pointerConfigFromSettings, type SessionSettings } from './settings.ts';
import {
  INITIAL_SESSION_MACHINE,
  reduceSession,
  tunnelErrorMessage,
  type SessionEvent,
  type SessionMachine,
  type SessionPhase,
} from './status.ts';

export interface SessionElements {
  /** Full-screen stage; its box is the Viewport's "screen". */
  readonly stage: HTMLElement;
  /** Receives the display element and the CSS transform. */
  readonly displayHost: HTMLElement;
  /** Transparent overlay receiving pointer events. */
  readonly gestureLayer: HTMLElement;
  /** Cursor overlay element (positioned by the controller). */
  readonly cursor: HTMLElement;
  /** Hidden text field for the soft keyboard. */
  readonly field: HTMLTextAreaElement;
  /** Element whose padding is `env(safe-area-inset-*)`. */
  readonly safeAreaProbe: HTMLElement;
  /** Root of the chrome (buttons etc.): keys typed while focus is inside it are ignored. */
  readonly chromeRoot: HTMLElement;
}

export interface SessionSnapshot {
  readonly phase: SessionPhase;
  readonly zoomed: boolean;
  readonly modifiers: Readonly<Record<Modifier, ModifierState>>;
  /** Whether the hidden field is focused (soft keyboard requested). */
  readonly keyboardActive: boolean;
  /** Height (px) of the stage covered by the soft keyboard, for docking the key bar. */
  readonly keyboardCover: number;
  readonly remoteSize: Size;
}

export interface SessionControllerOptions {
  readonly createTunnel: () => TunnelLike;
  readonly buildConnectData: (size: { width: number; height: number; dpi: number }) => string;
  readonly haptic: (hint: HapticHint) => void;
  /** Text arrived from the remote clipboard. */
  readonly onRemoteClipboard: (text: string) => void;
}

const MATCH_SIZE_DEBOUNCE_MS = 400;
const FOLLOW_MARGIN_PX = 48;
const MOUSE_WHEEL_STEP_PX = 50;

type GuacClient = InstanceType<typeof Guacamole.Client>;

export class SessionController {
  private opts: SessionControllerOptions | null = null;
  private settings: SessionSettings;
  private els: SessionElements | null = null;

  // Models
  private viewport: ViewportState;
  private readonly recognizer = new GestureRecognizer();
  private readonly pointer: PointerModel;
  private readonly keys = new KeyModel();
  private readonly wheel = new ScrollAccumulator(MOUSE_WHEEL_STEP_PX);
  private baseline = initialTextInput();
  private composing = false;

  // Connection
  private client: GuacClient | null = null;
  private tunnel: TunnelLike | null = null;
  private generation = 0;
  private machine: SessionMachine = INITIAL_SESSION_MACHINE;
  /** Set while we close on purpose (user, unmount, retry teardown). */
  private closingOnPurpose = false;
  /** The server ended the session (`disconnect`/`error` instruction). */
  private serverClosed = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  // Layout
  private stable: Size | null = null;
  private nativeKeyboardOpen = false;
  private nativeKeyboardHeight = 0;
  private webKeyboardSeen = false;
  private keyBarHeight = 0;
  private keyboardCover = 0;
  private measured: Size = { width: 0, height: 0 };
  private matchSizeTimer: ReturnType<typeof setTimeout> | null = null;

  // Input / frame loop
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private flingFrame: number | null = null;
  private flingLast = 0;
  private lastMouse: MouseState | null = null;
  private readonly hwPressed = new Map<string, number>();
  /** Modifiers synthesised for a chord key (see `missingModifierKeysyms`), by key id. */
  private readonly hwSynth = new Map<string, number[]>();
  private cursorCanvas: HTMLCanvasElement | null = null;
  private cursorHotspot = { x: 0, y: 0 };

  // Store
  private snapshot: SessionSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly cleanups: (() => void)[] = [];
  private disposed = false;

  constructor(settings: SessionSettings) {
    this.settings = settings;
    this.pointer = new PointerModel({
      ...pointerConfigFromSettings(settings),
      followMarginPx: FOLLOW_MARGIN_PX,
    });
    this.recognizer.setConfig(this.pointer.recognizerOptions());
    this.viewport = createViewport({
      remote: { width: 0, height: 0 },
      screen: { width: 0, height: 0 },
      mode: settings.fitMode,
    });
    this.snapshot = this.buildSnapshot();
  }

  // =====================================================================================
  // Store (useSyncExternalStore)

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SessionSnapshot => this.snapshot;

  private buildSnapshot(): SessionSnapshot {
    return {
      phase: this.machine.phase,
      zoomed: isZoomedIn(this.viewport),
      modifiers: this.keys.modifiers(),
      keyboardActive: this.els !== null && document.activeElement === this.els.field,
      keyboardCover: this.keyboardCover,
      remoteSize: this.viewport.remote,
    };
  }

  private publish(): void {
    const next = this.buildSnapshot();
    const prev = this.snapshot;
    const same =
      prev.phase === next.phase &&
      prev.zoomed === next.zoomed &&
      prev.keyboardActive === next.keyboardActive &&
      prev.keyboardCover === next.keyboardCover &&
      prev.remoteSize.width === next.remoteSize.width &&
      prev.remoteSize.height === next.remoteSize.height &&
      (Object.keys(next.modifiers) as Modifier[]).every(
        (m) => prev.modifiers[m] === next.modifiers[m],
      );
    if (same) return;
    this.snapshot = next;
    for (const l of this.listeners) l();
  }

  // =====================================================================================
  // Lifecycle

  /**
   * Attach to the DOM and start connecting. May be called again after `detach()` (React
   * StrictMode mounts effects twice in development).
   */
  attach(els: SessionElements): void {
    this.detach();
    this.disposed = false;
    this.els = els;
    this.machine = INITIAL_SESSION_MACHINE;
    this.stable = null;
    els.field.value = this.baseline;
    this.listen();
    this.measure();
    this.connect();
  }

  /** Disconnect and remove every DOM listener and timer. Idempotent. */
  detach(): void {
    if (this.disposed || !this.els) return;
    this.releaseInputs();
    this.teardownClient(true);
    this.clearTimers();
    for (const c of this.cleanups.splice(0)) c();
    this.disposed = true;
  }

  /** Callbacks from the host. Set before `attach()`. */
  setOptions(opts: SessionControllerOptions): void {
    this.opts = opts;
  }

  /** Apply changed settings (mode switches, speed, match-device...). */
  updateSettings(settings: SessionSettings): void {
    this.applySettings(settings);
  }

  /** User pressed Retry. */
  retry(): void {
    if (this.disposed) return;
    this.machine = INITIAL_SESSION_MACHINE;
    this.connect();
  }

  /** User pressed Disconnect. */
  disconnect(): void {
    this.releaseInputs();
    this.dispatch({ type: 'user-disconnect' });
    this.teardownClient(true);
  }

  private dispatch(e: SessionEvent): void {
    const prev = this.machine.phase;
    this.machine = reduceSession(this.machine, e);
    const phase = this.machine.phase;
    if (phase !== prev && phase.kind === 'reconnecting' && e.type === 'closed') {
      this.scheduleRetry(phase.delayMs);
    }
    this.publish();
  }

  private scheduleRetry(delayMs: number): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.disposed && this.machine.phase.kind === 'reconnecting') this.connect();
    }, delayMs);
  }

  private connect(): void {
    const els = this.els;
    if (!els || this.disposed) return;
    this.teardownClient(true);
    const gen = ++this.generation;
    this.closingOnPurpose = false;
    this.serverClosed = false;
    this.dispatch({ type: 'connect' });

    const opts = this.opts;
    if (!opts) return;
    let tunnel: TunnelLike;
    try {
      tunnel = opts.createTunnel();
    } catch (err) {
      this.dispatch({ type: 'error', code: 0x0200, display: errorText(err) });
      this.dispatch({ type: 'closed', intentional: false });
      return;
    }
    const client = new Guacamole.Client(tunnel as unknown as InstanceType<typeof Guacamole.Tunnel>);
    this.tunnel = tunnel;
    this.client = client;
    const live = () => gen === this.generation && !this.disposed;

    tunnel.onerror = (status) => {
      if (!live()) return;
      this.dispatch({
        type: 'error',
        code: status.code,
        message: status.message,
        display: tunnelErrorMessage(status.code, status.message),
      });
    };
    tunnel.onstatechange = (state) => {
      if (!live() || state !== TunnelState.CLOSED) return;
      const intentional =
        this.closingOnPurpose || (this.serverClosed && this.machine.lastError === null);
      this.dispatch({ type: 'closed', intentional });
      this.releaseInputs();
      // The client does not follow a tunnel close on its own; stop its keep-alive.
      this.closingOnPurpose = true;
      client.disconnect();
    };
    client.onerror = (status) => {
      if (!live()) return;
      this.serverClosed = true;
      this.dispatch({ type: 'error', code: status.code, message: status.message });
    };
    client.onstatechange = (state) => {
      if (!live()) return;
      if (state === Guacamole.Client.State.CONNECTED) {
        this.dispatch({ type: 'connected' });
        this.onConnected();
      } else if (state === Guacamole.Client.State.DISCONNECTING && !this.closingOnPurpose) {
        // Server sent `disconnect` or `error`.
        this.serverClosed = true;
      }
    };
    client.onclipboard = (stream, mimetype) => {
      if (!live() || !/^text\//.test(mimetype)) return;
      const reader = new Guacamole.StringReader(stream);
      let text = '';
      reader.ontext = (chunk) => {
        text += chunk;
      };
      reader.onend = () => {
        if (live()) this.opts?.onRemoteClipboard(text);
      };
    };

    const display = client.getDisplay();
    display.scale(1);
    const el = display.getElement();
    els.displayHost.replaceChildren(el);
    // Our overlay draws the cursor; hide the library's software cursor layer, which
    // `sendMouseState` and the server `mouse` instruction would otherwise show as well.
    display.getCursorLayer().getElement().style.visibility = 'hidden';
    display.onresize = (w, h) => {
      if (live()) this.onRemoteResize({ width: w, height: h });
    };
    display.oncursor = (canvas, x, y) => {
      if (!live()) return;
      this.setCursorImage(canvas.width > 0 && canvas.height > 0 ? canvas : null, x, y);
    };
    this.setCursorImage(null, 0, 0);

    const screen = this.viewport.screen;
    const dpr = window.devicePixelRatio || 1;
    const size = optimalDisplaySize(
      screen.width || window.innerWidth,
      screen.height || window.innerHeight,
      dpr,
    );
    try {
      client.connect(opts.buildConnectData(size));
    } catch (err) {
      const status = err as { code?: number; message?: string };
      this.dispatch({
        type: 'error',
        code: typeof status.code === 'number' ? status.code : 0x0200,
        display: typeof status.code === 'number' ? undefined : errorText(err),
      });
      this.dispatch({ type: 'closed', intentional: false });
    }
  }

  /** Close the current client/tunnel without triggering reconnect logic. */
  private teardownClient(onPurpose: boolean): void {
    if (this.retryTimer && onPurpose && this.machine.phase.kind !== 'reconnecting') {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const client = this.client;
    const tunnel = this.tunnel;
    this.client = null;
    this.tunnel = null;
    this.generation++;
    if (!client) return;
    this.closingOnPurpose = onPurpose;
    client.onclipboard = null;
    client.onstatechange = null;
    client.onerror = null;
    try {
      client.disconnect();
    } catch {
      // ignore
    }
    if (tunnel) {
      tunnel.onstatechange = null;
      tunnel.onerror = null;
    }
  }

  private onConnected(): void {
    // Sync the remote pointer with the model so the cursor overlay starts in a known place.
    this.lastMouse = null;
    this.updateCursor();
    this.scheduleMatchSize();
  }

  private clearTimers(): void {
    for (const t of [this.retryTimer, this.tickTimer, this.matchSizeTimer]) {
      if (t) clearTimeout(t);
    }
    this.retryTimer = this.tickTimer = this.matchSizeTimer = null;
    if (this.flingFrame !== null) cancelAnimationFrame(this.flingFrame);
    this.flingFrame = null;
  }

  // =====================================================================================
  // Settings

  private applySettings(next: SessionSettings): void {
    const prev = this.settings;
    this.settings = next;
    if (prev.fitMode !== next.fitMode) {
      this.setViewport(setMode(this.viewport, next.fitMode));
    }
    if (
      prev.pointerMode !== next.pointerMode ||
      prev.pointerSpeed !== next.pointerSpeed ||
      prev.naturalScroll !== next.naturalScroll
    ) {
      const out = this.pointer.setConfig(pointerConfigFromSettings(next), this.viewport);
      this.applyPointerOutput(out);
      if (prev.pointerMode !== next.pointerMode) {
        this.recognizer.reset(performance.now());
        this.recognizer.setConfig(this.pointer.recognizerOptions());
        if (next.pointerMode === 'trackpad') this.bringPointerIntoView();
        this.updateCursor();
      }
    }
    if (!prev.matchDeviceSize && next.matchDeviceSize) this.scheduleMatchSize();
  }

  // =====================================================================================
  // Viewport, layout and display

  resetZoom(): void {
    this.setViewport(resetToMode(this.viewport));
  }

  /** Height of the key bar docked above the keyboard / bottom edge (0 when hidden). */
  setKeyBarHeight(px: number): void {
    const h = Math.max(0, Math.round(px));
    if (h === this.keyBarHeight) return;
    this.keyBarHeight = h;
    this.measure();
  }

  private setViewport(next: ViewportState): void {
    this.viewport = next;
    this.render();
    this.publish();
    if (isFlinging(next)) this.startFlingLoop();
  }

  private render(): void {
    const els = this.els;
    if (!els) return;
    els.displayHost.style.transform = toCssTransform(this.viewport);
    this.updateCursor();
  }

  private readInsets(): Insets {
    const probe = this.els?.safeAreaProbe;
    if (!probe) return { top: 0, right: 0, bottom: 0, left: 0 };
    const cs = getComputedStyle(probe);
    const px = (v: string) => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    };
    return {
      top: px(cs.paddingTop),
      right: px(cs.paddingRight),
      bottom: px(cs.paddingBottom),
      left: px(cs.paddingLeft),
    };
  }

  /** Re-measure the stage, safe area, keyboard and key bar, and relayout. */
  measure = (): void => {
    const els = this.els;
    if (!els || this.disposed) return;
    const rect = els.stage.getBoundingClientRect();
    this.measured = { width: rect.width, height: rect.height };
    const vv = window.visualViewport;
    const fieldFocused = document.activeElement === els.field;
    const vvInset = vv ? visualViewportInset(rect.bottom, vv.offsetTop, vv.height) : 0;
    const keyboardOpen = this.nativeKeyboardOpen || (fieldFocused && vvInset > 40);
    // Mobile web: the user dismissed the keyboard with a system control but the field kept
    // focus. Blur it so the keyboard button reflects that and raises it again on one tap.
    if (fieldFocused && vvInset > 40) this.webKeyboardSeen = true;
    else if (!fieldFocused) this.webKeyboardSeen = false;
    else if (this.webKeyboardSeen && vvInset <= 1 && !this.nativeKeyboardOpen) {
      this.webKeyboardSeen = false;
      els.field.blur();
    }
    const out = computeLayout({
      measured: this.measured,
      stable: this.stable,
      keyboardOpen,
      nativeKeyboardHeight: this.nativeKeyboardHeight,
      visualViewportInset: vvInset,
    });
    this.stable = out.stable;
    const shrink = out.screen.height - this.measured.height;
    this.keyboardCover = Math.max(0, out.keyboardInset - shrink);
    const insets = this.readInsets();
    // The key bar slot sits right above the keyboard; when the keyboard is hidden its
    // measured height already includes the bottom safe-area padding (see the CSS).
    const keyboardInset = out.keyboardInset + this.keyBarHeight;
    const prev = this.viewport;
    const screenChanged =
      Math.abs(prev.screen.width - out.screen.width) >= 0.5 ||
      Math.abs(prev.screen.height - out.screen.height) >= 0.5;
    const insetsChanged =
      prev.insets.top !== insets.top ||
      prev.insets.bottom !== insets.bottom ||
      prev.insets.left !== insets.left ||
      prev.insets.right !== insets.right;
    const kbChanged = Math.abs(prev.keyboardInset - keyboardInset) >= 0.5;
    if (!screenChanged && !insetsChanged && !kbChanged) {
      this.publish();
      return;
    }
    let next: ViewportState;
    if (prev.screen.width === 0 || prev.screen.height === 0) {
      next = createViewport({
        remote: prev.remote,
        screen: out.screen,
        insets,
        keyboardInset,
        mode: this.settings.fitMode,
      });
    } else if (!screenChanged && !insetsChanged) {
      next = relayout(prev, { keyboardInset });
    } else {
      next = relayout(prev, { screen: out.screen, insets, keyboardInset });
    }
    if (kbChanged && keyboardInset > prev.keyboardInset && this.lastMouse) {
      // Keyboard (or key bar) came up: keep the pointer / focus point above it (DSP-5).
      next = ensureVisible(next, this.lastMouse, FOLLOW_MARGIN_PX);
    }
    this.setViewport(next);
    if (screenChanged) this.scheduleMatchSize();
  };

  private onRemoteResize(remote: Size): void {
    const prev = this.viewport;
    const next =
      prev.remote.width === 0 || prev.remote.height === 0
        ? createViewport({
            remote,
            screen: prev.screen,
            insets: prev.insets,
            keyboardInset: prev.keyboardInset,
            mode: this.settings.fitMode,
          })
        : relayout(prev, { remote });
    this.viewport = next;
    // Start the trackpad pointer in the middle of the first frame.
    if (prev.remote.width === 0 || prev.remote.height === 0) {
      this.pointer.setPointer({ x: remote.width / 2, y: remote.height / 2 });
    }
    this.applyPointerOutput(this.pointer.handleRemoteResize(next));
    this.setViewport(this.viewport);
  }

  /** DSP-4: ask the server to match the device (debounced, only when different). */
  private scheduleMatchSize(): void {
    if (!this.settings.matchDeviceSize) return;
    if (this.matchSizeTimer) clearTimeout(this.matchSizeTimer);
    this.matchSizeTimer = setTimeout(() => {
      this.matchSizeTimer = null;
      const client = this.client;
      if (!client || !this.settings.matchDeviceSize) return;
      if (this.machine.phase.kind !== 'connected') return;
      const { width, height } = this.viewport.screen;
      if (width <= 0 || height <= 0) return;
      const size = optimalDisplaySize(width, height, window.devicePixelRatio || 1);
      const display = client.getDisplay();
      if (size.width !== display.getWidth() || size.height !== display.getHeight()) {
        client.sendSize(size.width, size.height);
      }
    }, MATCH_SIZE_DEBOUNCE_MS);
  }

  private startFlingLoop(): void {
    if (this.flingFrame !== null) return;
    this.flingLast = performance.now();
    const step = (now: number) => {
      this.flingFrame = null;
      if (this.disposed) return;
      const dt = Math.min(64, Math.max(0, now - this.flingLast));
      this.flingLast = now;
      this.viewport = stepFling(this.viewport, dt);
      this.render();
      if (isFlinging(this.viewport)) this.flingFrame = requestAnimationFrame(step);
      else this.publish();
    };
    this.flingFrame = requestAnimationFrame(step);
  }

  /**
   * Entering trackpad mode with the pointer off-screen would leave the user hunting for
   * it; move it to the centre of the visible area instead (without clicking).
   */
  private bringPointerIntoView(): void {
    const vp = this.viewport;
    if (vp.remote.width <= 0 || vp.remote.height <= 0) return;
    const p = this.lastMouse ?? this.pointer.getPointer(vp);
    const s = remoteToScreen(vp, p);
    const vis = visibleRect(vp);
    const inside =
      s.x >= vis.x && s.y >= vis.y && s.x <= vis.x + vis.width && s.y <= vis.y + vis.height;
    if (inside) {
      this.pointer.setPointer(p);
      return;
    }
    const c = screenToRemote(vp, { x: vis.x + vis.width / 2, y: vis.y + vis.height / 2 });
    this.pointer.setPointer(c);
    const pos = this.pointer.getPointer(vp);
    const held = this.lastMouse;
    this.sendMouse([
      {
        x: pos.x,
        y: pos.y,
        left: held?.left ?? false,
        middle: held?.middle ?? false,
        right: held?.right ?? false,
        up: false,
        down: false,
      },
    ]);
  }

  // =====================================================================================
  // Cursor overlay (DSP-6)

  private setCursorImage(canvas: HTMLCanvasElement | null, hx: number, hy: number): void {
    const el = this.els?.cursor;
    if (!el) return;
    this.cursorCanvas = canvas;
    this.cursorHotspot = canvas ? { x: hx, y: hy } : { x: 0, y: 0 };
    const img = el.querySelector<HTMLElement>('[data-cursor-image]');
    const fallback = el.querySelector<HTMLElement>('[data-cursor-fallback]');
    if (img) {
      img.replaceChildren(...(canvas ? [canvas] : []));
      img.style.display = canvas ? 'block' : 'none';
    }
    if (fallback) fallback.style.display = canvas ? 'none' : 'block';
    this.updateCursor();
  }

  private updateCursor(): void {
    const els = this.els;
    if (!els) return;
    const vp = this.viewport;
    const connected = this.client !== null && vp.remote.width > 0;
    const remotePoint = this.lastMouse ?? this.pointer.getPointer(vp);
    const s = remoteToScreen(vp, remotePoint);
    const k = cursorDrawScale(scaleOf(vp));
    const hx = this.cursorCanvas ? this.cursorHotspot.x : 0;
    const hy = this.cursorCanvas ? this.cursorHotspot.y : 0;
    els.cursor.style.transform = `translate3d(${s.x - hx * k}px, ${s.y - hy * k}px, 0) scale(${k})`;
    els.cursor.dataset.mode = this.settings.pointerMode;
    els.cursor.style.visibility = connected ? 'visible' : 'hidden';
  }

  // =====================================================================================
  // Sending

  private sendMouse(states: readonly MouseState[]): void {
    if (states.length === 0) return;
    const client = this.client;
    for (const s of states) {
      if (client) client.sendMouseState(new Guacamole.Mouse.State(toGuacMouseTemplate(s)), false);
      this.lastMouse = s;
    }
    this.updateCursor();
  }

  sendKeyEvents(events: readonly KeyEvent[]): void {
    const client = this.client;
    if (client) for (const e of events) client.sendKeyEvent(e.pressed ? 1 : 0, e.keysym);
    this.publish();
  }

  /** Key bar / named key with sticky modifiers applied. */
  pressKey(name: string | number): void {
    this.sendKeyEvents(this.keys.pressKey(name));
  }

  tapModifier(mod: Modifier): void {
    this.sendKeyEvents(this.keys.tapModifier(mod));
  }

  runCombo(combo: Combo): void {
    this.sendKeyEvents(this.keys.runCombo(combo));
  }

  /** CLP-3: type text as keystrokes. */
  typeText(text: string): void {
    this.sendKeyEvents(this.keys.typeText(text));
  }

  /** CLP-1: set the remote clipboard (clipboard stream + StringWriter, as the web client). */
  sendClipboard(text: string): boolean {
    const client = this.client;
    if (!client || this.machine.phase.kind !== 'connected') return false;
    const stream = client.createClipboardStream('text/plain');
    const writer = new Guacamole.StringWriter(stream);
    writer.sendText(text);
    writer.sendEnd();
    return true;
  }

  isConnected(): boolean {
    return this.machine.phase.kind === 'connected';
  }

  private applyPointerOutput(out: PointerOutput): void {
    this.sendMouse(out.mouse);
    if (out.viewport.length > 0) {
      this.viewport = applyViewportCommands(this.viewport, out.viewport);
      this.render();
      if (isFlinging(this.viewport)) this.startFlingLoop();
      this.publish();
    }
    if (this.settings.haptics) for (const h of out.haptics) this.opts?.haptic(h);
  }

  private handleGestures(gestures: readonly Gesture[]): void {
    for (const g of gestures) this.applyPointerOutput(this.pointer.handle(g, this.viewport));
    this.scheduleTick();
  }

  private scheduleTick(): void {
    if (this.tickTimer) clearTimeout(this.tickTimer);
    this.tickTimer = null;
    const deadline = this.recognizer.nextDeadline();
    if (deadline === null) return;
    const delay = Math.max(0, deadline - performance.now());
    this.tickTimer = setTimeout(() => {
      this.tickTimer = null;
      this.handleGestures(this.recognizer.tick(performance.now()));
    }, delay + 1);
  }

  private releaseInputs(): void {
    const client = this.client;
    const released: KeyEvent[] = [...this.keys.releaseAll()];
    for (const ks of this.hwPressed.values()) released.push({ keysym: ks, pressed: false });
    for (const list of this.hwSynth.values()) {
      for (const ks of list) released.push({ keysym: ks, pressed: false });
    }
    this.hwPressed.clear();
    this.hwSynth.clear();
    if (client) for (const e of released) client.sendKeyEvent(0, e.keysym);
    this.handleGestures(this.recognizer.reset(performance.now()));
    this.applyPointerOutput(this.pointer.releaseAll(this.viewport));
    this.publish();
  }

  // =====================================================================================
  // Soft keyboard (KEY-1) and the hidden field (KEY-2)

  /**
   * Raise the soft keyboard. MUST be called synchronously from a user gesture handler
   * (click), or iOS will not show the keyboard.
   */
  showKeyboard(): void {
    const field = this.els?.field;
    if (!field) return;
    // Re-focusing an already focused field (keyboard dismissed with the system back key)
    // does not raise the keyboard again; blur first.
    if (document.activeElement === field) field.blur();
    field.focus({ preventScroll: true });
    this.resetField();
    this.publish();
  }

  hideKeyboard(): void {
    const field = this.els?.field;
    if (field && document.activeElement === field) field.blur();
    this.publish();
  }

  private resetField(): void {
    const field = this.els?.field;
    if (!field) return;
    this.baseline = initialTextInput();
    field.value = this.baseline;
    const end = field.value.length;
    try {
      field.setSelectionRange(end, end);
    } catch {
      // ignore
    }
  }

  private processField(composing: boolean): void {
    const field = this.els?.field;
    if (!field) return;
    const update = diffTextInput(this.baseline, field.value, composing);
    const events = textInputKeyEvents(update, this.keys);
    this.baseline = update.baseline;
    if (update.reset) {
      field.value = update.baseline;
      const end = field.value.length;
      try {
        field.setSelectionRange(end, end);
      } catch {
        // ignore
      }
    }
    this.sendKeyEvents(events);
  }

  // =====================================================================================
  // DOM listeners

  private on<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    fn: (e: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, fn as EventListener, options);
    this.cleanups.push(() => target.removeEventListener(type, fn as EventListener, options));
  }

  private onWindow<K extends keyof WindowEventMap>(
    type: K,
    fn: (e: WindowEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void {
    window.addEventListener(type, fn as EventListener, options);
    this.cleanups.push(() => window.removeEventListener(type, fn as EventListener, options));
  }

  private listen(): void {
    const els = this.els;
    if (!els) return;
    const layer = els.gestureLayer;

    // ---- Pointer events on the gesture layer
    const localPoint = (e: PointerEvent | WheelEvent) => {
      const r = els.stage.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const pointerHandler = (type: 'down' | 'move' | 'up' | 'cancel') => (e: PointerEvent) => {
      // Keep focus on the hidden field and stop browser gestures/selection.
      if (e.cancelable) e.preventDefault();
      const kind = pointerKind(e.pointerType);
      if (type === 'down') {
        try {
          layer.setPointerCapture(e.pointerId);
        } catch {
          // Synthetic pointers cannot be captured.
        }
      }
      const p = localPoint(e);
      if (kind === 'mouse') {
        const b = pointerButtons(type === 'cancel' ? 0 : e.buttons);
        this.applyPointerOutput(this.pointer.handleHardwareMouse({ ...p, ...b }, this.viewport));
        return;
      }
      this.handleGestures(
        this.recognizer.handle({
          id: e.pointerId,
          type,
          x: p.x,
          y: p.y,
          timeMs: performance.now(),
          pointerType: kind,
        }),
      );
    };
    this.on(layer, 'pointerdown', pointerHandler('down'));
    this.on(layer, 'pointermove', pointerHandler('move'));
    this.on(layer, 'pointerup', pointerHandler('up'));
    this.on(layer, 'pointercancel', pointerHandler('cancel'));
    // Non-passive listeners, so preventDefault works (React's touch/wheel listeners are passive).
    const prevent = (e: Event) => {
      if (e.cancelable) e.preventDefault();
    };
    this.on(layer, 'touchstart', prevent, { passive: false });
    this.on(layer, 'touchmove', prevent, { passive: false });
    this.on(layer, 'mousedown', prevent);
    this.on(layer, 'contextmenu', prevent);
    this.on(layer, 'dblclick', prevent);
    this.on(layer, 'selectstart', prevent);
    this.on(
      layer,
      'wheel',
      (e) => {
        e.preventDefault();
        const p = localPoint(e);
        const dy = wheelDeltaPx(e.deltaY, e.deltaMode, this.viewport.screen.height);
        if (e.ctrlKey) {
          // Desktop trackpad pinch arrives as ctrl+wheel: zoom the view, not the remote.
          this.setViewport(zoomAt(this.viewport, Math.exp(-dy / 200), p));
          return;
        }
        const notches = this.wheel.add(dy);
        if (notches === 0) return;
        const out = this.pointer.handleHardwareMouse(
          { ...p, ...pointerButtons(e.buttons) },
          this.viewport,
        );
        this.sendMouse(out.mouse);
        const base = this.lastMouse;
        if (base) this.sendMouse(wheelStates(base, notches));
      },
      { passive: false },
    );

    // ---- Hidden text field
    const field = els.field;
    this.on(field, 'compositionstart', () => {
      this.composing = true;
    });
    this.on(field, 'compositionend', () => {
      this.composing = false;
      this.processField(false);
    });
    this.on(field, 'input', (e) => {
      const composing = (e as InputEvent).isComposing || this.composing;
      this.processField(composing);
    });
    this.on(field, 'focus', () => {
      this.resetField();
      this.measure();
      this.publish();
    });
    this.on(field, 'blur', () => {
      this.composing = false;
      this.keys.clearOneShot();
      this.measure();
      this.publish();
    });

    // ---- Hardware keyboard (document level)
    const keydown = (e: KeyboardEvent) => {
      if (this.disposed || !this.isConnected()) return;
      const active = document.activeElement;
      const fieldFocused = active === field;
      if (!fieldFocused && active instanceof HTMLElement && els.chromeRoot.contains(active)) {
        return; // typing into or operating the chrome (buttons, combo text field)
      }
      if (!fieldFocused && isEditable(active)) return;
      // A menu (dialog) is open: its own keys (Escape) must not reach the remote.
      if (els.chromeRoot.querySelector('[role="dialog"]')) return;
      const d = decideHardwareKey(e, fieldFocused);
      if (d.action !== 'send') return;
      e.preventDefault();
      const hasOneShot = Object.values(this.keys.modifiers()).includes('once');
      if (hasOneShot && !isModifierKey(e.key)) {
        if (!e.repeat) this.pressKey(d.keysym);
        return;
      }
      const id = e.code || e.key;
      if (!isModifierKey(e.key) && !e.repeat) {
        const held = new Set([...this.hwPressed.values(), ...this.keys.heldKeysyms()]);
        const synth = missingModifierKeysyms(e, held);
        if (synth.length > 0) {
          this.hwSynth.set(id, synth);
          for (const ks of synth) this.client?.sendKeyEvent(1, ks);
        }
      }
      this.hwPressed.set(id, d.keysym);
      this.client?.sendKeyEvent(1, d.keysym);
    };
    const keyup = (e: KeyboardEvent) => {
      const id = e.code || e.key;
      const ks = this.hwPressed.get(id);
      if (ks === undefined) return;
      e.preventDefault();
      this.hwPressed.delete(id);
      this.client?.sendKeyEvent(0, ks);
      const synth = this.hwSynth.get(id);
      if (synth) {
        this.hwSynth.delete(id);
        for (const m of [...synth].reverse()) this.client?.sendKeyEvent(0, m);
      }
    };
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('keyup', keyup, true);
    this.cleanups.push(() => {
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('keyup', keyup, true);
    });

    // ---- Focus loss: release everything so nothing stays stuck on the remote
    this.onWindow('blur', () => this.releaseInputs());
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') this.releaseInputs();
    };
    document.addEventListener('visibilitychange', onVisibility);
    this.cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));

    // ---- Layout sources: container size, orientation/fold, visual viewport, safe area
    const ro = new ResizeObserver(() => this.measure());
    ro.observe(els.stage);
    this.cleanups.push(() => ro.disconnect());
    this.onWindow('resize', this.measure);
    this.onWindow('orientationchange', () => {
      // Some WebViews report the new size a little after the event.
      this.measure();
      setTimeout(this.measure, 250);
    });
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', this.measure);
      vv.addEventListener('scroll', this.measure);
      this.cleanups.push(() => {
        vv.removeEventListener('resize', this.measure);
        vv.removeEventListener('scroll', this.measure);
      });
    }
  }

  /** Native keyboard events (Capacitor Keyboard plugin). */
  setNativeKeyboard(open: boolean, height: number): void {
    this.nativeKeyboardOpen = open;
    this.nativeKeyboardHeight = open ? Math.max(0, height) : 0;
    if (!open) {
      // The user dismissed the keyboard (back key / swipe): drop focus so the keyboard
      // button reflects it and can raise it again.
      const field = this.els?.field;
      if (field && document.activeElement === field) field.blur();
    }
    this.measure();
  }
}

function isModifierKey(key: string): boolean {
  return key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta' || key === 'OS';
}

function isEditable(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return (
    el.isContentEditable || el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
  );
}

function errorText(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return 'The connection could not be started.';
}
