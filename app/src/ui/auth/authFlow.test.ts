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

describe('external sign-in', () => {
  it('moves to authenticated from the form (SSO, share link)', () => {
    let s = authFlowReducer(initialAuthFlow(), {
      type: 'start',
      hasToken: false,
      username: '',
      savedPassword: null,
      remember: false,
      needsHttpConfirm: false,
    });
    expect(s.phase).toBe('form');
    s = authFlowReducer(s, { type: 'external-ok' });
    expect(s.phase).toBe('authenticated');
    expect(s.passwordIsSaved).toBe(false);
    expect(authFlowReducer(s, { type: 'external-ok' })).toBe(s);
  });
});

// ---- Duo, forced password change, server prompt text (verified shapes, 1.6.0) -----------

const field = (name: string, type: string, extra: Record<string, unknown> = {}) => ({
  name,
  type,
  options: undefined,
  extra,
});
const duoStep: GuacErrorInfo = {
  kind: 'additional-credentials-required',
  expected: [
    field('duo_code', 'REDIRECT', {
      redirectUrl: 'https://api-1.duo.example.test/oauth/v1/authorize?request=x',
    }),
  ],
  status: 403,
  message: 'Verification using Duo is required before authentication can continue.',
  translatableMessage: { key: 'LOGIN.INFO_DUO_AUTH_REQUIRED', variables: undefined },
};
const expiredStep: GuacErrorInfo = {
  kind: 'additional-credentials-required',
  expected: [
    field('username', 'USERNAME'),
    field('password', 'PASSWORD'),
    field('new-password', 'PASSWORD'),
    field('confirm-new-password', 'PASSWORD'),
  ],
  status: 403,
  message: 'Password has expired',
  translatableMessage: { key: 'LOGIN.INFO_PASSWORD_EXPIRED', variables: undefined },
};
const totpEnrol: GuacErrorInfo = {
  kind: 'additional-credentials-required',
  expected: [field('guac-totp', 'GUAC_TOTP_CODE', { secret: 'ABC' })],
  status: 403,
  message: 'TOTP enrollment must be completed before authentication can continue',
  translatableMessage: { key: 'TOTP.INFO_ENROLL_REQUIRED', variables: undefined },
};

/** Sign in with a password and get `info` back. */
function afterPassword(info: GuacErrorInfo, password = 'old-pw'): AuthFlowState {
  let s = run([start()]);
  s = authFlowReducer(s, { type: 'submit', values: { username: 'testuser', password } });
  return authFlowReducer(s, { type: 'login-failed', seq: s.seq, error: info });
}

describe('authFlowReducer: Duo', () => {
  it('shows the Duo step and keeps the server prompt', () => {
    const s = afterPassword(duoStep);
    expect(s).toMatchObject({ phase: 'form', step: 'extra' });
    expect(s.prompt?.translatableMessage?.key).toBe('LOGIN.INFO_DUO_AUTH_REQUIRED');
    expect(s.phase === 'form' && s.error).toBeFalsy();
  });

  it('sends duo_code and state with the username and password', () => {
    let s = afterPassword(duoStep);
    s = authFlowReducer(s, { type: 'submit', values: { extra: { duo_code: 'C1', state: 'S1' } } });
    expect(s.phase).toBe('signing-in');
    expect(s.values).toMatchObject({
      username: 'testuser',
      password: 'old-pw',
      extra: { duo_code: 'C1', state: 'S1' },
    });
    s = authFlowReducer(s, { type: 'login-ok', seq: s.seq });
    expect(s.phase).toBe('authenticated');
    // A remembered password survives Duo (unlike the SSO path).
    expect(s.values.password).toBe('old-pw');
    expect(s.passwordIsSaved).toBe(true);
  });

  it('reports a Duo denial (a fresh redirect) and drops the stale duo_code and state', () => {
    let s = afterPassword(duoStep);
    s = authFlowReducer(s, { type: 'submit', values: { extra: { duo_code: 'C1', state: 'S1' } } });
    s = authFlowReducer(s, { type: 'login-failed', seq: s.seq, error: duoStep });
    expect(s).toMatchObject({ phase: 'form', step: 'extra' });
    expect(s.phase === 'form' && s.error?.code).toBe('duo-failed');
    expect(s.values.extra).toEqual({});
  });
});

describe('authFlowReducer: forced password change', () => {
  it('shows the new-password step with the explanation from the server', () => {
    const s = afterPassword(expiredStep);
    expect(s).toMatchObject({ phase: 'form', step: 'extra' });
    expect(s.prompt).toEqual({
      message: 'Password has expired',
      translatableMessage: { key: 'LOGIN.INFO_PASSWORD_EXPIRED', variables: undefined },
    });
  });

  it('shows a policy refusal as "new password not accepted" with the server text', () => {
    let s = afterPassword(expiredStep);
    s = authFlowReducer(s, {
      type: 'submit',
      values: { extra: { 'new-password': 'ab1', 'confirm-new-password': 'ab1' } },
    });
    s = authFlowReducer(s, {
      type: 'login-failed',
      seq: s.seq,
      error: {
        kind: 'server-error',
        type: 'BAD_REQUEST',
        status: 400,
        message: 'Password does not meet minimum length requirements.',
        translatableMessage: { key: 'PASSWORD_POLICY.ERROR_TOO_SHORT', variables: { LENGTH: 10 } },
      },
    });
    expect(s).toMatchObject({ phase: 'form', step: 'extra' });
    if (s.phase !== 'form') throw new Error('form');
    expect(s.error?.code).toBe('password-rejected');
    expect(s.serverError?.translatableMessage?.key).toBe('PASSWORD_POLICY.ERROR_TOO_SHORT');
    // Still the old password: nothing was changed on the server.
    expect(s.values.password).toBe('old-pw');
    expect(s.values.extra).toEqual({});
  });

  it('uses the new password once the server moved on to TOTP (it already stored it)', () => {
    // Verified on 1.6.0: after the reset request returns the TOTP step, the old password
    // is refused (INVALID_CREDENTIALS) and the new one works.
    let s = afterPassword(expiredStep);
    s = authFlowReducer(s, {
      type: 'submit',
      values: { extra: { 'new-password': 'New-pw-12345', 'confirm-new-password': 'New-pw-12345' } },
    });
    s = authFlowReducer(s, { type: 'login-failed', seq: s.seq, error: totpEnrol });
    expect(s).toMatchObject({ phase: 'form', step: 'extra' });
    expect(s.phase === 'form' && s.error).toBeFalsy(); // a new step, not a wrong code
    expect(s.values.password).toBe('New-pw-12345');
    expect(s.values.extra).toEqual({});
    expect(s.prompt?.translatableMessage?.key).toBe('TOTP.INFO_ENROLL_REQUIRED');
    s = authFlowReducer(s, { type: 'submit', values: { extra: { 'guac-totp': '123456' } } });
    expect(s.values).toMatchObject({ password: 'New-pw-12345', extra: { 'guac-totp': '123456' } });
    s = authFlowReducer(s, { type: 'login-ok', seq: s.seq });
    expect(s.values.password).toBe('New-pw-12345');
  });

  it('keeps the new password when the reset is the last step', () => {
    let s = afterPassword(expiredStep);
    s = authFlowReducer(s, {
      type: 'submit',
      values: { extra: { 'new-password': 'New-pw-12345', 'confirm-new-password': 'New-pw-12345' } },
    });
    s = authFlowReducer(s, { type: 'login-ok', seq: s.seq });
    expect(s.phase).toBe('authenticated');
    expect(s.values.password).toBe('New-pw-12345');
    expect(s.passwordIsSaved).toBe(true);
  });

  it('follows a password changed in the app', () => {
    let s = run([start({ savedPassword: 'pw' })]);
    s = authFlowReducer(s, { type: 'login-ok', seq: s.seq });
    s = authFlowReducer(s, { type: 'password-changed', password: 'pw2' });
    expect(s.values.password).toBe('pw2');
  });
});

describe('authFlowReducer: Duo combined with a forced password change', () => {
  it('keeps the old password when Duo follows the reset request (Duo may run first)', () => {
    let s = afterPassword(expiredStep);
    s = authFlowReducer(s, {
      type: 'submit',
      values: { extra: { 'new-password': 'New-pw-12345', 'confirm-new-password': 'New-pw-12345' } },
    });
    s = authFlowReducer(s, { type: 'login-failed', seq: s.seq, error: duoStep });
    expect(s.values.password).toBe('old-pw');
    expect(s.values.extra).toMatchObject({ 'new-password': 'New-pw-12345' });
  });

  it('drops duo_code and state once the Duo step is passed', () => {
    let s = afterPassword(duoStep);
    s = authFlowReducer(s, { type: 'submit', values: { extra: { duo_code: 'C1', state: 'S1' } } });
    s = authFlowReducer(s, { type: 'login-failed', seq: s.seq, error: expiredStep });
    expect(s.values.extra).toEqual({});
    expect(s.phase === 'form' && s.error).toBeFalsy();
  });
});

describe('start after a background sign-out', () => {
  it('shows the form with the notice, and no notice when signing in silently', () => {
    const s = authFlowReducer(initialAuthFlow(), start({ notice: 'Signed out' }));
    expect(s).toMatchObject({ phase: 'form', step: 'credentials', notice: 'Signed out' });
    const silent = authFlowReducer(initialAuthFlow(), start({ savedPassword: 'pw', notice: 'x' }));
    expect(silent.phase).toBe('signing-in');
  });
});
