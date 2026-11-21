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
  status(): Promise<PipStatus>;
  addListener(event: 'state', fn: (status: PipStatus) => void): Promise<PluginListenerHandle>;
}

/** Frames per second sent to the window. */
export const PIP_FPS = 4;
/** Frames are scaled down to at most this width: the window is small. */
export const PIP_MAX_WIDTH = 960;
const JPEG_PREFIX = 'data:image/jpeg;base64,';

/** The size a frame is sent at: never upscaled, even dimensions (video layers want them). */
export function pipFrameSize(width: number, height: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const k = Math.min(1, PIP_MAX_WIDTH / width);
  const even = (n: number) => Math.max(2, Math.round((n * k) / 2) * 2);
  return { width: even(width), height: even(height) };
}

export function pipAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
}

let plugin: OmgPipPlugin | null = null;
function pip(): OmgPipPlugin {
  plugin ??= registerPlugin<OmgPipPlugin>('OmgPip');
  return plugin;
}

/** The feed that owns the native window: a newer session's feed takes it over. */
let owner = 0;
let lastId = 0;

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

  /** The current picture of the remote display, or null when there is none. */
  private readonly source: () => HTMLCanvasElement | null;
  private readonly log: (message: string) => void;

  constructor(source: () => HTMLCanvasElement | null, log: (message: string) => void) {
    this.source = source;
    this.log = log;
  }

  async start(): Promise<void> {
    owner = this.id;
    try {
      const status = await pip().prepare();
      if (this.stopped) return;
      this.log(`PiP prepared: ${describe(status)}`);
      if (!status.supported) return;
      this.listener = await pip().addListener('state', (s) =>
        this.log(`PiP ${s.event ?? 'state'}: ${describe(s)}`),
      );
      if (this.stopped) {
        void this.listener.remove();
        this.listener = null;
        return;
      }
      document.addEventListener('visibilitychange', this.onVisibility);
      this.timer = setInterval(() => void this.tick(), 1000 / PIP_FPS);
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

  private async tick(): Promise<void> {
    const hidden = document.visibilityState === 'hidden';
    if (hidden) this.ticksHidden++;
    if (this.busy || this.stopped) return;
    const jpeg = this.capture();
    if (jpeg === null) return;
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
    try {
      const src = this.source();
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
