import { describe, expect, it } from 'vitest';
import type { AuthOutcome } from '../services/native.ts';
import { shouldLockOnResume, shouldSignOutAfterBackground } from '../sessions/sessionModel.ts';
import { AppAwayTracker } from './appAwayTracker.ts';
import { LockService } from './LockService.ts';

function setup() {
  let t = 1_000_000;
  let release: ((o: AuthOutcome) => void) | null = null;
  const lock = new LockService({
    authenticate: () =>
      new Promise<AuthOutcome>((resolve) => {
        release = resolve;
      }),
    availability: async () => 'available',
    now: () => t,
  });
  lock.setEnabled(true);
  const tracker = new AppAwayTracker(lock, () => t);
  const advance = (ms: number) => (t += ms);
  /** Open a prompt; returns a function that closes it with `ok`. */
  const openPrompt = () => {
    const p = lock.prompt('r', 'c');
    return async () => {
      release?.('ok');
      await p;
    };
  };
  return { lock, tracker, advance, openPrompt, now: () => t };
}

describe('AppAwayTracker (pre-release review R4)', () => {
  it('records a real trip away right after a prompt, so the lock and sign-out fire', async () => {
    const { tracker, advance, openPrompt, now } = setup();
    const close = openPrompt();
    await close();
    advance(200); // still inside the post-prompt window
    const left = tracker.change(false);
    expect(left).toEqual({ kind: 'away', at: now(), tentative: false });
    advance(10 * 60_000);
    const back = tracker.change(true);
    expect(back.kind).toBe('back');
    const since = back.kind === 'back' ? back.awaySince : null;
    expect(since).not.toBeNull();
    // "Lock immediately" and "Sign out after 5 minutes" both apply.
    expect(shouldLockOnResume(true, 0, since, now())).toBe(true);
    expect(
      shouldSignOutAfterBackground({
        afterSeconds: 300,
        backgroundedAt: since,
        now: now(),
        keepAliveRunning: false,
      }),
    ).toBe(true);
  });

  it("treats a short pause/resume right after a prompt as the prompt's own", async () => {
    const { tracker, advance, openPrompt } = setup();
    await openPrompt()();
    advance(100);
    expect(tracker.change(false)).toMatchObject({ kind: 'away', tentative: false });
    advance(300);
    expect(tracker.change(true)).toEqual({ kind: 'back', awaySince: null });
  });

  it('ignores the pause/resume of an open prompt', async () => {
    const { tracker, advance, openPrompt } = setup();
    const close = openPrompt();
    expect(tracker.change(false)).toMatchObject({ kind: 'away', tentative: true });
    advance(4000); // the user takes a while to look at the sensor
    await close();
    advance(50);
    expect(tracker.change(true)).toEqual({ kind: 'back', awaySince: null });
    // A resume with nothing recorded while a prompt is open is ignored.
    openPrompt();
    expect(tracker.change(true)).toEqual({ kind: 'ignore' });
  });

  it('counts a return long after the prompt closed as a real absence', async () => {
    const { tracker, advance, openPrompt } = setup();
    const close = openPrompt();
    const left = tracker.change(false); // the user pressed Home while the prompt was up
    await close(); // the system cancels it
    advance(60 * 60_000);
    const back = tracker.change(true);
    expect(back).toEqual({ kind: 'back', awaySince: left.kind === 'away' ? left.at : -1 });
  });

  it('keeps the first pause of a run of pauses', () => {
    const { tracker, advance, now } = setup();
    const at = now();
    tracker.change(false);
    advance(1000);
    expect(tracker.change(false)).toEqual({ kind: 'ignore' });
    advance(1000);
    expect(tracker.change(true)).toEqual({ kind: 'back', awaySince: at });
  });
});
