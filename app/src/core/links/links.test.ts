import { describe, expect, it } from 'vitest';
import type { FieldDescriptor } from '../models/ApiErrorBody.ts';
import { APP_SSO_CALLBACK, extractSsoParam, findSsoRedirect, withAppCallback } from '../sso/sso.ts';
import { buildConnectLink, parseAppLink, parseShareLink } from './links.ts';

describe('app links', () => {
  it('round-trips connect links', () => {
    const link = buildConnectLink('p-1', { dataSource: 'postgresql', identifier: '12', type: 'c' });
    expect(link).toBe('openmobileguac://connect?server=p-1&connection=12&source=postgresql');
    expect(parseAppLink(link)).toEqual({
      kind: 'connect',
      serverId: 'p-1',
      identifier: '12',
      dataSource: 'postgresql',
      type: 'c',
    });
  });

  it('accepts the minimal documented form and balancing groups', () => {
    expect(parseAppLink('openmobileguac://connect?server=a&connection=b')).toMatchObject({
      serverId: 'a',
      identifier: 'b',
      dataSource: undefined,
      type: 'c',
    });
    expect(parseAppLink('openmobileguac://connect?server=a&connection=b&type=g')).toMatchObject({
      type: 'g',
    });
  });

  it('rejects other schemes and incomplete links', () => {
    expect(parseAppLink('https://example.com/connect?server=a&connection=b')).toBeUndefined();
    expect(parseAppLink('openmobileguac://connect?server=a')).toBeUndefined();
    expect(parseAppLink('openmobileguac://other?server=a&connection=b')).toBeUndefined();
    expect(parseAppLink('not a url')).toBeUndefined();
  });

  it('recognises the SSO callback', () => {
    expect(parseAppLink(`${APP_SSO_CALLBACK}#id_token=abc`)).toEqual({
      kind: 'sso-callback',
      url: `${APP_SSO_CALLBACK}#id_token=abc`,
    });
  });
});

describe('share links', () => {
  it('reads the key from the fragment or the query', () => {
    expect(parseShareLink('https://guac.example/guacamole/#/?key=abc123')).toEqual({
      baseUrl: 'https://guac.example/guacamole',
      key: 'abc123',
    });
    expect(parseShareLink('http://guac.example:8080/guacamole/?key=k')).toEqual({
      baseUrl: 'http://guac.example:8080/guacamole',
      key: 'k',
    });
    expect(parseShareLink('https://guac.example/')).toBeUndefined();
  });
});

const redirectField = (name: string, redirectUrl: unknown): FieldDescriptor => ({
  name,
  type: 'REDIRECT',
  options: undefined,
  extra: { redirectUrl },
});

describe('SSO', () => {
  it('finds the redirect field and its kind', () => {
    const r = findSsoRedirect([
      { name: 'username', type: 'USERNAME', options: undefined, extra: {} },
      redirectField(
        'id_token',
        'https://idp.example/auth?redirect_uri=https%3A%2F%2Fguac.example%2Fguacamole%2F&nonce=n',
      ),
    ]);
    expect(r).toMatchObject({ paramName: 'id_token', kind: 'openid' });
    expect(findSsoRedirect([redirectField('ticket', 'javascript:alert(1)')])).toBeUndefined();
    expect(findSsoRedirect([redirectField('ticket', 42)])).toBeUndefined();
  });

  it('extracts the parameter only on the server or the app callback', () => {
    const base = 'https://guac.example/guacamole';
    expect(
      extractSsoParam('https://guac.example/guacamole/#id_token=T1&x=y', base, 'id_token'),
    ).toBe('T1');
    expect(extractSsoParam('https://guac.example/guacamole/#/?state=S', base, 'state')).toBe('S');
    expect(extractSsoParam('https://guac.example/guacamole/?ticket=ST-1', base, 'ticket')).toBe(
      'ST-1',
    );
    expect(extractSsoParam('https://idp.example/cb#id_token=T1', base, 'id_token')).toBeUndefined();
    expect(
      extractSsoParam('https://guac.example/other/#id_token=T1', base, 'id_token'),
    ).toBeUndefined();
    expect(extractSsoParam(`${APP_SSO_CALLBACK}#id_token=T2`, base, 'id_token')).toBe('T2');
    expect(extractSsoParam('https://guac.example/guacamole/', base, 'id_token')).toBeUndefined();
  });

  it('rewrites redirect_uri for the app callback', () => {
    const out = withAppCallback(
      'https://idp.example/auth?client_id=c&redirect_uri=https%3A%2F%2Fg',
    );
    expect(new URL(out ?? '').searchParams.get('redirect_uri')).toBe(APP_SSO_CALLBACK);
    expect(withAppCallback('https://cas.example/login?service=x')).toBeUndefined();
  });
});
