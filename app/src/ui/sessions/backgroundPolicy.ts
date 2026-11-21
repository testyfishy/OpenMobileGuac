/**
 * What happens to open sessions while the app is in the background (T2.1 and the Android
 * keep-alive). Pure.
 *
 * - Keep-alive off (default), or not Android: the grace timer disconnects live sessions
 *   after `backgroundDisconnectSeconds` (null = never), checked again on return.
 * - Keep-alive on, on Android: a foreground service holds the app while at least one
 *   session is live; while it actually runs, the grace timer does not disconnect anything.
 *   If the service failed to start, the grace period applies as before.
 * - iOS suspends the app soon after it leaves, unless Picture in Picture (experimental, per
 *   connection) has its window up: the web layer, and with it the session, has been seen
 *   to keep running then. While the window is up, neither the grace period
 *   nor "Sign out of servers after …" runs; both count from when it closes, as if the app
 *   had left then (`backgroundClockStart`). The app lock is never held off by it.
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
  /** The Picture in Picture window is up (iOS). */
  readonly pipWindowUp?: boolean;
}): boolean {
  return input.graceSeconds !== null && !input.keepAliveRunning && input.pipWindowUp !== true;
}

/**
 * When the background clocks (grace period, "Sign out of servers after …") start for this
 * trip away, or null when they do not run (in the foreground, or while the Picture in
 * Picture window is up). After the window closed during the trip, they count from then.
 * Pure.
 */
export function backgroundClockStart(input: {
  /** When the app left (null: in the foreground, or the absence was a prompt's own). */
  readonly awaySince: number | null;
  readonly pipWindowUp: boolean;
  /** When the window last closed during this trip away (null: it did not). */
  readonly pipClosedAt: number | null;
}): number | null {
  if (input.awaySince === null || input.pipWindowUp) return null;
  const closed = input.pipClosedAt;
  return closed !== null && closed > input.awaySince ? closed : input.awaySince;
}

/** A gap between two ticks of the away heartbeat longer than this means the page was frozen. */
export const PAGE_STALL_MS = 10_000;

/**
 * What is known about the Picture in Picture window when the app returns. The page hears of
 * the window closing through an event, and iOS may freeze the page before that event
 * arrives; it is then delivered on return, too late to date the closing. The window keeps
 * the page running, so a page that was frozen had no window from the moment it froze: the
 * clocks count from then at the latest. Pure.
 */
export function pipWindowOnReturn(input: {
  /** The window state as the page knows it (possibly stale). */
  readonly pipWindowUp: boolean;
  readonly pipClosedAt: number | null;
  /** When the page was first seen frozen during this trip away (null: it kept running). */
  readonly stalledFrom: number | null;
}): { pipWindowUp: boolean; pipClosedAt: number | null } {
  const { pipWindowUp, pipClosedAt, stalledFrom } = input;
  // No window during this trip: the clocks count from when the app left, as always.
  if (stalledFrom === null || (!pipWindowUp && pipClosedAt === null)) {
    return { pipWindowUp, pipClosedAt };
  }
  return {
    pipWindowUp: false,
    pipClosedAt: pipClosedAt === null ? stalledFrom : Math.min(pipClosedAt, stalledFrom),
  };
}

/** The decision when the grace timer fires or the app returns. */
export function shouldSuspendInBackground(input: {
  readonly backgroundedAt: number | null;
  readonly now: number;
  readonly graceSeconds: number | null;
  readonly keepAliveRunning: boolean;
  readonly pipWindowUp?: boolean;
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
