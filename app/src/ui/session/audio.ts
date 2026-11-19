/**
 * Remote audio (AUD-1): takes over `client.onaudio` so playback can be muted per session,
 * paused while the session is hidden, and started on mobile WebViews that create the
 * AudioContext suspended.
 *
 * Library facts (vendored 1.6.0):
 * - `Client.js` "audio" handler: calls `onaudio(stream, mimetype)`; a falsy result falls
 *   back to `Guacamole.AudioPlayer.getInstance(stream, mimetype)`; a player gets
 *   `ack OK 0x0000`, no player `ack BAD TYPE 0x030F`. So muting can not return null.
 * - `AudioPlayer.js`: `RawAudioPlayer` (audio/L8, audio/L16) reads the stream with an
 *   `ArrayBufferReader` and connects every buffer straight to `context.destination` (no
 *   gain node), scheduling against `context.currentTime`.
 * - `AudioContextFactory.js`: one process-wide AudioContext singleton, shared by every
 *   session. Suspending it silences all sessions, so it is only suspended when the app is
 *   in the background; a per-session mute drops that session's audio packets instead.
 *
 * Mute therefore gates the stream: the player reads a proxy stream, and the real stream's
 * blobs are forwarded only while audible. Dropped packets are never scheduled, so nothing
 * piles up and unmuting resumes at "now" (`RawAudioPlayer` moves `nextPacketTime` up to
 * `currentTime`). The audio stream itself needs no acks after the first (Client.js).
 */

import Guacamole from '../../vendor/guacamole-common-js';

interface AudioContextFactoryLike {
  getAudioContext(): AudioContext | null;
}

/** `Guacamole.AudioContextFactory` (not declared in index.d.ts). */
function audioContext(): AudioContext | null {
  try {
    const f = (Guacamole as unknown as { AudioContextFactory?: AudioContextFactoryLike })
      .AudioContextFactory;
    return f?.getAudioContext() ?? null;
  } catch {
    return null;
  }
}

type GuacClient = InstanceType<typeof Guacamole.Client>;

export class SessionAudio {
  private muted = false;
  private active = true;
  private background = false;
  private streams = 0;
  private readonly cleanups: (() => void)[] = [];
  private readonly log: (message: string) => void;

  constructor(log: (message: string) => void) {
    this.log = log;
  }

  /** Number of audio streams the server opened in this session. */
  streamCount(): number {
    return this.streams;
  }

  contextState(): string {
    return audioContext()?.state ?? 'unavailable';
  }

  /** Install the `onaudio` handler on a new client. */
  install(client: GuacClient): void {
    client.onaudio = (stream, mimetype) => {
      if (!Guacamole.AudioPlayer.isSupportedType(mimetype)) {
        this.log(`Audio stream with unsupported type ${mimetype} refused`);
        return null;
      }
      const proxy = {
        index: stream.index,
        onblob: null as ((data: string) => void) | null,
        onend: null as (() => void) | null,
        sendAck: (message: string, code: number) => stream.sendAck(message, code),
        toReadableStream: () => stream.toReadableStream(),
      };
      const player = Guacamole.AudioPlayer.getInstance(
        proxy as unknown as Guacamole.InputStream,
        mimetype,
      );
      if (!player) return null;
      stream.onblob = (data) => {
        if (this.audible()) proxy.onblob?.(data);
      };
      stream.onend = () => {
        proxy.onend?.();
      };
      this.streams++;
      this.log(`Audio stream opened (${mimetype})`);
      return player;
    };
  }

  private audible(): boolean {
    if (this.muted || !this.active || this.background) return false;
    const ctx = audioContext();
    return ctx !== null && ctx.state === 'running';
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!muted) this.resume();
  }

  /** The session is shown (true) or hidden behind the app (false). */
  setActive(active: boolean): void {
    this.active = active;
  }

  /** Resume the shared AudioContext; only works from (or after) a user gesture on mobile. */
  resume(): void {
    if (this.muted || this.background) return;
    const ctx = audioContext();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => undefined);
  }

  /**
   * Listen for the first user gestures (to resume the context) and for the page being
   * hidden (to suspend it: the app went to the background).
   */
  listen(): void {
    this.unlisten();
    const gesture = () => this.resume();
    document.addEventListener('pointerdown', gesture, true);
    document.addEventListener('keydown', gesture, true);
    const visibility = () => {
      const hidden = document.visibilityState === 'hidden';
      this.background = hidden;
      const ctx = audioContext();
      if (!ctx) return;
      if (hidden && ctx.state === 'running') ctx.suspend().catch(() => undefined);
      else if (!hidden) this.resume();
    };
    document.addEventListener('visibilitychange', visibility);
    this.cleanups.push(() => {
      document.removeEventListener('pointerdown', gesture, true);
      document.removeEventListener('keydown', gesture, true);
      document.removeEventListener('visibilitychange', visibility);
    });
  }

  unlisten(): void {
    for (const c of this.cleanups.splice(0)) c();
  }

  /** The client is going away: forget its streams. */
  reset(): void {
    this.streams = 0;
  }
}
