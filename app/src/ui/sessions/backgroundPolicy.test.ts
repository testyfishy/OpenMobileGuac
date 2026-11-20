import { describe, expect, it } from 'vitest';
import {
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
