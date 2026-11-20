/**
 * What happens to open sessions while the app is in the background (T2.1 and the Android
 * keep-alive). Pure.
 *
 * - Keep-alive off (default), or not Android: the grace timer disconnects live sessions
 *   after `backgroundDisconnectSeconds` (null = never), checked again on return.
 * - Keep-alive on, on Android: a foreground service holds the app while at least one
 *   session is live; while it actually runs, the grace timer does not disconnect anything.
 *   If the service failed to start, the grace period applies as before.
 * - iOS never keeps sessions in the background (no background mode this app qualifies for).
 */

export type AppPlatform = 'android' | 'ios' | 'web';

export function keepAliveSupported(platform: AppPlatform): boolean {
  return platform === 'android';
}

/** Whether the foreground service should be running now. */
export function wantKeepAlive(input: {
  readonly platform: AppPlatform;
  readonly enabled: boolean;
  readonly liveSessions: number;
}): boolean {
  return keepAliveSupported(input.platform) && input.enabled && input.liveSessions > 0;
}

/** Whether the background grace period may disconnect sessions. */
export function graceApplies(input: {
  readonly graceSeconds: number | null;
  /** The foreground service is running (started successfully). */
  readonly keepAliveRunning: boolean;
}): boolean {
  return input.graceSeconds !== null && !input.keepAliveRunning;
}

/** The decision when the grace timer fires or the app returns. */
export function shouldSuspendInBackground(input: {
  readonly backgroundedAt: number | null;
  readonly now: number;
  readonly graceSeconds: number | null;
  readonly keepAliveRunning: boolean;
}): boolean {
  if (!graceApplies(input) || input.backgroundedAt === null || input.graceSeconds === null) {
    return false;
  }
  return input.now - input.backgroundedAt >= input.graceSeconds * 1000;
}
