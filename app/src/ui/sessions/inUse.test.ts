import { describe, expect, it } from 'vitest';
import {
  ObjectPermission,
  SystemPermission,
  type ActiveConnection,
  type PermissionSet,
} from '../../core/models/Admin.ts';
import type { SessionTarget } from '../nav/navigation.ts';
import type { AskInUse } from '../settings/settingsModel.ts';
import {
  askInUseToStore,
  decideTap,
  inUseCheckApplies,
  liveInAppCount,
  liveInAppCounts,
  planInUse,
  serverOnlyCount,
  sinceLabel,
  type InUsePlan,
  type ServerUse,
} from './inUse.ts';
import { INITIAL_SESSIONS, type OpenSession, type SessionsState } from './sessionModel.ts';

const target: SessionTarget = {
  dataSource: 'postgresql',
  identifier: '1',
  type: 'c',
  name: 'Office PC',
  protocol: 'rdp',
};

function active(
  identifier: string,
  username: string | undefined,
  startDate: number,
  connectable = username !== undefined,
): ActiveConnection {
  return {
    identifier,
    connectionIdentifier: '1',
    startDate,
    remoteHost: undefined,
    username,
    connectable,
  };
}

function perms(opts: { admin?: boolean; del?: readonly string[] } = {}): PermissionSet {
  return {
    system: new Set(opts.admin ? [SystemPermission.ADMINISTER] : []),
    connections: new Map(),
    connectionGroups: new Map(),
    activeConnections: new Map(
      (opts.del ?? []).map((id) => [id, new Set([ObjectPermission.READ, ObjectPermission.DELETE])]),
    ),
  };
}

function session(id: string, over: Partial<OpenSession> = {}): OpenSession {
  return {
    id,
    serverId: 's1',
    serverName: 'Home',
    target,
    openedAt: 0,
    lastShownAt: 0,
    state: 'live',
    epoch: 0,
    ...over,
  };
}

const ME = 'alice';

function plan(
  use: ServerUse | undefined,
  over: { setting?: AskInUse; liveInApp?: number; inAppId?: string } = {},
): InUsePlan {
  return planInUse({
    setting: over.setting ?? 'in-use',
    use,
    username: ME,
    liveInApp: over.liveInApp ?? 0,
    inAppId: over.inAppId,
  });
}

function prompt(p: InUsePlan) {
  if (p.kind !== 'prompt') throw new Error(`expected a prompt, got ${p.kind}`);
  return p;
}

describe('when the server is asked at all (MUL-5)', () => {
  const base = { setting: 'in-use' as AskInUse, target, demo: false, shareLink: false };

  it('checks a plain connection', () => {
    expect(inUseCheckApplies(base)).toBe('check');
    expect(inUseCheckApplies({ ...base, setting: 'always' })).toBe('check');
  });

  it('never for Never, the Demo, share links or joining (admin Join and "open existing")', () => {
    expect(inUseCheckApplies({ ...base, setting: 'never' })).toBe('skip');
    expect(inUseCheckApplies({ ...base, demo: true, setting: 'always' })).toBe('skip');
    expect(inUseCheckApplies({ ...base, shareLink: true, setting: 'always' })).toBe('skip');
    expect(inUseCheckApplies({ ...base, target: { ...target, join: 'a1' } })).toBe('skip');
  });

  it('balancing groups get only the plain "Always" confirm', () => {
    const group = { ...target, type: 'g' as const };
    expect(inUseCheckApplies({ ...base, target: group })).toBe('skip');
    expect(inUseCheckApplies({ ...base, target: group, setting: 'always' })).toBe('confirm-only');
  });
});

describe('what the check leads to', () => {
  it('not in use: connects (When in use) or asks "Connect to …?" (Always)', () => {
    const idle: ServerUse = { count: 0, entries: [], permissions: perms() };
    expect(plan(idle)).toEqual({ kind: 'connect' });
    expect(plan(idle, { setting: 'always' })).toEqual({ kind: 'confirm', checked: true });
  });

  it('a failed or timed-out check never blocks: connect, or the plain confirm', () => {
    expect(plan(undefined)).toEqual({ kind: 'connect' });
    expect(plan(undefined, { setting: 'always' })).toEqual({ kind: 'confirm', checked: false });
  });

  it('Never always connects', () => {
    const busy: ServerUse = { count: 3, entries: undefined, permissions: undefined };
    expect(plan(busy, { setting: 'never' })).toEqual({ kind: 'connect' });
  });

  it('the app’s own live sessions do not count as "in use"', () => {
    const mine: ServerUse = { count: 1, entries: [active('a1', ME, 10)], permissions: perms() };
    expect(plan(mine, { liveInApp: 1, inAppId: 'x' })).toEqual({ kind: 'connect' });
    expect(serverOnlyCount(3, 1)).toBe(2);
    expect(serverOnlyCount(1, 2)).toBe(0);
  });

  it('own stale session: open it (join the newest own one) or end it, then start fresh', () => {
    const p = prompt(
      plan({
        count: 2,
        entries: [active('old', ME, 10), active('new', ME, 20)],
        permissions: perms({ del: ['old', 'new'] }),
      }),
    );
    expect(p.count).toBe(2);
    expect(p.existing).toEqual({ kind: 'join', activeId: 'new', own: true, username: ME });
    expect(p.cannotJoin).toBe(false);
    expect([...p.end].sort()).toEqual(['new', 'old']);
    expect(p.people.map((x) => [x.own, x.startDate])).toEqual([
      [true, 20],
      [true, 10],
    ]);
  });

  it('a session open in the app (with "Open another") is the existing one; nothing is ended', () => {
    const p = prompt(
      plan(
        {
          count: 2,
          entries: [active('a1', ME, 10), active('a2', ME, 20)],
          permissions: perms({ del: ['a1', 'a2'] }),
        },
        { liveInApp: 1, inAppId: 'in-app' },
      ),
    );
    expect(p.count).toBe(1);
    expect(p.existing).toEqual({ kind: 'switch', id: 'in-app' });
    // Which active connection is the app's own cannot be told: never end any.
    expect(p.end).toEqual([]);
  });

  it('another user’s session (name hidden by the server): no open/end, the join note', () => {
    const p = prompt(
      plan({
        count: 1,
        entries: [active('b1', undefined, 30, false)],
        permissions: perms(),
      }),
    );
    expect(p.existing).toBeUndefined();
    expect(p.end).toEqual([]);
    expect(p.cannotJoin).toBe(true);
    expect(p.people).toEqual([{ own: false, username: undefined, startDate: 30 }]);
  });

  it('list not readable: count only, with the "cannot join" note', () => {
    const p = prompt(plan({ count: 1, entries: undefined, permissions: undefined }));
    expect(p.existing).toBeUndefined();
    expect(p.cannotJoin).toBe(true);
    expect(p.end).toEqual([]);
    expect(p.people).toEqual([]);
  });

  it('own session the server does not let this account join: the note, no Open', () => {
    const p = prompt(
      plan({ count: 1, entries: [active('a1', ME, 10, false)], permissions: perms() }),
    );
    expect(p.existing).toBeUndefined();
    expect(p.cannotJoin).toBe(true);
  });

  it('End only with DELETE on every one of the own sessions', () => {
    const entries = [active('a1', ME, 10), active('a2', ME, 20)];
    expect(prompt(plan({ count: 2, entries, permissions: perms() })).end).toEqual([]);
    expect(prompt(plan({ count: 2, entries, permissions: perms({ del: ['a1'] }) })).end).toEqual(
      [],
    );
    expect(prompt(plan({ count: 2, entries, permissions: undefined })).end).toEqual([]);
  });

  it('End never touches other users’ sessions next to the user’s own', () => {
    const p = prompt(
      plan({
        count: 2,
        entries: [active('a1', ME, 10), active('b1', 'bob', 20)],
        permissions: perms({ admin: true }),
      }),
    );
    expect(p.end).toEqual(['a1']);
    // The user's own session before a newer one of someone else.
    expect(p.existing).toEqual({ kind: 'join', activeId: 'a1', own: true, username: ME });
  });

  it('an administrator may open (join) or end other users’ sessions when none is their own', () => {
    const p = prompt(
      plan({
        count: 2,
        entries: [active('b1', 'bob', 20), active('c1', 'carol', 30)],
        permissions: perms({ admin: true }),
      }),
    );
    expect([...p.end].sort()).toEqual(['b1', 'c1']);
    // The newest joinable one; not the user's own, so the app names it after its user.
    expect(p.existing).toEqual({ kind: 'join', activeId: 'c1', own: false, username: 'carol' });
    expect(p.cannotJoin).toBe(false);
    expect(p.people.map((x) => x.username)).toEqual(['carol', 'bob']);
  });

  it('an administrator does not get End when the list misses sessions the count reports', () => {
    const p = prompt(
      plan({ count: 2, entries: [active('b1', 'bob', 20)], permissions: perms({ admin: true }) }),
    );
    expect(p.end).toEqual([]);
  });

  it('a non-administrator never ends other users’ sessions', () => {
    const p = prompt(
      plan({
        count: 1,
        entries: [active('b1', 'bob', 20, false)],
        permissions: perms({ del: ['b1'] }),
      }),
    );
    expect(p.end).toEqual([]);
  });

  it('an anonymous sign-in (no user name) never matches anyone as "own"', () => {
    const p = planInUse({
      setting: 'in-use',
      use: { count: 1, entries: [active('a1', '', 10)], permissions: perms({ del: ['a1'] }) },
      username: '',
      liveInApp: 0,
    });
    // Joinable if the server says so, but never treated as the user's own (no "resumed").
    expect(prompt(p).existing).toMatchObject({ kind: 'join', own: false });
    expect(prompt(p).end).toEqual([]);
  });
});

describe('one question per tap (decideTap)', () => {
  const open = (over: Partial<OpenSession> = {}) =>
    ({ ...INITIAL_SESSIONS, sessions: [session('x', over)] }) as SessionsState;
  const tap = (over: Partial<Parameters<typeof decideTap>[0]> = {}) =>
    decideTap({
      state: INITIAL_SESSIONS,
      serverId: 's1',
      target,
      maxSessions: 3,
      openAgain: 'switch',
      askInUse: 'in-use',
      forceNew: false,
      skipInUse: false,
      demo: false,
      shareLink: false,
      signedIn: true,
      ...over,
    });

  it('a connection not open in the app: asks the server', () => {
    expect(tap()).toEqual({ kind: 'check' });
    expect(tap({ askInUse: 'always' })).toEqual({ kind: 'check' });
    expect(tap({ askInUse: 'never' })).toEqual({ kind: 'open' });
  });

  it('open in the app with "Go to the open session": switches silently, no server question', () => {
    expect(tap({ state: open() })).toEqual({ kind: 'existing', id: 'x' });
    expect(tap({ state: open(), askInUse: 'always' })).toEqual({ kind: 'existing', id: 'x' });
  });

  it('open in the app with Ask: only the "already open" question', () => {
    expect(tap({ state: open(), openAgain: 'ask' })).toEqual({ kind: 'ask', id: 'x' });
  });

  it('open in the app with "Open another": the server question (its count minus the app’s)', () => {
    expect(tap({ state: open(), openAgain: 'new' })).toEqual({ kind: 'check' });
  });

  it('after "Open another" in the "already open" question: no second question', () => {
    expect(tap({ state: open(), openAgain: 'ask', forceNew: true, skipInUse: true })).toEqual({
      kind: 'open',
    });
  });

  it('at the session cap: only the cap question', () => {
    const d = tap({ state: open({ target: { ...target, identifier: '2' } }), maxSessions: 1 });
    expect(d.kind).toBe('limit');
  });

  it('a confirmed app link: nothing more is asked', () => {
    expect(tap({ skipInUse: true })).toEqual({ kind: 'open' });
    expect(tap({ skipInUse: true, askInUse: 'always' })).toEqual({ kind: 'open' });
  });

  it('the Demo, share links and joins never ask; groups only with Always', () => {
    expect(tap({ demo: true, askInUse: 'always' })).toEqual({ kind: 'open' });
    expect(tap({ shareLink: true, askInUse: 'always' })).toEqual({ kind: 'open' });
    expect(tap({ target: { ...target, join: 'a1' } })).toEqual({ kind: 'open' });
    const group = { ...target, type: 'g' as const };
    expect(tap({ target: group })).toEqual({ kind: 'open' });
    expect(tap({ target: group, askInUse: 'always' })).toEqual({ kind: 'confirm' });
  });

  it('not signed in to the server: no check (Always still confirms)', () => {
    expect(tap({ signedIn: false })).toEqual({ kind: 'open' });
    expect(tap({ signedIn: false, askInUse: 'always' })).toEqual({ kind: 'confirm' });
  });

  it('after joining the own session, the next tap goes to it instead of joining again', () => {
    const resumed = open({ target: { ...target, join: 'a1' }, resumed: true });
    expect(tap({ state: resumed })).toEqual({ kind: 'existing', id: 'x' });
  });
});

describe('"Don\'t ask again" for the in-use question', () => {
  it('stores Never only with an explicit choice', () => {
    for (const a of ['existing', 'end', 'another', 'connect'] as const) {
      expect(askInUseToStore(a, true)).toBe('never');
      expect(askInUseToStore(a, false)).toBeNull();
    }
    expect(askInUseToStore('cancel', true)).toBeNull();
  });
});

describe('in-app counts', () => {
  const state: SessionsState = {
    ...INITIAL_SESSIONS,
    sessions: [
      session('a'),
      session('b', { target: { ...target, join: 'x', name: 'joined' } }),
      session('c', { state: 'suspended' }),
      session('d', { serverId: 's2' }),
    ],
  };

  it('counts live sessions of the connection, joined ones included, suspended ones not', () => {
    expect(liveInAppCount(state, 's1', target)).toBe(2);
    expect(liveInAppCounts(state, 's1').get('c:postgresql:1')).toBe(2);
    expect(liveInAppCounts(state, 's2').get('c:postgresql:1')).toBe(1);
  });
});

describe('"since" label', () => {
  it('time only today, date and time otherwise, nothing when unknown', () => {
    const now = new Date(2026, 10, 21, 15, 0).getTime();
    const today = new Date(2026, 10, 21, 14, 2).getTime();
    const before = new Date(2026, 10, 19, 9, 5).getTime();
    expect(sinceLabel(today, now, 'en-GB')).toBe('14:02');
    expect(sinceLabel(before, now, 'en-GB')).toContain('09:05');
    expect(sinceLabel(before, now, 'en-GB')).toContain('19');
    expect(sinceLabel(undefined, now)).toBe('');
  });
});
