import {
  authenticateUser,
  biometryAvailability,
  type AuthOutcome,
  type BiometryAvailability,
} from '../services/native.ts';

/**
 * The app lock (SPEC SRV-6): a biometric / device-credential prompt. One instance per app.
 *
 * - `locked` covers the whole UI (see `LockScreen`) until `unlock()` succeeds.
 * - `ensureUnlocked()` is the gate before saved credentials are used. A successful unlock
 *   counts for `RECENT_MS`, so opening the app and then signing in prompts once, not twice.
 * - While the system prompt is showing, the app may report going to the background (it does
 *   on Android, where the prompt is an activity); `promptInFlight` lets the lifecycle code
 *   ignore those transitions instead of locking again in a loop.
 */

const RECENT_MS = 30_000;

export interface LockDeps {
  readonly authenticate?: (reason: string, cancel: string) => Promise<AuthOutcome>;
  readonly availability?: () => Promise<BiometryAvailability>;
  readonly now?: () => number;
}

export class LockService {
  private enabled = false;
  private locked = false;
  private lastUnlockAt = Number.NEGATIVE_INFINITY;
  private inFlight: Promise<AuthOutcome> | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly authenticate: (reason: string, cancel: string) => Promise<AuthOutcome>;
  private readonly availabilityFn: () => Promise<BiometryAvailability>;
  private readonly now: () => number;
  /** Set when the prompt finishes, so a resume caused by the prompt itself is ignored. */
  private promptEndedAt = Number.NEGATIVE_INFINITY;

  constructor(deps: LockDeps = {}) {
    this.authenticate = deps.authenticate ?? authenticateUser;
    this.availabilityFn = deps.availability ?? biometryAvailability;
    this.now = deps.now ?? (() => Date.now());
  }

  availability(): Promise<BiometryAvailability> {
    return this.availabilityFn();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on && this.locked) {
      this.locked = false;
      this.emit();
    }
  }

  isLocked(): boolean {
    return this.locked;
  }

  /** Unlocked within `RECENT_MS` (or the lock is off): saved secrets may be read without a prompt. */
  recentlyUnlocked(): boolean {
    if (!this.enabled) return true;
    return !this.locked && this.now() - this.lastUnlockAt < RECENT_MS;
  }

  /** True while a system prompt is open or just closed (it can trigger pause/resume). */
  promptActive(): boolean {
    return this.inFlight !== null || this.now() - this.promptEndedAt < 1500;
  }

  lock(): void {
    if (!this.enabled || this.locked) return;
    this.locked = true;
    this.emit();
  }

  /** Shows the system prompt (one at a time). */
  async prompt(reason: string, cancel: string): Promise<AuthOutcome> {
    if (!this.inFlight) {
      this.inFlight = this.authenticate(reason, cancel).finally(() => {
        this.inFlight = null;
        this.promptEndedAt = this.now();
      });
    }
    const outcome = await this.inFlight;
    if (outcome === 'ok') {
      this.lastUnlockAt = this.now();
      if (this.locked) {
        this.locked = false;
        this.emit();
      }
    }
    return outcome;
  }

  unlock(reason: string, cancel: string): Promise<AuthOutcome> {
    return this.prompt(reason, cancel);
  }

  /** Gate before saved credentials are used. Always true when the lock is off. */
  async ensureUnlocked(reason: string, cancel: string): Promise<boolean> {
    if (!this.enabled) return true;
    if (!this.locked && this.now() - this.lastUnlockAt < RECENT_MS) return true;
    return (await this.prompt(reason, cancel)) === 'ok';
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): boolean => this.locked;

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
