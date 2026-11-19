import { describe, expect, it } from 'vitest';
import {
  argumentValues,
  describeRequiredParams,
  humanizeParamName,
  isSecretParam,
} from './requiredParams.ts';

describe('describeRequiredParams', () => {
  it('labels and orders the RDP parameters', () => {
    const fields = describeRequiredParams(['password', 'username', 'domain']);
    expect(fields.map((f) => f.name)).toEqual(['username', 'domain', 'password']);
    expect(fields.map((f) => f.label)).toEqual(['Username', 'Domain', 'Password']);
    expect(fields.map((f) => f.secret)).toEqual([false, false, true]);
    expect(fields[0]?.autocomplete).toBe('username');
    expect(fields[2]?.autocomplete).toBe('current-password');
  });

  it('masks passphrases and private keys, which are multi-line', () => {
    const [pass, key] = describeRequiredParams(['passphrase', 'private-key']);
    expect(pass).toMatchObject({ secret: true, multiline: false });
    expect(key).toMatchObject({ secret: true, multiline: true });
  });

  it('keeps unknown names after the known ones, in server order, with readable labels', () => {
    const fields = describeRequiredParams(['client-name', 'username', 'api_token']);
    expect(fields.map((f) => f.name)).toEqual(['username', 'client-name', 'api_token']);
    expect(fields[1]).toMatchObject({ label: 'Client name', secret: false });
    expect(fields[2]).toMatchObject({ label: 'Api token', secret: true });
  });

  it('drops duplicates and empty names', () => {
    expect(describeRequiredParams(['username', '', 'username']).map((f) => f.name)).toEqual([
      'username',
    ]);
  });
});

describe('helpers', () => {
  it('detects secrets', () => {
    expect(isSecretParam('password')).toBe(true);
    expect(isSecretParam('gateway-password')).toBe(true);
    expect(isSecretParam('my-secret')).toBe(true);
    expect(isSecretParam('username')).toBe(false);
    expect(isSecretParam('domain')).toBe(false);
  });

  it('humanizes names', () => {
    expect(humanizeParamName('font-size')).toBe('Font size');
    expect(humanizeParamName('colorScheme')).toBe('Color scheme');
    expect(humanizeParamName('')).toBe('Value');
  });
});

describe('argumentValues', () => {
  it('answers every requested parameter, empty ones with the empty string', () => {
    const fields = describeRequiredParams(['username', 'password', 'domain']);
    expect(argumentValues(fields, { username: 'user', password: 'p w\n' })).toEqual([
      { name: 'username', value: 'user' },
      { name: 'domain', value: '' },
      { name: 'password', value: 'p w' },
    ]);
  });

  it('keeps newlines in multi-line fields', () => {
    const fields = describeRequiredParams(['private-key']);
    expect(argumentValues(fields, { 'private-key': 'a\nb\n' })).toEqual([
      { name: 'private-key', value: 'a\nb\n' },
    ]);
  });
});
