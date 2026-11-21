import { describe, expect, it } from 'vitest';
import type { SessionTarget } from '../nav/navigation.ts';
import {
  INITIAL_SESSIONS,
  activeSession,
  decideAuthRecovery,
  decideOpen,
  findOpenSession,
  openAgainFor,
  openAgainToStore,
  openTargetKeys,
  sessionsReducer,
  shouldLockOnResume,
  shouldLockInBackground,
  shouldSignOutAfterBackground,
  type OpenSession,
  type SessionsState,
} from './sessionModel.ts';

const target = (id: string): SessionTarget => ({
  dataSource: 'ds',
  identifier: id,
  type: 'c',
  name: `Conn ${id}`,
  protocol: 'rdp',
});

const session = (id: string, at: number, serverId = 's1'): OpenSession => ({
  id,
  serverId,
  serverName: 'Server',
  target: target(id),
  openedAt: at,
  lastShownAt: at,
  state: 'live',
  epoch: 0,
});

function withSessions(...ids: string[]): SessionsState {
  return ids.reduce(
    (s, id, i) => sessionsReducer(s, { type: 'open', session: session(id, i) }),
    INITIAL_SESSIONS,
  );
}

describe('sessions reducer', () => {
  it('opens, hides, shows and closes', () => {
    let s = withSessions('a', 'b');
    expect(s.activeId).toBe('b');
    s = sessionsReducer(s, { type: 'hide' });
    expect(activeSession(s)).toBeUndefined();
    s = sessionsReducer(s, { type: 'show', id: 'a', now: 50 });
    expect(s.activeId).toBe('a');
    expect(s.sessions[0]?.lastShownAt).toBe(50);
    s = sessionsReducer(s, { type: 'close', id: 'a' });
    expect(s.activeId).toBeNull();
    expect(s.sessions.map((x) => x.id)).toEqual(['b']);
    expect(sessionsReducer(s, { type: 'show', id: 'zz', now: 1 })).toBe(s);
  });

  it('suspends live sessions and reconnects one with a new epoch', () => {
    let s = withSessions('a', 'b');
    s = sessionsReducer(s, { type: 'suspend-all' });
    expect(s.sessions.every((x) => x.state === 'suspended')).toBe(true);
    s = sessionsReducer(s, { type: 'reconnect', id: 'a', now: 9 });
    expect(s.sessions[0]).toMatchObject({ state: 'live', epoch: 1 });
    expect(s.sessions[1]?.state).toBe('suspended');
    expect(s.activeId).toBe('a');
    s = sessionsReducer(s, { type: 'reauth', id: 'b' });
    expect(s.sessions[1]?.state).toBe('reauth');
  });

  it('closes every session of a server', () => {
    let s = sessionsReducer(withSessions('a'), { type: 'open', session: session('x', 5, 's2') });
    s = sessionsReducer(s, { type: 'close-server', serverId: 's2' });
    expect(s.sessions.map((x) => x.id)).toEqual(['a']);
    expect(s.activeId).toBeNull();
  });
});

describe('decideOpen', () => {
  it('switches to an already-open connection', () => {
    expect(decideOpen(withSessions('a'), 's1', target('a'), 3)).toEqual({
      kind: 'existing',
      id: 'a',
    });
    expect(decideOpen(withSessions('a'), 's2', target('a'), 3)).toEqual({ kind: 'open' });
  });

  it('enforces the cap and suggests the least recently shown', () => {
    let s = withSessions('a', 'b', 'c');
    s = sessionsReducer(s, { type: 'show', id: 'a', now: 100 });
    const d = decideOpen(s, 's1', target('d'), 3);
    expect(d.kind).toBe('limit');
    expect(d.kind === 'limit' && d.suggest.id).toBe('b');
    expect(decideOpen(s, 's1', target('d'), 4)).toEqual({ kind: 'open' });
  });

  it('follows "When a connection is already open"', () => {
    const s = withSessions('a');
    expect(decideOpen(s, 's1', target('a'), 3, 'switch')).toEqual({ kind: 'existing', id: 'a' });
    expect(decideOpen(s, 's1', target('a'), 3, 'ask')).toEqual({ kind: 'ask', id: 'a' });
    expect(decideOpen(s, 's1', target('a'), 3, 'new')).toEqual({ kind: 'open' });
    // Not open: every setting simply opens.
    for (const p of ['ask', 'switch', 'new'] as const) {
      expect(decideOpen(s, 's1', target('b'), 3, p)).toEqual({ kind: 'open' });
      expect(decideOpen(s, 's2', target('a'), 3, p)).toEqual({ kind: 'open' });
    }
  });

  it('"Open another" skips the open session but still respects the cap', () => {
    const s = withSessions('a');
    expect(decideOpen(s, 's1', target('a'), 3, 'ask', true)).toEqual({ kind: 'open' });
    const d = decideOpen(s, 's1', target('a'), 1, 'ask', true);
    expect(d.kind === 'limit' && d.suggest.id).toBe('a');
    // Opening another at the cap with 'new' asks to close one, too.
    expect(decideOpen(s, 's1', target('a'), 1, 'new').kind).toBe('limit');
  });

  it('goes to the most recently shown of several sessions of that connection', () => {
    let s = withSessions('a');
    const dup: OpenSession = { ...session('a', 5), id: 'a2' };
    s = sessionsReducer(s, { type: 'open', session: dup });
    s = sessionsReducer(s, { type: 'show', id: 'a', now: 50 });
    expect(decideOpen(s, 's1', target('a'), 3, 'switch')).toEqual({ kind: 'existing', id: 'a' });
    s = sessionsReducer(s, { type: 'show', id: 'a2', now: 60 });
    expect(decideOpen(s, 's1', target('a'), 3, 'ask')).toEqual({ kind: 'ask', id: 'a2' });
    expect(findOpenSession(s, 's1', target('a'))?.id).toBe('a2');
    expect(findOpenSession(s, 's2', target('a'))).toBeUndefined();
  });

  it('a suspended session still counts as open (switching reconnects it)', () => {
    const s = sessionsReducer(withSessions('a'), { type: 'suspend-all' });
    expect(decideOpen(s, 's1', target('a'), 3, 'switch')).toEqual({ kind: 'existing', id: 'a' });
  });

  it('admin Join and share links always go to the open session', () => {
    const joined: SessionTarget = { ...target('a'), join: '$abc' };
    expect(openAgainFor('ask', joined, false)).toBe('switch');
    expect(openAgainFor('new', joined, false)).toBe('switch');
    expect(openAgainFor('new', target('a'), true)).toBe('switch');
    expect(openAgainFor('ask', target('a'), false)).toBe('ask');
    expect(openAgainFor('new', target('a'), false)).toBe('new');
  });

  it('stores the answer only with "Don\'t ask again", never on Cancel', () => {
    expect(openAgainToStore('switch', true)).toBe('switch');
    expect(openAgainToStore('new', true)).toBe('new');
    expect(openAgainToStore('switch', false)).toBeNull();
    expect(openAgainToStore('new', false)).toBeNull();
    expect(openAgainToStore('cancel', true)).toBeNull();
  });

  it('builds open-target keys per server', () => {
    expect([...openTargetKeys(withSessions('a'), 's1')]).toEqual(['c:ds:a']);
  });

  it('a resumed own session (MUL-5 "Open the existing one") counts as the connection’s open one', () => {
    const joined: OpenSession = {
      ...session('a', 1),
      id: 'j',
      target: { ...target('a'), join: '$own' },
      resumed: true,
    };
    const s = sessionsReducer(INITIAL_SESSIONS, { type: 'open', session: joined });
    expect(findOpenSession(s, 's1', target('a'))?.id).toBe('j');
    expect(decideOpen(s, 's1', target('a'), 3, 'switch')).toEqual({ kind: 'existing', id: 'j' });
    expect([...openTargetKeys(s, 's1')]).toEqual(['c:ds:a']);
    // Someone else's joined session (admin Join) does not.
    const { resumed: _resumed, ...plain } = joined;
    void _resumed;
    const other = sessionsReducer(INITIAL_SESSIONS, { type: 'open', session: plain });
    expect(findOpenSession(other, 's1', target('a'))).toBeUndefined();
    expect([...openTargetKeys(other, 's1')]).toEqual([]);
  });
});

describe('lifecycle timing', () => {
  it('locks on resume after the configured time', () => {
    expect(shouldLockOnResume(false, 0, 0, 10)).toBe(false);
    expect(shouldLockOnResume(true, 0, 0, 0)).toBe(true);
    expect(shouldLockOnResume(true, 30, 0, 29_000)).toBe(false);
    expect(shouldLockOnResume(true, 30, 0, 30_000)).toBe(true);
    expect(shouldLockOnResume(true, 30, null, 30_000)).toBe(false);
  });

  it('signs out of servers after the chosen background time, never by default', () => {
    const at = 1_000_000;
    const decide = (afterSeconds: number | null, now: number, keepAliveRunning = false) =>
      shouldSignOutAfterBackground({ afterSeconds, backgroundedAt: at, now, keepAliveRunning });
    expect(decide(null, at + 10 * 24 * 3600_000)).toBe(false);
    expect(decide(300, at + 299_999)).toBe(false);
    expect(decide(300, at + 300_000)).toBe(true);
    expect(decide(3600, at + 3600_000)).toBe(true);
    // The Android keep-alive held the sessions: the user chose to stay connected.
    expect(decide(300, at + 300_000, true)).toBe(false);
    // Never in the background, or a clock set back.
    expect(shouldSignOutAfterBackground({ afterSeconds: 60, backgroundedAt: null, now: at })).toBe(
      false,
    );
    expect(decide(60, at - 120_000)).toBe(false);
    // A Picture in Picture window is up: the clock does not run.
    expect(
      shouldSignOutAfterBackground({
        afterSeconds: 300,
        backgroundedAt: at,
        now: at + 10 * 3600_000,
        pipWindowUp: true,
      }),
    ).toBe(false);
  });

  it('locks in the background only while a Picture in Picture window is up', () => {
    const base = { enabled: true, afterSeconds: 60, backgroundedAt: 0 };
    expect(shouldLockInBackground({ ...base, now: 60_000, pipWindowUp: true })).toBe(true);
    expect(shouldLockInBackground({ ...base, now: 59_999, pipWindowUp: true })).toBe(false);
    // No window: decided on return, as before.
    expect(shouldLockInBackground({ ...base, now: 10 ** 9, pipWindowUp: false })).toBe(false);
    expect(
      shouldLockInBackground({ ...base, enabled: false, now: 10 ** 9, pipWindowUp: true }),
    ).toBe(false);
    expect(
      shouldLockInBackground({ ...base, backgroundedAt: null, now: 10 ** 9, pipWindowUp: true }),
    ).toBe(false);
  });
});

describe('expired sign-in during a live session', () => {
  const now = 1_000_000;

  it('reconnects after a silent re-login and asks the user when that is not possible', () => {
    expect(decideAuthRecovery({ result: 'relogged', now })).toBe('reconnect');
    expect(decideAuthRecovery({ result: 'needs-sign-in', now })).toBe('reauth');
    expect(decideAuthRecovery({ result: 'failed', now })).toBe('keep-error');
  });

  it('leaves a real permission error alone when the token is still valid', () => {
    expect(decideAuthRecovery({ result: 'ok', now })).toBe('keep-error');
    // ... unless another session of the server just signed in again.
    expect(decideAuthRecovery({ result: 'ok', now, serverReloggedAt: now - 5_000 })).toBe(
      'reconnect',
    );
    expect(decideAuthRecovery({ result: 'ok', now, serverReloggedAt: now - 120_000 })).toBe(
      'keep-error',
    );
  });

  it('does not loop when the fresh sign-in is refused again', () => {
    expect(decideAuthRecovery({ result: 'relogged', now, sessionRecoveredAt: now - 10_000 })).toBe(
      'keep-error',
    );
    expect(decideAuthRecovery({ result: 'relogged', now, sessionRecoveredAt: now - 120_000 })).toBe(
      'reconnect',
    );
    // Needing the user always wins.
    expect(decideAuthRecovery({ result: 'needs-sign-in', now, sessionRecoveredAt: now - 1 })).toBe(
      'reauth',
    );
  });

  it('can reconnect a hidden session without showing it', () => {
    const state: SessionsState = {
      sessions: [session('a', 1), session('b', 2)],
      activeId: 'a',
    };
    const next = sessionsReducer(state, { type: 'reconnect', id: 'b', now: 9, show: false });
    expect(next.activeId).toBe('a');
    expect(next.sessions[1]).toMatchObject({ epoch: 1, lastShownAt: 2, state: 'live' });
    expect(sessionsReducer(state, { type: 'reconnect', id: 'b', now: 9 }).activeId).toBe('b');
  });
});
