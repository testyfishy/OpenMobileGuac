import { PROMPT_BOUNCE_MS, type LockService } from './LockService.ts';

/**
 * What a lifecycle listener should do with an app-state change.
 * - `ignore`: nothing (a duplicate, or caused by an open system prompt).
 * - `away`: the app went to the background at `at`. `tentative` when it happened while a
 *   system prompt was open: it is most likely the prompt itself (Android shows it as an
 *   activity, iOS resigns active for Face ID), so do not cover the UI or start timers, but
 *   remember the time in case the user really left.
 * - `back`: the app is in the foreground again; `awaySince` is when it left, or `null` when
 *   the absence was the prompt's own pause/resume (nothing is due).
 */
export type AwayTransition =
  | { readonly kind: 'ignore' }
  | { readonly kind: 'away'; readonly at: number; readonly tentative: boolean }
  | { readonly kind: 'back'; readonly awaySince: number | null };

type Source = 'normal' | 'during-prompt' | 'after-prompt';

/**
 * Tells a real trip to the background from the pause/resume a biometric prompt causes, for
 * the app lock (`LockGate`) and "Sign out of servers after …" (`SessionsProvider`). Each
 * listener keeps its own tracker.
 *
 * Earlier, every transition within 1.5 s of a prompt was dropped, so a user who left the app
 * right after unlocking was never recorded as away and the lock and sign-out did not fire on
 * return (pre-release review R4). Now:
 * - while a prompt is open, a pause is remembered as tentative and a resume is the prompt's
 *   own bounce;
 * - a resume after a tentative pause is a bounce only if the prompt closed within
 *   `PROMPT_BOUNCE_MS`; later, it is a real return and the time away counts from the pause
 *   (an over-count, which can only lock sooner);
 * - just after a prompt, a pause is recorded normally, and the resume is a bounce only if
 *   the absence was shorter than `PROMPT_BOUNCE_MS`.
 */
export class AppAwayTracker {
  private readonly lock: Pick<LockService, 'promptInFlight' | 'promptEndedRecently'>;
  private readonly now: () => number;
  private awaySince: number | null = null;
  private source: Source = 'normal';

  constructor(
    lock: Pick<LockService, 'promptInFlight' | 'promptEndedRecently'>,
    now: () => number = () => Date.now(),
  ) {
    this.lock = lock;
    this.now = now;
  }

  change(active: boolean): AwayTransition {
    const now = this.now();
    if (!active) {
      if (this.awaySince !== null) return { kind: 'ignore' };
      this.awaySince = now;
      if (this.lock.promptInFlight()) {
        this.source = 'during-prompt';
        return { kind: 'away', at: now, tentative: true };
      }
      this.source = this.lock.promptEndedRecently() ? 'after-prompt' : 'normal';
      return { kind: 'away', at: now, tentative: false };
    }
    const since = this.awaySince;
    const source = this.source;
    this.awaySince = null;
    this.source = 'normal';
    if (since === null) {
      return this.lock.promptInFlight() ? { kind: 'ignore' } : { kind: 'back', awaySince: null };
    }
    if (
      source === 'during-prompt' &&
      (this.lock.promptInFlight() || this.lock.promptEndedRecently())
    ) {
      return bounce;
    }
    if (source === 'after-prompt' && now - since < PROMPT_BOUNCE_MS) return bounce;
    return { kind: 'back', awaySince: since };
  }
}

const bounce: AwayTransition = { kind: 'back', awaySince: null };
