import { describe, expect, it } from 'vitest';
import {
  INITIAL_SESSION_MACHINE,
  STATUS,
  classifyStatus,
  endHeading,
  isSignInFailure,
  reduceSession,
  statusMessage,
  type SessionEvent,
  type SessionMachine,
} from './status.ts';

const run = (events: SessionEvent[], m: SessionMachine = INITIAL_SESSION_MACHINE) =>
  events.reduce((acc, e) => reduceSession(acc, e), m);
const connected = [{ type: 'connect' }, { type: 'connected' }] as const satisfies SessionEvent[];

describe('end reasons', () => {
  it('distinguishes the guacd session codes and RDP messages', () => {
    expect(classifyStatus(STATUS.SESSION_CONFLICT)).toBe('kicked');
    expect(classifyStatus(STATUS.SESSION_TIMEOUT)).toBe('idle');
    expect(classifyStatus(STATUS.SESSION_CLOSED, 'Forcibly disconnected.')).toBe('server-closed');
    expect(classifyStatus(STATUS.SESSION_CLOSED, 'Logged off.')).toBe('logged-off');
    expect(classifyStatus(STATUS.UPSTREAM_NOT_FOUND)).toBe('network');
    expect(endHeading('kicked', true)).toBe('Signed in elsewhere');
  });

  it('labels 0x0301 by source', () => {
    expect(statusMessage(STATUS.CLIENT_UNAUTHORIZED, undefined, 'client')).toMatch(
      /rejected the sign-in/,
    );
    expect(statusMessage(STATUS.CLIENT_UNAUTHORIZED, undefined, 'tunnel')).toMatch(/Sign in/);
  });

  it('does not retry terminal causes and gives a tailored heading', () => {
    for (const [code, heading] of [
      [STATUS.SESSION_CONFLICT, 'Signed in elsewhere'],
      [STATUS.SESSION_TIMEOUT, 'Session timed out'],
      [STATUS.SESSION_CLOSED, 'Disconnected by the server'],
    ] as const) {
      const m = run([
        ...connected,
        { type: 'error', code, source: 'client' },
        { type: 'closed', intentional: false },
      ]);
      expect(m.phase).toMatchObject({ kind: 'error', heading });
    }
  });

  it('keeps the first error of an attempt', () => {
    const m = run([
      ...connected,
      { type: 'error', code: STATUS.SESSION_CONFLICT, source: 'client' },
      { type: 'error', code: STATUS.UPSTREAM_NOT_FOUND, source: 'tunnel' },
      { type: 'closed', intentional: false },
    ]);
    expect(m.phase).toMatchObject({ kind: 'error', code: STATUS.SESSION_CONFLICT });
  });

  it('reports a server-side end without an error as disconnected by the server', () => {
    const m = run([...connected, { type: 'closed', intentional: true, byServer: true }]);
    expect(m.phase).toEqual({ kind: 'disconnected', byServer: true });
  });
});

describe('network awareness', () => {
  it('waits for the network instead of burning attempts while offline', () => {
    let m = run([
      ...connected,
      { type: 'network', online: false },
      { type: 'error', code: STATUS.UPSTREAM_NOT_FOUND, source: 'tunnel' },
      { type: 'closed', intentional: false },
    ]);
    expect(m.phase).toMatchObject({ kind: 'reconnecting', attempt: 1, waitingForNetwork: true });
    m = run([{ type: 'network', online: true }], m);
    expect(m.phase).toMatchObject({ kind: 'reconnecting', waitingForNetwork: false });
    expect(m.offline).toBe(false);
  });

  it('says the device is offline when a first connection fails offline', () => {
    const m = run([
      { type: 'network', online: false },
      { type: 'connect' },
      { type: 'closed', intentional: false },
    ]);
    expect(m.phase).toMatchObject({ kind: 'error', message: 'This device is offline.' });
  });
});

describe('expired sign-in on reconnect', () => {
  const dropThenRefused = (code: number, source: 'tunnel' | 'client') =>
    run([
      ...connected,
      { type: 'closed', intentional: false }, // the network dropped: retry
      { type: 'connect' },
      { type: 'error', code, source },
      { type: 'closed', intentional: false },
    ]);

  it('flags a tunnel refusal (expired or revoked token) for the shell', () => {
    expect(isSignInFailure(dropThenRefused(STATUS.CLIENT_UNAUTHORIZED, 'tunnel').phase)).toBe(true);
    expect(isSignInFailure(dropThenRefused(STATUS.CLIENT_FORBIDDEN, 'tunnel').phase)).toBe(true);
  });

  it('does not flag the remote computer refusing its own credentials', () => {
    expect(isSignInFailure(dropThenRefused(STATUS.CLIENT_UNAUTHORIZED, 'client').phase)).toBe(
      false,
    );
    expect(isSignInFailure(dropThenRefused(STATUS.UPSTREAM_NOT_FOUND, 'tunnel').phase)).toBe(false);
    expect(isSignInFailure(run(connected).phase)).toBe(false);
  });
});

describe('clean server close vs network drop (AUDIT #7)', () => {
  it('a clean close with no error (admin Kill: WebSocket 1000, SUCCESS) never reconnects', () => {
    const m = run([...connected, { type: 'closed', intentional: false }]);
    expect(m.phase.kind).not.toBe('reconnecting');
    const byServer = run([...connected, { type: 'closed', intentional: true, byServer: true }]);
    expect(byServer.phase).toEqual({ kind: 'disconnected', byServer: true });
  });

  it.each([
    ['WebSocket 1006 (UPSTREAM_NOT_FOUND)', STATUS.UPSTREAM_NOT_FOUND],
    ['receive timeout (UPSTREAM_TIMEOUT)', STATUS.UPSTREAM_TIMEOUT],
    ['proxy going away (UPSTREAM_UNAVAILABLE)', STATUS.UPSTREAM_UNAVAILABLE],
  ])('a network drop reported as %s retries', (_label, code) => {
    const m = run([
      ...connected,
      { type: 'error', code, source: 'tunnel' },
      { type: 'closed', intentional: false },
    ]);
    expect(m.phase.kind).toBe('reconnecting');
  });

  it.each([
    ['kicked', STATUS.SESSION_CONFLICT],
    ['idle', STATUS.SESSION_TIMEOUT],
    ['closed by the server', STATUS.SESSION_CLOSED],
  ])('a session ended by the server (%s) is not retried', (_label, code) => {
    const m = run([
      ...connected,
      { type: 'error', code, source: 'client' },
      { type: 'closed', intentional: false },
    ]);
    expect(m.phase.kind).toBe('error');
  });
});

describe('WebSocket blocked before the session started (AUDIT: no HTTP fallback)', () => {
  it('names a blocked WebSocket when the tunnel never opened', () => {
    const m = run([
      { type: 'connect' },
      { type: 'error', code: STATUS.UPSTREAM_NOT_FOUND, source: 'tunnel' },
      { type: 'closed', intentional: false },
    ]);
    expect(m.phase).toMatchObject({ kind: 'error' });
    expect(m.phase.kind === 'error' && m.phase.message).toMatch(/WebSocket/);
  });
});
