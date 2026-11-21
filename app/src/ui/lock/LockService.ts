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
 * - Fails closed (AUDIT #3): while enabled, an error or "not available" from the biometric
 *   plugin keeps the app locked. Only `setEnabled(false)` (an authenticated Settings action,
 *   or the lock screen's "remove saved sign-ins" escape that deletes every secret first)
 *   releases it.
 * - `cover()` hides the UI when the app goes to the background, before the next paint on
 *   return; `uncover()` lifts it without a prompt when the lock is not due yet.
 * - `whenUnlocked()` is what every use of a stored token, password or TOTP seed (sign-in,
 *   silent re-login, reconnect, deep link) waits on, so nothing runs behind the lock screen.
 * - `confirmPresence()` is the separate SRV-11 check before a remembered connection
 *   password is filled in; it works whether or not the lock is on.
 */

const RECENT_MS = 30_000;

/**
 * SRV-11: after the connection-password check was cancelled or failed, further checks in
 * this window are not shown (the password prompt appears instead), so several sessions
 * reconnecting at once never stack prompts after the user said no.
 */
export const DECLINE_MS = 10_000;

/**
 * Whether the lock is enforced for a stored setting and the device's reported support.
 * Fails closed: "no device security" or a plugin error keeps it on (the lock screen then
 * explains and offers Retry). Only the web build, which has no lock at all, turns it off.
 */
export function lockEnforced(settingEnabled: boolean, availability: BiometryAvailability): boolean {
  return settingEnabled && availability !== 'web';
}

export interface LockDeps {
  readonly authenticate?: (reason: string, cancel: string) => Promise<AuthOutcome>;
  readonly availability?: () => Promise<BiometryAvailability>;
  readonly now?: () => number;
}

export type LockState = 'unlocked' | 'covered' | 'locked';

export class LockService {
  private enabled = false;
  private locked = false;
  /** Covered while backgrounded: the UI is hidden but no prompt is due yet. */
  private covered = false;
  private waiters: (() => void)[] = [];
  private lastUnlockAt = Number.NEGATIVE_INFINITY;
  private inFlight: Promise<AuthOutcome> | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly authenticate: (reason: string, cancel: string) => Promise<AuthOutcome>;
  private readonly availabilityFn: () => Promise<BiometryAvailability>;
  private readonly now: () => number;
  /** Set when the prompt finishes, so a resume caused by the prompt itself is ignored. */
  private promptEndedAt = Number.NEGATIVE_INFINITY;
  /** In the foreground (fed by `setActive`, whether or not the lock is on). */
  private active = true;
  private activeWaiters: (() => void)[] = [];
  /** Last real move to the background (not one caused by the prompt). */
  private backgroundedAt = Number.NEGATIVE_INFINITY;
  /** Last cancelled / failed connection-password check (`DECLINE_MS`). */
  private declinedAt = Number.NEGATIVE_INFINITY;

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
    if (!on && (this.locked || this.covered)) {
      this.locked = false;
      this.covered = false;
      this.emit();
    }
  }

  /** Locked or covered: stored secrets must not be used. */
  isLocked(): boolean {
    return this.enabled && (this.locked || this.covered);
  }

  state(): LockState {
    if (!this.enabled) return 'unlocked';
    return this.locked ? 'locked' : this.covered ? 'covered' : 'unlocked';
  }

  /** Resolves at once when unlocked, otherwise on the next successful unlock. */
  whenUnlocked(): Promise<void> {
    if (!this.isLocked()) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  /** Hide the UI (going to the background). Does nothing when the lock is off. */
  cover(): void {
    if (!this.enabled || this.covered || this.locked) return;
    this.covered = true;
    this.emit();
  }

  /** Back in the foreground and the lock is not due: lift the cover without a prompt. */
  uncover(): void {
    if (!this.covered) return;
    this.covered = false;
    this.emit();
  }

  /** Unlocked within `RECENT_MS` (or the lock is off): saved secrets may be read without a prompt. */
  recentlyUnlocked(): boolean {
    if (!this.enabled) return true;
    return !this.isLocked() && this.now() - this.lastUnlockAt < RECENT_MS;
  }

  /** True while a system prompt is open or just closed (it can trigger pause/resume). */
  promptActive(): boolean {
    return this.inFlight !== null || this.now() - this.promptEndedAt < 1500;
  }

  lock(): void {
    if (!this.enabled || this.locked) return;
    this.locked = true;
    this.covered = false;
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
      if (this.locked || this.covered) {
        this.locked = false;
        this.covered = false;
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
    if (!this.isLocked() && this.now() - this.lastUnlockAt < RECENT_MS) return true;
    return (await this.prompt(reason, cancel)) === 'ok';
  }

  /**
   * The app went to the background (false) or came back (true). Callers skip transitions
   * caused by the system prompt itself (`promptActive()`), as LockGate does.
   */
  setActive(active: boolean): void {
    if (!active) {
      if (this.active) this.backgroundedAt = this.now();
      this.active = false;
      return;
    }
    this.active = true;
    const ws = this.activeWaiters;
    this.activeWaiters = [];
    for (const w of ws) w();
  }

  isActive(): boolean {
    return this.active;
  }

  /** Resolves at once in the foreground, otherwise when the app comes back. */
  whenActive(): Promise<void> {
    if (this.active) return Promise.resolve();
    return new Promise((resolve) => this.activeWaiters.push(resolve));
  }

  /**
   * A successful device check (any prompt: app lock, saved credentials, a connection
   * password) within `RECENT_MS`, with the app in the foreground the whole time since.
   * Unlike `recentlyUnlocked()`, this does not count "the lock is off" as a check.
   */
  verifiedRecently(): boolean {
    const at = this.lastUnlockAt;
    return (
      this.active && !this.isLocked() && at > this.backgroundedAt && this.now() - at < RECENT_MS
    );
  }

  /**
   * SRV-11: the check before a remembered connection password is filled in, independent of
   * the app lock. True = the value may be used now.
   *
   * - No biometrics or passcode on the device (or the web build): no check, true.
   * - Waits until the app lock is passed and the app is in the foreground, so the prompt is
   *   never shown behind the lock screen or while in the background.
   * - Grace: a successful check of any kind within `RECENT_MS`, without going to the
   *   background since, counts (no second prompt).
   * - One prompt at a time: concurrent callers share it (`prompt`).
   * - After a cancel or failure, checks within `DECLINE_MS` return false without a prompt.
   *   False never deletes anything: the caller shows the normal password prompt.
   */
  async confirmPresence(reason: string, cancel: string): Promise<boolean> {
    const availability = await this.availabilityFn().catch(() => 'no-device-security' as const);
    if (availability !== 'available') return true;
    await this.whenUnlocked();
    await this.whenActive();
    if (this.verifiedRecently()) return true;
    if (!this.inFlight && this.now() - this.declinedAt < DECLINE_MS) return false;
    const outcome = await this.prompt(reason, cancel);
    if (outcome !== 'ok') this.declinedAt = this.now();
    return outcome === 'ok';
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): LockState => this.state();

  private emit(): void {
    if (!this.isLocked() && this.waiters.length > 0) {
      const ws = this.waiters;
      this.waiters = [];
      for (const w of ws) w();
    }
    for (const l of this.listeners) l();
  }
}
