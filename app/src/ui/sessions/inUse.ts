import type { ActiveConnection, PermissionSet } from '../../core/models/Admin.ts';
import { canKill, isAdmin } from '../admin/permissions.ts';
import type { SessionTarget } from '../nav/navigation.ts';
import type { AskInUse, OpenAgain } from '../settings/settingsModel.ts';
import { decideOpen, openAgainFor, type OpenDecision, type SessionsState } from './sessionModel.ts';

/**
 * "Ask before connecting" (MUL-5): before a new session starts, the server is asked whether
 * the connection already has active sessions (one left running when the app was closed,
 * killed by the system or lost its sign-in), and the user chooses what to do. Pure.
 *
 * What the server tells whom (Guacamole 1.6.0 database extension, docs/protocol-notes.md
 * §8.5): `GET connections/{id}` counts every active connection to it; `GET activeConnections`
 * lists those on connections the user may read, but fills `username`, `remoteHost` and
 * `connectable` only for the user's own ones (or for administrators), and `DELETE` (ending
 * one) is granted the same way.
 */

/** What the server reported for one connection. */
export interface ServerUse {
  /** Active connections to it, across all users. */
  readonly count: number;
  /** Its entries in `GET activeConnections`; undefined when the list could not be read. */
  readonly entries: readonly ActiveConnection[] | undefined;
  /** The user's effective permissions in that data source; undefined when not readable. */
  readonly permissions: PermissionSet | undefined;
}

/** One line of "who": the user's own session, or another user's (name when the server says). */
export interface InUsePerson {
  readonly own: boolean;
  readonly username: string | undefined;
  readonly startDate: number | undefined;
}

export type ExistingChoice =
  /** A session of this connection is open in the app: go to it. */
  | { readonly kind: 'switch'; readonly id: string }
  /**
   * A running session the server lets this account join (`connectable`; the user's own
   * newest first, otherwise, for an administrator, the newest one): join it (`GUAC_TYPE=a`).
   */
  | {
      readonly kind: 'join';
      readonly activeId: string;
      readonly own: boolean;
      readonly username: string | undefined;
    };

export type InUsePlan =
  | { readonly kind: 'connect' }
  /** "Ask before connecting" = Always and the connection is not in use: a plain confirm. */
  | { readonly kind: 'confirm'; readonly checked: boolean }
  | {
      readonly kind: 'prompt';
      /** Sessions on the server besides the ones open in this app. */
      readonly count: number;
      readonly people: readonly InUsePerson[];
      /** "Open the existing one"; undefined = not offered. */
      readonly existing: ExistingChoice | undefined;
      /** Show "This account cannot join running sessions; …" instead. */
      readonly cannotJoin: boolean;
      /** "End it and start fresh" ends exactly these active connections; empty = not offered. */
      readonly end: readonly string[];
    };

/** What a tap does before any server question (`decideTap`). */
export type TapDecision =
  | OpenDecision
  /** Ask the server first ("Ask before connecting"), then `planInUse`. */
  | { readonly kind: 'check' }
  /** "Connect to <name>?" without asking the server (Always; groups, or not signed in). */
  | { readonly kind: 'confirm' };

/**
 * One question per tap: the in-app decision (`decideOpen`, MUL-4 and the cap) comes first,
 * and only a plain "open" may lead to the server question. `skipInUse` is set when the user
 * already answered a question for this tap (the MUL-4 "Open another", an in-use answer, a
 * confirmed app link). Pure.
 */
export function decideTap(input: {
  readonly state: SessionsState;
  readonly serverId: string;
  readonly target: SessionTarget;
  readonly maxSessions: number;
  readonly openAgain: OpenAgain;
  readonly askInUse: AskInUse;
  readonly forceNew: boolean;
  readonly skipInUse: boolean;
  readonly demo: boolean;
  readonly shareLink: boolean;
  /** The app holds a sign-in for that server (the check needs it). */
  readonly signedIn: boolean;
}): TapDecision {
  const policy = openAgainFor(input.openAgain, input.target, input.shareLink);
  const d = decideOpen(
    input.state,
    input.serverId,
    input.target,
    input.maxSessions,
    policy,
    input.forceNew,
  );
  if (d.kind !== 'open') return d;
  if (input.skipInUse) return d;
  const mode = inUseCheckApplies({
    setting: input.askInUse,
    target: input.target,
    demo: input.demo,
    shareLink: input.shareLink,
  });
  if (mode === 'skip') return d;
  if (mode === 'confirm-only' || !input.signedIn)
    return input.askInUse === 'always' ? { kind: 'confirm' } : d;
  return { kind: 'check' };
}

/**
 * Whether the server is asked at all for this tap. Never for the Demo, share links, joining
 * (admin Join or "Open the existing one" itself) or with the setting at Never. Balancing
 * groups get only the plain "Always" confirm: their count is spread over member connections
 * that cannot be joined from here.
 */
export function inUseCheckApplies(input: {
  readonly setting: AskInUse;
  readonly target: SessionTarget;
  readonly demo: boolean;
  readonly shareLink: boolean;
}): 'check' | 'confirm-only' | 'skip' {
  if (input.setting === 'never' || input.demo || input.shareLink) return 'skip';
  if (input.target.join !== undefined) return 'skip';
  if (input.target.type !== 'c') return input.setting === 'always' ? 'confirm-only' : 'skip';
  return 'check';
}

/** Same connection, whether opened directly or by joining one of its active connections. */
export function sameConnection(a: SessionTarget, b: SessionTarget): boolean {
  return a.type === b.type && a.dataSource === b.dataSource && a.identifier === b.identifier;
}

/** Live sessions in the app to this connection (each holds one active connection). */
export function liveInAppCount(
  state: SessionsState,
  serverId: string,
  target: SessionTarget,
): number {
  return state.sessions.filter(
    (s) => s.serverId === serverId && s.state === 'live' && sameConnection(s.target, target),
  ).length;
}

/** Live in-app sessions per connection (`type:dataSource:identifier`), joined ones included. */
export function liveInAppCounts(state: SessionsState, serverId: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of state.sessions) {
    if (s.serverId !== serverId || s.state !== 'live') continue;
    const key = `${s.target.type}:${s.target.dataSource}:${s.target.identifier}`;
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

/** The number to show on an "In use" badge: server count minus this app's own live sessions. */
export function serverOnlyCount(serverCount: number, liveInApp: number): number {
  return Math.max(0, serverCount - liveInApp);
}

function isOwn(a: ActiveConnection, username: string | undefined): boolean {
  return username !== undefined && username !== '' && a.username === username;
}

const newestFirst = (x: ActiveConnection, y: ActiveConnection) =>
  (y.startDate ?? 0) - (x.startDate ?? 0);

/**
 * What to do after the check. `use` is undefined when the check failed or timed out (then
 * the app just connects, or shows the plain confirm with Always). `liveInApp` and
 * `inAppId` describe sessions of this connection already open in the app (only reached with
 * "When a connection is already open" = Open another); their active connections cannot be
 * told apart from stale ones, so nothing is ended while one is open.
 */
export function planInUse(input: {
  readonly setting: AskInUse;
  readonly use: ServerUse | undefined;
  readonly username: string | undefined;
  readonly liveInApp: number;
  readonly inAppId?: string | undefined;
}): InUsePlan {
  const { setting, use, username, liveInApp } = input;
  if (setting === 'never') return { kind: 'connect' };
  const plain: InUsePlan =
    setting === 'always' ? { kind: 'confirm', checked: use !== undefined } : { kind: 'connect' };
  if (!use) return plain;
  const entries = use.entries ? [...use.entries].sort(newestFirst) : undefined;
  const total = Math.max(use.count, entries?.length ?? 0);
  const count = serverOnlyCount(total, liveInApp);
  if (count === 0) return plain;

  const own = entries?.filter((a) => isOwn(a, username)) ?? [];
  // The server marks what this account may join (`connectable`): its own sessions, or every
  // one for an administrator. The user's own newest first, then the newest of the others.
  const joinable =
    own.find((a) => a.connectable === true) ?? entries?.find((a) => a.connectable === true);
  const existing: ExistingChoice | undefined = input.inAppId
    ? { kind: 'switch', id: input.inAppId }
    : joinable
      ? {
          kind: 'join',
          activeId: joinable.identifier,
          own: isOwn(joinable, username),
          username: joinable.username,
        }
      : undefined;
  const cannotJoin = existing === undefined;

  const perms = use.permissions;
  let end: string[] = [];
  if (perms && liveInApp === 0 && entries) {
    const mine = own.filter((a) => canKill(perms, a.identifier));
    // Only the user's own sessions, unless an administrator and none of them is the user's.
    end =
      own.length > 0
        ? mine.map((a) => a.identifier)
        : isAdmin(perms)
          ? entries.filter((a) => canKill(perms, a.identifier)).map((a) => a.identifier)
          : [];
    // Never a partial "start fresh" over sessions the user cannot see or end.
    if (end.length === 0 || end.length < (own.length > 0 ? own.length : total)) end = [];
  }

  return {
    kind: 'prompt',
    count,
    people: (entries ?? []).map((a) => ({
      own: isOwn(a, username),
      username: a.username,
      startDate: a.startDate,
    })),
    existing,
    cannotJoin,
    end,
  };
}

/**
 * The setting to store after the in-use question or the plain confirm: Never when "Don't
 * ask again" is ticked with an explicit choice; nothing on Cancel.
 */
export function askInUseToStore(
  answer: 'existing' | 'end' | 'another' | 'connect' | 'cancel',
  dontAskAgain: boolean,
): AskInUse | null {
  return answer !== 'cancel' && dontAskAgain ? 'never' : null;
}

/** "14:02" today, otherwise date and time, in the device's locale. */
export function sinceLabel(ms: number | undefined, now: number, locale?: string): string {
  if (ms === undefined) return '';
  const d = new Date(ms);
  const n = new Date(now);
  const sameDay =
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate();
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  return sameDay
    ? time
    : `${d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} ${time}`;
}
