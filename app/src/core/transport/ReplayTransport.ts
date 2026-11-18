import {
  ModelParseError,
  expectRecord,
  expectString,
  optionalNumber,
  stringArray,
} from '../models/json.ts';
import { TunnelState, type StatusLike, type TunnelLike } from './TunnelLike.ts';

/** One recorded server-to-client instruction. */
export interface RecordedInstruction {
  readonly opcode: string;
  readonly args: readonly string[];
  /** Delay before this instruction, in ms, measured from the previous one (or from open). */
  readonly delayMs: number;
}

/** An instruction the client sent while replaying. */
export interface SentInstruction {
  readonly opcode: string;
  readonly args: readonly string[];
}

/** Scheduling functions. Injectable, but the defaults work with Vitest fake timers. */
export interface ReplayScheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ReplayOptions {
  /** UUID reported on open. Default `'replay'`. */
  readonly uuid?: string;
  /** Playback speed multiplier, where 2 means twice as fast. Default 1. */
  readonly speed?: number;
  /**
   * What happens after the last instruction:
   * - `'stay-open'` (default) keeps the tunnel open, like an idle session.
   * - `'close'` moves to `CLOSED`.
   * - A `StatusLike` fires `onerror` with it, then closes.
   */
  readonly onEnd?: 'stay-open' | 'close' | StatusLike;
  readonly scheduler?: ReplayScheduler;
}

const defaultScheduler: ReplayScheduler = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * A `TunnelLike` that plays a recorded instruction list with its original timing. It is used
 * for tests, demo mode and UI work without a server.
 *
 * Timeline after `connect(data)`:
 * 1. The state becomes `CONNECTING` synchronously.
 * 2. After 0 ms, `onuuid` fires, then the state becomes `OPEN`. This matches
 *    `WebSocketTunnel`, which opens on the first (UUID) instruction.
 * 3. Each instruction is delivered to `oninstruction` after its `delayMs` (divided by
 *    `speed`), relative to the previous instruction. Instructions with `delayMs: 0` are
 *    delivered synchronously together with the one before them, including the open step.
 * 4. Finally the `onEnd` behaviour runs.
 *
 * Outgoing messages are not interpreted. Messages sent while connected are recorded in
 * `sent` for assertions, and messages sent while not connected are dropped, as upstream
 * does.
 */
export class ReplayTransport implements TunnelLike {
  state: number = TunnelState.CLOSED;
  uuid: string | null = null;
  receiveTimeout = 15000;
  unstableThreshold = 1500;

  onuuid: ((uuid: string) => void) | null = null;
  onerror: ((status: StatusLike) => void) | null = null;
  onstatechange: ((state: number) => void) | null = null;
  oninstruction: ((opcode: string, args: string[]) => void) | null = null;

  /** The `data` passed to each `connect()` call. */
  readonly connectData: (string | undefined)[] = [];
  /** Instructions sent while connected. */
  readonly sent: SentInstruction[] = [];

  private readonly recording: readonly RecordedInstruction[];
  private readonly options: ReplayOptions;
  private readonly scheduler: ReplayScheduler;
  private timer: unknown = undefined;
  private position = 0;

  constructor(recording: readonly RecordedInstruction[], options: ReplayOptions = {}) {
    const speed = options.speed ?? 1;
    if (!(speed > 0) || !Number.isFinite(speed)) throw new RangeError('speed must be > 0');
    for (const [i, ins] of recording.entries()) {
      if (!(ins.delayMs >= 0) || !Number.isFinite(ins.delayMs)) {
        throw new RangeError(`recording[${i}].delayMs must be a finite number >= 0`);
      }
    }
    this.recording = recording;
    this.options = options;
    this.scheduler = options.scheduler ?? defaultScheduler;
  }

  /** Number of recorded instructions delivered so far. */
  get delivered(): number {
    return this.position;
  }

  connect(data?: string): void {
    this.cancelTimer();
    this.connectData.push(data);
    this.position = 0;
    this.uuid = null;
    this.setState(TunnelState.CONNECTING);
    this.schedule(0, () => {
      this.setUUID(this.options.uuid ?? 'replay');
      this.setState(TunnelState.OPEN);
      this.scheduleNext();
    });
  }

  disconnect(): void {
    this.cancelTimer();
    this.setState(TunnelState.CLOSED);
  }

  sendMessage(...elements: unknown[]): void {
    if (!this.isConnected() || elements.length === 0) return;
    const [opcode, ...args] = elements.map(String);
    this.sent.push({ opcode: opcode ?? '', args });
  }

  isConnected(): boolean {
    return this.state === TunnelState.OPEN || this.state === TunnelState.UNSTABLE;
  }

  setState(state: number): void {
    if (state !== this.state) {
      this.state = state;
      this.onstatechange?.(state);
    }
  }

  setUUID(uuid: string): void {
    this.uuid = uuid;
    this.onuuid?.(uuid);
  }

  /**
   * Delivers every due zero-delay instruction synchronously, as one burst, which is how a
   * real tunnel delivers several instructions from one message. Then it schedules the next
   * delayed instruction, or finishes.
   */
  private scheduleNext(): void {
    for (;;) {
      const next = this.recording[this.position];
      if (!next) {
        this.finish();
        return;
      }
      if (next.delayMs > 0) {
        this.schedule(next.delayMs / (this.options.speed ?? 1), () => this.deliverThenContinue());
        return;
      }
      if (!this.deliver()) return;
    }
  }

  private deliverThenContinue(): void {
    if (this.deliver()) this.scheduleNext();
  }

  /** Delivers the current instruction. Returns whether playback should continue. */
  private deliver(): boolean {
    const ins = this.recording[this.position];
    if (!ins) return false;
    this.position++;
    this.oninstruction?.(ins.opcode, [...ins.args]);
    // The handler may have disconnected the tunnel.
    return this.isConnected();
  }

  private finish(): void {
    const onEnd = this.options.onEnd ?? 'stay-open';
    if (onEnd === 'stay-open') return;
    if (onEnd !== 'close') this.onerror?.(onEnd);
    this.setState(TunnelState.CLOSED);
  }

  private schedule(ms: number, fn: () => void): void {
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = undefined;
      fn();
    }, ms);
  }

  private cancelTimer(): void {
    if (this.timer !== undefined) {
      this.scheduler.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}

/**
 * Validates a recording loaded from JSON: an array of `{ opcode, args, delayMs }`. A missing
 * `delayMs` means 0.
 */
export function parseRecording(raw: unknown): RecordedInstruction[] {
  if (!Array.isArray(raw)) throw new ModelParseError('', 'expected an array of instructions');
  return raw.map((item, i) => {
    const path = `[${i}]`;
    const obj = expectRecord(item, path);
    const delayMs = optionalNumber(obj, 'delayMs', path) ?? 0;
    if (delayMs < 0) throw new ModelParseError(`${path}.delayMs`, 'must be >= 0');
    return {
      opcode: expectString(obj, 'opcode', path),
      args: stringArray(obj, 'args', path),
      delayMs,
    };
  });
}
