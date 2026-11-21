import { describe, expect, it } from 'vitest';
import {
  backgroundClockStart,
  resumeNeedsReconnect,
  graceApplies,
  keepAliveSupported,
  shouldSuspendInBackground,
  wantKeepAlive,
  type AppPlatform,
  pipWindowOnReturn,
} from './backgroundPolicy.ts';

describe('background keep-alive decisions', () => {
  it.each<[AppPlatform, boolean, number, boolean]>([
    ['android', true, 1, true],
    ['android', true, 0, false],
    ['android', false, 2, false],
    ['ios', true, 2, false],
    ['web', true, 2, false],
  ])('%s, setting %s, %i live → service %s', (platform, enabled, liveSessions, want) => {
    expect(wantKeepAlive({ platform, enabled, liveSessions })).toBe(want);
  });

  it('only Android supports it', () => {
    expect(keepAliveSupported('android')).toBe(true);
    expect(keepAliveSupported('ios')).toBe(false);
  });

  it.each([
    ['off: grace disconnects after the time', 60, false, 0, 60_000, true],
    ['off: not yet', 60, false, 0, 59_999, false],
    ['never', null, false, 0, 10 ** 9, false],
    ['keep-alive running: never disconnects', 60, true, 0, 10 ** 9, false],
  ] as const)('%s', (_n, grace, running, bgAt, now, suspend) => {
    expect(
      shouldSuspendInBackground({
        backgroundedAt: bgAt,
        now,
        graceSeconds: grace,
        keepAliveRunning: running,
      }),
    ).toBe(suspend);
    expect(graceApplies({ graceSeconds: grace, keepAliveRunning: running })).toBe(
      grace !== null && !running,
    );
  });

  it('a Picture in Picture window holds the grace period like the keep-alive', () => {
    expect(graceApplies({ graceSeconds: 60, keepAliveRunning: false, pipWindowUp: true })).toBe(
      false,
    );
    expect(
      shouldSuspendInBackground({
        backgroundedAt: 0,
        now: 10 ** 9,
        graceSeconds: 60,
        keepAliveRunning: false,
        pipWindowUp: true,
      }),
    ).toBe(false);
    // Setting off, or Android: the flag is never set, nothing changes.
    expect(graceApplies({ graceSeconds: 60, keepAliveRunning: false, pipWindowUp: false })).toBe(
      true,
    );
  });

  it('the background clocks count from when the Picture in Picture window closed', () => {
    // No window at all: from leaving the app, as before.
    expect(backgroundClockStart({ awaySince: 1000, pipWindowUp: false, pipClosedAt: null })).toBe(
      1000,
    );
    // Window up: they do not run.
    expect(
      backgroundClockStart({ awaySince: 1000, pipWindowUp: true, pipClosedAt: null }),
    ).toBeNull();
    // Closed during the trip away: from then.
    expect(backgroundClockStart({ awaySince: 1000, pipWindowUp: false, pipClosedAt: 90_000 })).toBe(
      90_000,
    );
    // A close before leaving the app does not move the start.
    expect(backgroundClockStart({ awaySince: 1000, pipWindowUp: false, pipClosedAt: 500 })).toBe(
      1000,
    );
    // In the foreground (or a prompt's own bounce): nothing runs.
    expect(
      backgroundClockStart({ awaySince: null, pipWindowUp: false, pipClosedAt: 90_000 }),
    ).toBeNull();
    // 60 s grace, window up for an hour, closed at 1 h: due one minute after the close.
    const closedAt = 3600_000;
    const from = backgroundClockStart({ awaySince: 0, pipWindowUp: false, pipClosedAt: closedAt });
    const due = (now: number) =>
      shouldSuspendInBackground({
        backgroundedAt: from,
        now,
        graceSeconds: 60,
        keepAliveRunning: false,
      });
    expect(due(closedAt + 59_999)).toBe(false);
    expect(due(closedAt + 60_000)).toBe(true);
  });

  it('not backgrounded: nothing to do', () => {
    expect(
      shouldSuspendInBackground({
        backgroundedAt: null,
        now: 5,
        graceSeconds: 0,
        keepAliveRunning: false,
      }),
    ).toBe(false);
  });
});

describe('resume after the background (AUDIT #8, guacd 15 s timeout)', () => {
  it('reconnects only a connected session whose tunnel is closed or unstable', () => {
    expect(resumeNeedsReconnect('connected', 2)).toBe(true);
    expect(resumeNeedsReconnect('connected', 3)).toBe(true);
    // Still open (e.g. kept alive by the Android foreground service): left alone.
    expect(resumeNeedsReconnect('connected', 1)).toBe(false);
    expect(resumeNeedsReconnect('reconnecting', 2)).toBe(false);
    expect(resumeNeedsReconnect('disconnected', 2)).toBe(false);
  });
});

describe('pipWindowOnReturn', () => {
  it('changes nothing when the page kept running', () => {
    expect(pipWindowOnReturn({ pipWindowUp: true, pipClosedAt: null, stalledFrom: null })).toEqual({
      pipWindowUp: true,
      pipClosedAt: null,
    });
  });
  it('changes nothing when there was no window during the trip', () => {
    expect(pipWindowOnReturn({ pipWindowUp: false, pipClosedAt: null, stalledFrom: 5000 })).toEqual(
      { pipWindowUp: false, pipClosedAt: null },
    );
  });
  it('a frozen page had no window from when it froze, whatever the page still believes', () => {
    expect(pipWindowOnReturn({ pipWindowUp: true, pipClosedAt: null, stalledFrom: 5000 })).toEqual({
      pipWindowUp: false,
      pipClosedAt: 5000,
    });
  });
  it('a close heard only on return is dated to the freeze, an earlier one is kept', () => {
    expect(
      pipWindowOnReturn({ pipWindowUp: false, pipClosedAt: 90_000, stalledFrom: 5000 }),
    ).toEqual({ pipWindowUp: false, pipClosedAt: 5000 });
    expect(pipWindowOnReturn({ pipWindowUp: false, pipClosedAt: 3000, stalledFrom: 5000 })).toEqual(
      { pipWindowUp: false, pipClosedAt: 3000 },
    );
  });
});
