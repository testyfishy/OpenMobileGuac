import { createContext, useContext, useEffect, useRef } from 'react';
import type { ConnectionTree } from '../../core/models/Connection.ts';
import type { SessionTarget } from '../nav/navigation.ts';
import { findTarget } from '../connections/treeView.ts';

/**
 * A connection to open as soon as its server's tree is available: from a deep link
 * (CON-5) or a quick-connect recent on the server list. The connection screen consumes it
 * once it has signed in and loaded the tree.
 */
export interface PendingLaunch {
  readonly serverId: string;
  readonly identifier: string;
  readonly dataSource: string | undefined;
  readonly type: 'c' | 'g';
  /**
   * The user already confirmed this launch ("Open … on …?" for an app link): no second
   * question ("Ask before connecting", MUL-5) for the same tap.
   */
  readonly confirmed?: boolean;
  /** When it was requested (`Date.now()`); a launch without it never expires. */
  readonly at?: number;
}

/**
 * How long a launch waits for its server's sign-in. A user who left the sign-in form and
 * opens that server much later only to browse must not get the connection opened for them.
 */
export const PENDING_LAUNCH_TTL_MS = 3 * 60_000;

/** `p` with the time of the request, so it expires after `PENDING_LAUNCH_TTL_MS`. */
export function timedLaunch(p: Omit<PendingLaunch, 'at'>): PendingLaunch {
  return { ...p, at: Date.now() };
}

export function launchExpired(p: PendingLaunch, now: number): boolean {
  return p.at !== undefined && (now - p.at > PENDING_LAUNCH_TTL_MS || now < p.at);
}

export interface LaunchApi {
  readonly request: (p: PendingLaunch) => void;
  /** Returns and clears the pending launch for `serverId`, if any. */
  readonly take: (serverId: string) => PendingLaunch | undefined;
  readonly peek: () => PendingLaunch | undefined;
}

export const LaunchContext = createContext<LaunchApi>({
  request: () => undefined,
  take: () => undefined,
  peek: () => undefined,
});

export function useLaunch(): LaunchApi {
  return useContext(LaunchContext);
}

/** In a connection screen: open the pending connection once `tree` is loaded. */
/** Whether a pending launch should wait: its data source is not in this tree (yet). */
export function launchWaitsForTree(tree: ConnectionTree, dataSource: string | undefined): boolean {
  const missing = tree.unavailable ?? [];
  // No data source in the link: any missing one may hold it.
  return dataSource === undefined ? missing.length > 0 : missing.includes(dataSource);
}

export function useConsumePendingLaunch(
  serverId: string,
  tree: ConnectionTree | undefined,
  onTarget: (t: SessionTarget, launch: PendingLaunch) => void,
  onMissing: () => void,
  version: number,
): void {
  const launch = useLaunch();
  const latest = useRef({ onTarget, onMissing });
  useEffect(() => {
    latest.current = { onTarget, onMissing };
  });
  useEffect(() => {
    if (!tree) return;
    const p = launch.peek();
    if (!p || p.serverId !== serverId) return;
    if (launchExpired(p, Date.now())) {
      launch.take(serverId);
      return;
    }
    const t = findTarget(tree, p.identifier, p.dataSource, p.type);
    // Its data source did not load this time (slow or failed): wait for the next tree
    // instead of saying the connection is gone.
    if (!t && launchWaitsForTree(tree, p.dataSource)) return;
    launch.take(serverId);
    if (t) latest.current.onTarget(t, p);
    else latest.current.onMissing();
  }, [tree, serverId, launch, version]);
}
