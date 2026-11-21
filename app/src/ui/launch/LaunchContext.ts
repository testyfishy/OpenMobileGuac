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
    launch.take(serverId);
    const t = findTarget(tree, p.identifier, p.dataSource, p.type);
    if (t) latest.current.onTarget(t, p);
    else latest.current.onMissing();
  }, [tree, serverId, launch, version]);
}
