import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/**
 * Picture in Picture (experimental, iOS): feeds the remote display to the native `OmgPip`
 * plugin, which shows it in the system's floating window when the user leaves the app.
 *
 * The open question this answers on a real device: does the web layer (and with it the
 * session) keep running while the app is in the background with the window up? The feed
 * therefore logs what happened while the page was hidden: how long, how many timer ticks
 * ran, how many frames were sent, and what the native side saw.
 */

export interface PipStatus {
  readonly supported: boolean;
  readonly prepared?: boolean;
  readonly possible?: boolean;
  readonly active?: boolean;
  readonly frames?: number;
  readonly framesInBackground?: number;
  readonly nativeSecondsInBackground?: number;
  readonly audioCategory?: string;
  readonly inWindow?: boolean;
  readonly error?: string;
  readonly event?: string;
}

export interface OmgPipPlugin {
  prepare(): Promise<PipStatus>;
  frame(options: { jpeg: string }): Promise<{ shown: boolean }>;
  start(): Promise<PipStatus>;
  stop(): Promise<void>;
  /** Closes the window only; the layer stays, so the feed keeps running. */
  close(): Promise<void>;
  status(): Promise<PipStatus>;
  addListener(event: 'state', fn: (status: PipStatus) => void): Promise<PluginListenerHandle>;
}

/**
 * Most frames per second sent while the window is up (the app is in the background). Frames
 * follow the remote display's own updates, because a hidden page's timers run once a second.
 */
export const PIP_FPS = 12;
/** In the foreground nobody sees the frames: just keep the picture current for the start. */
export const PIP_FOREGROUND_FPS = 2;

/** Whether a frame may be sent now. Pure. */
export function pipFrameDue(input: {
  readonly now: number;
  readonly lastSentAt: number;
  readonly hidden: boolean;
  readonly dirty: boolean;
}): boolean {
  const since = input.now - input.lastSentAt;
  // Nothing changed: still refresh once a second, so a lost frame cannot stick.
  if (!input.dirty) return since >= 1000;
  return since >= 1000 / (input.hidden ? PIP_FPS : PIP_FOREGROUND_FPS);
}
/**
 * Frames are scaled down so neither side is longer than this: the window is small, and a
 * portrait display sized to the phone would otherwise be about 2 megapixels a frame.
 */
export const PIP_MAX_SIDE = 960;
/** Older name of `PIP_MAX_SIDE`. */
export const PIP_MAX_WIDTH = PIP_MAX_SIDE;
const JPEG_PREFIX = 'data:image/jpeg;base64,';

/** The size a frame is sent at: never upscaled, even dimensions (video layers want them). */
export function pipFrameSize(width: number, height: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const k = Math.min(1, PIP_MAX_SIDE / width, PIP_MAX_SIDE / height);
  const even = (n: number) => Math.max(2, Math.round((n * k) / 2) * 2);
  return { width: even(width), height: even(height) };
}

export function pipAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
}

/**
 * Whether a session runs its feed. Pure. The feed lives while the session is open, also
 * through a reconnect (frames just pause), so a reconnect does not close the window; it
 * stops once the session has ended.
 */
export function pipWanted(input: {
  readonly setting: boolean;
  readonly available: boolean;
  readonly active: boolean;
  readonly disposed: boolean;
  readonly phase: string;
  readonly everConnected: boolean;
}): boolean {
  if (!input.setting || !input.available || !input.active || input.disposed) return false;
  if (input.phase === 'connected') return true;
  return input.everConnected && (input.phase === 'connecting' || input.phase === 'reconnecting');
}

/** Whether the native window is up after a plugin `state` event. Pure. */
export function pipWindowAfter(active: boolean, event: string | undefined): boolean {
  if (event === 'started') return true;
  if (event === 'stopped' || event === 'failed') return false;
  return active;
}

let plugin: OmgPipPlugin | null = null;
function pip(): OmgPipPlugin {
  plugin ??= registerPlugin<OmgPipPlugin>('OmgPip');
  return plugin;
}

/** The feed that owns the native window: a newer session's feed takes it over. */
let owner = 0;
let lastId = 0;

/** Whether the window is up, from the owning feed's plugin `state` events. */
let windowActive = false;
const windowListeners = new Set<(active: boolean) => void>();

function setWindowActive(active: boolean): void {
  if (active === windowActive) return;
  windowActive = active;
  for (const fn of [...windowListeners]) {
    try {
      fn(active);
    } catch {
      // a listener must not break the feed
    }
  }
}

/** Whether the native Picture in Picture window is up. */
export function pipWindowActive(): boolean {
  return windowActive;
}

/** Called whenever the window opens or closes. Returns the unsubscribe function. */
export function onPipWindowChange(fn: (active: boolean) => void): () => void {
  windowListeners.add(fn);
  return () => {
    windowListeners.delete(fn);
  };
}

/** Close the window if it is up. The feed keeps running. Safe when nothing is up. */
export function closePipWindow(): void {
  if (!windowActive || owner === 0) return;
  void pip()
    .close()
    .catch(() => undefined);
}

export class PipFeed {
  private readonly id = ++lastId;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listener: PluginListenerHandle | null = null;
  private stopped = false;
  private busy = false;
  private scratch: HTMLCanvasElement | null = null;
  private hiddenAt = 0;
  private ticksHidden = 0;
  private sentHidden = 0;
  private dirty = true;
  private lastSentAt = 0;

  /** The current picture of the remote display, or null when there is none. */
  private readonly source: () => HTMLCanvasElement | null;
  private readonly log: (message: string) => void;
  /** The source makes a new canvas per call (`Display.flatten`): release it after use. */
  private readonly disposableSource: boolean;

  constructor(
    source: () => HTMLCanvasElement | null,
    log: (message: string) => void,
    options: { readonly disposableSource?: boolean } = {},
  ) {
    this.source = source;
    this.log = log;
    this.disposableSource = options.disposableSource ?? false;
  }

  async start(): Promise<void> {
    owner = this.id;
    try {
      const status = await pip().prepare();
      if (this.stopped) return;
      this.log(`PiP prepared: ${describe(status)}`);
      if (!status.supported) return;
      this.listener = await pip().addListener('state', (s) => {
        // Another session's feed may still be listening: only the owner tracks the window.
        if (owner === this.id) setWindowActive(pipWindowAfter(windowActive, s.event));
        this.log(`PiP ${s.event ?? 'state'}: ${describe(s)}`);
      });
      if (this.stopped) {
        void this.listener.remove();
        this.listener = null;
        return;
      }
      document.addEventListener('visibilitychange', this.onVisibility);
      this.timer = setInterval(() => {
        if (document.visibilityState === 'hidden') this.ticksHidden++;
        void this.pump();
      }, 1000 / PIP_FOREGROUND_FPS);
    } catch (e) {
      this.log(`PiP could not start: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    document.removeEventListener('visibilitychange', this.onVisibility);
    void this.listener?.remove();
    this.listener = null;
    if (owner !== this.id) return;
    owner = 0;
    // The native tear-down drops the controller, so a `stopped` event may never come.
    setWindowActive(false);
    void pip()
      .stop()
      .catch(() => undefined);
  }

  /** Open the window now. Only from a tap. */
  async open(): Promise<void> {
    try {
      this.log(`PiP open asked: ${describe(await pip().start())}`);
    } catch (e) {
      this.log(`PiP could not open: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'hidden') {
      this.hiddenAt = Date.now();
      this.ticksHidden = 0;
      this.sentHidden = 0;
      return;
    }
    if (this.hiddenAt === 0) return;
    const seconds = Math.round((Date.now() - this.hiddenAt) / 1000);
    const ticks = this.ticksHidden;
    const sent = this.sentHidden;
    this.hiddenAt = 0;
    void pip()
      .status()
      .then((s) =>
        this.log(
          `PiP back after ${seconds} s in the background: ${ticks} timer ticks and ${sent} frames sent by the web layer; native ${describe(s)}`,
        ),
      )
      .catch(() => undefined);
  };

  /** The remote display changed (called for every update the session receives). */
  displayChanged(): void {
    this.dirty = true;
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.busy || this.stopped || this.timer === null) return;
    const hidden = document.visibilityState === 'hidden';
    const now = Date.now();
    if (!pipFrameDue({ now, lastSentAt: this.lastSentAt, hidden, dirty: this.dirty })) return;
    const jpeg = this.capture();
    if (jpeg === null) return;
    this.dirty = false;
    this.lastSentAt = now;
    this.busy = true;
    try {
      await pip().frame({ jpeg });
      if (hidden) this.sentHidden++;
    } catch {
      // A frame that could not be shown is simply skipped.
    } finally {
      this.busy = false;
    }
  }

  private capture(): string | null {
    let src: HTMLCanvasElement | null = null;
    try {
      src = this.source();
      if (!src) return null;
      const size = pipFrameSize(src.width, src.height);
      if (size.width === 0) return null;
      const out = (this.scratch ??= document.createElement('canvas'));
      if (out.width !== size.width) out.width = size.width;
      if (out.height !== size.height) out.height = size.height;
      const ctx = out.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(src, 0, 0, out.width, out.height);
      const url = out.toDataURL('image/jpeg', 0.6);
      return url.startsWith(JPEG_PREFIX) ? url.slice(JPEG_PREFIX.length) : null;
    } catch {
      return null;
    } finally {
      // WebKit counts canvas memory per page: free the full-size copy now, not at GC.
      if (src && this.disposableSource) {
        src.width = 0;
        src.height = 0;
      }
    }
  }
}

function describe(s: PipStatus): string {
  const parts = [
    `supported=${String(s.supported)}`,
    `possible=${String(s.possible ?? false)}`,
    `active=${String(s.active ?? false)}`,
    `frames=${String(s.frames ?? 0)}`,
    `framesInBackground=${String(s.framesInBackground ?? 0)}`,
    `nativeSecondsInBackground=${String(s.nativeSecondsInBackground ?? 0)}`,
    `inWindow=${String(s.inWindow ?? false)}`,
    `audio=${s.audioCategory ?? '?'}`,
  ];
  if (s.error) parts.push(`error=${s.error}`);
  return parts.join(' ');
}
