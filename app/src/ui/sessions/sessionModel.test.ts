import { describe, expect, it } from 'vitest';
import type { SessionTarget } from '../nav/navigation.ts';
import {
  INITIAL_SESSIONS,
  activeSession,
  decideAuthRecovery,
  decideOpen,
  openTargetKeys,
  sessionsReducer,
  shouldLockOnResume,
  shouldSuspend,
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

  it('builds open-target keys per server', () => {
    expect([...openTargetKeys(withSessions('a'), 's1')]).toEqual(['c:ds:a']);
  });
});

describe('lifecycle timing', () => {
  it('suspends after the grace period, never when disabled', () => {
    expect(shouldSuspend(null, 1000, 60)).toBe(false);
    expect(shouldSuspend(0, 59_999, 60)).toBe(false);
    expect(shouldSuspend(0, 60_000, 60)).toBe(true);
    expect(shouldSuspend(0, 10_000_000, null)).toBe(false);
  });

  it('locks on resume after the configured time', () => {
    expect(shouldLockOnResume(false, 0, 0, 10)).toBe(false);
    expect(shouldLockOnResume(true, 0, 0, 0)).toBe(true);
    expect(shouldLockOnResume(true, 30, 0, 29_000)).toBe(false);
    expect(shouldLockOnResume(true, 30, 0, 30_000)).toBe(true);
    expect(shouldLockOnResume(true, 30, null, 30_000)).toBe(false);
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
