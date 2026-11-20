import { describe, expect, it } from 'vitest';
import {
  resumeNeedsReconnect,
  graceApplies,
  keepAliveSupported,
  shouldSuspendInBackground,
  wantKeepAlive,
  type AppPlatform,
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
