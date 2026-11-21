import { describe, expect, it } from 'vitest';
import { formatServerMessage, loginFieldLabel, serverMessageText } from './serverText.ts';

// Entries as a 1.6.0 server with the database extension serves them in translations/en.json.
const table = {
  APP: { ERROR_PASSWORD_BLANK: 'Your password cannot be blank.' },
  LOGIN: {
    ERROR_PASSWORD_BLANK: '@:APP.ERROR_PASSWORD_BLANK',
    INFO_PASSWORD_EXPIRED:
      'Your password has expired and must be reset. Please enter a new password to continue.',
    FIELD_HEADER_NEW_PASSWORD: 'New password',
  },
  PASSWORD_POLICY: {
    ERROR_TOO_SHORT:
      'Passwords must be at least {LENGTH} {LENGTH, plural, one{character} other{characters}} long.',
    ERROR_REUSED:
      'This password has already been used. Please do not reuse any of the previous {HISTORY_SIZE} {HISTORY_SIZE, plural, one{password} other{passwords}}.',
  },
};

describe('formatServerMessage', () => {
  it('fills simple and plural placeholders', () => {
    const t = table.PASSWORD_POLICY.ERROR_TOO_SHORT;
    expect(formatServerMessage(t, { LENGTH: 10 })).toBe(
      'Passwords must be at least 10 characters long.',
    );
    expect(formatServerMessage(t, { LENGTH: 1 })).toBe(
      'Passwords must be at least 1 character long.',
    );
    expect(formatServerMessage('{N, plural, =0{none} other{# left}}', { N: 0 })).toBe('none');
    expect(formatServerMessage('{N, plural, =0{none} other{# left}}', { N: 3 })).toBe('3 left');
  });

  it('gives up on missing variables so the English message is used', () => {
    expect(formatServerMessage(table.PASSWORD_POLICY.ERROR_TOO_SHORT, undefined)).toBeUndefined();
    expect(formatServerMessage('{X, select, a{b}}', { X: 'a' })).toBeUndefined();
  });
});

describe('serverMessageText', () => {
  it('translates the key, following links', () => {
    expect(
      serverMessageText(
        {
          message: 'Password has expired',
          translatableMessage: { key: 'LOGIN.INFO_PASSWORD_EXPIRED', variables: undefined },
        },
        table,
      ),
    ).toMatch(/^Your password has expired/);
    expect(
      serverMessageText(
        {
          message: 'Passwords may not be blank.',
          translatableMessage: { key: 'LOGIN.ERROR_PASSWORD_BLANK', variables: undefined },
        },
        table,
      ),
    ).toBe('Your password cannot be blank.');
  });

  it('falls back to the server message without a table or key', () => {
    const text = {
      message: 'Verification using Duo is required before authentication can continue.',
      translatableMessage: { key: 'LOGIN.INFO_DUO_AUTH_REQUIRED', variables: undefined },
    };
    expect(serverMessageText(text, null)).toBe(text.message);
    expect(serverMessageText(text, table)).toBe(text.message);
    expect(serverMessageText(undefined, table)).toBeUndefined();
  });
});

describe('loginFieldLabel', () => {
  it('uses LOGIN.FIELD_HEADER_<NAME>, then the app label, then the name', () => {
    expect(loginFieldLabel('new-password', table)).toBe('New password');
    expect(loginFieldLabel('confirm-new-password', table)).toBe('Confirm new password');
    expect(loginFieldLabel('guac-radius-reply', null)).toBe('Radius reply');
  });
});
