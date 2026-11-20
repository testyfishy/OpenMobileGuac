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

/**
 * After a return to the app (checked about 2 s later): a session that still counts as
 * connected but whose tunnel is closed or unstable (no data for 1.5 s, while a live tunnel
 * gets a ping echo every 500 ms) has been dropped while the app was paused, e.g. iOS
 * suspended the WebView and guacd ended the silent user after GUACD_TIMEOUT (15 s,
 * guacamole-server `src/guacd/proc.h`). Reconnect it at once. Keep-alive `nop`s (Client.js,
 * every 5 s) and tunnel pings (Tunnel.js, every 500 ms) only stop when the OS pauses the
 * WebView; nothing in the app suppresses them. Tunnel states: 0 connecting, 1 open,
 * 2 closed, 3 unstable.
 */
export function resumeNeedsReconnect(phase: string, tunnelState: number): boolean {
  return phase === 'connected' && (tunnelState === 2 || tunnelState === 3);
}
