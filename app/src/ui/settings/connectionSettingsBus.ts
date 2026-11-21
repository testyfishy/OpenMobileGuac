import { connectionRefKey, type ConnectionRef } from '../../core/storage/ProfileStore.ts';

/**
 * "These stored session settings changed" (SET-1): written by one screen, seen by the others
 * that are mounted at the same time. An open session (`SessionHost`) follows edits made in
 * Settings without being remounted, and the Settings lists refresh their counts after a
 * change made in a session.
 *
 * Each writer publishes after its write has been stored, with an `origin` of its own;
 * listeners ignore their own origin, so nobody re-reads its own write.
 *
 * Pure (no React); the store itself stays unaware of it.
 */

export interface ConnectionSettingsChange {
  readonly serverId: string;
  /** The connection (`connectionRefKey`), or `undefined` for the server's own defaults. */
  readonly refKey: string | undefined;
  /** Who wrote it (a session id, a screen instance). */
  readonly origin: string;
}

type Listener = (change: ConnectionSettingsChange) => void;

const listeners = new Set<Listener>();
let nextOrigin = 0;

/** A fresh origin id for one writer. */
export function newOrigin(prefix: string): string {
  nextOrigin += 1;
  return `${prefix}-${nextOrigin}`;
}

export function publishSettingsChange(
  serverId: string,
  ref: ConnectionRef | undefined,
  origin: string,
): void {
  const change: ConnectionSettingsChange = {
    serverId,
    refKey: ref ? connectionRefKey(ref) : undefined,
    origin,
  };
  for (const l of [...listeners]) {
    try {
      l(change);
    } catch {
      // One broken listener must not stop the others.
    }
  }
}

/** Calls `listener` for every change from another origin. Returns the unsubscribe. */
export function subscribeSettingsChanges(origin: string, listener: Listener): () => void {
  const l: Listener = (c) => {
    if (c.origin !== origin) listener(c);
  };
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Whether `change` concerns the session of this connection (its own or its server's). */
export function affectsConnection(
  change: ConnectionSettingsChange,
  serverId: string,
  ref: ConnectionRef,
): boolean {
  if (change.serverId !== serverId) return false;
  return change.refKey === undefined || change.refKey === connectionRefKey(ref);
}
