import { describe, expect, it } from 'vitest';
import type { GuacErrorInfo } from '../../core/api/errors.ts';
import {
  authFlowReducer,
  initialAuthFlow,
  isBusy,
  type AuthFlowEvent,
  type AuthFlowState,
} from './authFlow.ts';

const start = (over: Partial<Extract<AuthFlowEvent, { type: 'start' }>> = {}): AuthFlowEvent => ({
  type: 'start',
  hasToken: false,
  username: 'testuser',
  savedPassword: null,
  remember: true,
  needsHttpConfirm: false,
  ...over,
});

const run = (events: AuthFlowEvent[], from: AuthFlowState = initialAuthFlow()): AuthFlowState =>
  events.reduce(authFlowReducer, from);

const detail = { status: 403, message: undefined, translatableMessage: undefined } as const;
const totp: GuacErrorInfo = {
  kind: 'additional-credentials-required',
  expected: [{ name: 'guac-totp', type: 'GUAC_TOTP_CODE', options: undefined, extra: {} }],
  ...detail,
};
const wrongCode: GuacErrorInfo = {
  kind: 'server-error',
  type: 'BAD_REQUEST',
  status: 400,
  message: 'Verification failed',
  translatableMessage: undefined,
};

describe('authFlowReducer', () => {
  it('tries the stored token first and authenticates without credentials', () => {
    let s = run([start({ hasToken: true, savedPassword: 'pw' })]);
    expect(s.phase).toBe('checking-token');
    expect(isBusy(s)).toBe(true);
    s = authFlowReducer(s, { type: 'token-ok', seq: s.seq });
    expect(s.phase).toBe('authenticated');
  });

  it('falls back to a silent login with the saved password when the token expired', () => {
    let s = run([start({ hasToken: true, savedPassword: 'pw' })]);
    s = authFlowReducer(s, { type: 'token-failed', seq: s.seq, expired: true });
    expect(s).toMatchObject({ phase: 'signing-in', silent: true });
    expect(s.values.password).toBe('pw');
  });

  it('shows the form with an expiry notice when there is no saved password', () => {
    let s = run([start({ hasToken: true })]);
    s = authFlowReducer(s, { type: 'token-failed', seq: s.seq, expired: true });
    expect(s.phase).toBe('form');
    expect(s.phase === 'form' && s.notice).toMatch(/expired/i);
  });

  it('ignores stale results', () => {
    const s = run([start({ hasToken: true })]);
    expect(authFlowReducer(s, { type: 'token-ok', seq: s.seq - 1 })).toBe(s);
    expect(authFlowReducer(s, { type: 'login-ok', seq: s.seq })).toBe(s);
  });

  it('gates every credential submission behind the http confirmation', () => {
    let s = run([start({ needsHttpConfirm: true, savedPassword: 'pw' })]);
    expect(s).toMatchObject({ phase: 'confirm-http', silent: true });
    s = authFlowReducer(s, { type: 'http-cancel' });
    expect(s).toMatchObject({ phase: 'form', step: 'credentials' });
    s = authFlowReducer(s, { type: 'submit', values: { password: 'typed' } });
    expect(s).toMatchObject({ phase: 'confirm-http', silent: false });
    s = authFlowReducer(s, { type: 'http-confirm' });
    expect(s).toMatchObject({ phase: 'signing-in', silent: false });
    expect(s.values.password).toBe('typed');
    expect(s.needsHttpConfirm).toBe(false);
  });

  it('handles TOTP: extra fields, wrong code, then success, resending the password', () => {
    let s = run([start(), { type: 'submit', values: { password: 'pw' } }]);
    s = authFlowReducer(s, { type: 'login-failed', seq: s.seq, error: totp });
    expect(s).toMatchObject({ phase: 'form', step: 'extra' });
    expect(s.expected.map((f) => f.name)).toEqual(['guac-totp']);
    expect(s.phase === 'form' && s.error).toBeFalsy();

    s = authFlowReducer(s, { type: 'submit', values: { extra: { 'guac-totp': '123456' } } });
    expect(s).toMatchObject({ phase: 'signing-in', step: 'extra' });
    expect(s.values).toMatchObject({ password: 'pw', extra: { 'guac-totp': '123456' } });

    s = authFlowReducer(s, { type: 'login-failed', seq: s.seq, error: wrongCode });
    expect(s).toMatchObject({ phase: 'form', step: 'extra' });
    expect(s.phase === 'form' && s.error?.code).toBe('wrong-code');
    expect(s.values.extra).toEqual({});
    expect(s.values.password).toBe('pw');

    s = authFlowReducer(s, { type: 'submit', values: { extra: { 'guac-totp': '654321' } } });
    s = authFlowReducer(s, { type: 'login-ok', seq: s.seq });
    expect(s.phase).toBe('authenticated');
    expect(s.values.extra).toEqual({});
  });

  it('clears the password on invalid credentials and explains a rejected saved password', () => {
    let s = run([start({ savedPassword: 'old' })]);
    expect(s).toMatchObject({ phase: 'signing-in', silent: true });
    s = authFlowReducer(s, {
      type: 'login-failed',
      seq: s.seq,
      error: { kind: 'invalid-credentials', ...detail },
    });
    expect(s).toMatchObject({ phase: 'form', step: 'credentials' });
    expect(s.values.password).toBe('');
    expect(s.phase === 'form' && s.error?.detail).toMatch(/saved password/i);
  });

  it('keeps the step and shows network errors', () => {
    let s = run([start(), { type: 'submit', values: { password: 'pw' } }]);
    s = authFlowReducer(s, {
      type: 'login-failed',
      seq: s.seq,
      error: { kind: 'unreachable', url: 'x', timedOut: false },
    });
    expect(s).toMatchObject({ phase: 'form', step: 'credentials' });
    expect(s.phase === 'form' && s.error?.code).toBe('unreachable');
    expect(s.values.password).toBe('pw');
  });

  it('re-logs in silently once after session expiry, then shows the form', () => {
    let s = run([start({ savedPassword: 'pw' })]);
    s = authFlowReducer(s, { type: 'login-ok', seq: s.seq });
    s = authFlowReducer(s, { type: 'session-expired' });
    expect(s).toMatchObject({ phase: 'signing-in', silent: true });
    s = authFlowReducer(s, { type: 'login-ok', seq: s.seq });
    s = authFlowReducer(s, { type: 'session-expired' });
    expect(s).toMatchObject({ phase: 'form', step: 'credentials' });
  });

  it('forgets a typed password after login when not remembered', () => {
    let s = run([start({ remember: false }), { type: 'submit', values: { password: 'pw' } }]);
    s = authFlowReducer(s, { type: 'login-ok', seq: s.seq });
    expect(s.values.password).toBe('');
    s = authFlowReducer(s, { type: 'session-expired' });
    expect(s.phase).toBe('form');
  });

  it('logout returns to an empty credentials form', () => {
    let s = run([start({ savedPassword: 'pw' })]);
    s = authFlowReducer(s, { type: 'login-ok', seq: s.seq });
    s = authFlowReducer(s, { type: 'logout' });
    expect(s).toMatchObject({ phase: 'form', step: 'credentials' });
    expect(s.values.password).toBe('');
  });

  it('start over leaves the extra step', () => {
    let s = run([start(), { type: 'submit', values: { password: 'pw' } }]);
    s = authFlowReducer(s, { type: 'login-failed', seq: s.seq, error: totp });
    s = authFlowReducer(s, { type: 'start-over' });
    expect(s).toMatchObject({ phase: 'form', step: 'credentials', expected: [] });
  });
});
