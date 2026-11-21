import { describe, expect, it } from 'vitest';
import { parseApiErrorBody, type FieldDescriptor } from '../models/ApiErrorBody.ts';
import {
  APP_SSO_CALLBACK,
  expectedReturnTargets,
  extractCallbackParam,
  extractReturnParams,
  findDuoRedirect,
  findSsoRedirect,
  returnParamNames,
  ssoProvidersFromPatches,
  withAppCallback,
} from './sso.ts';

const BASE = 'https://guac.example.test/guacamole';

/** A JWT with this payload (unsigned: only the payload is read). */
function jwt(payload: object): string {
  const b64 = (o: object) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS512', typ: 'JWT' })}.${b64(payload)}.c2ln`;
}

/**
 * Duo Universal Prompt URL as duo-universal-sdk 1.3.1 `Client.createAuthUrl` builds it:
 * `?scope=openid&response_type=code&redirect_uri=<raw>&client_id=…&request=<JWT>` (the
 * redirect URI is not URL-encoded by the SDK).
 */
const DUO_URL =
  'https://api-1234.duo.example.test/oauth/v1/authorize?scope=openid&response_type=code' +
  `&redirect_uri=${BASE}/&client_id=DIXXXXXXXXXXXXXXXXXX&request=` +
  jwt({ redirect_uri: `${BASE}/`, state: 'S'.repeat(36), duo_uname: 'testuser' });

/**
 * The 403 body guacamole-auth-duo 1.6.0 sends after a correct password
 * (`UserVerificationService.verifyAuthenticatedUser`: a
 * `TranslatableGuacamoleInsufficientCredentialsException` with one `RedirectField`).
 */
const duoBody = {
  message: 'Verification using Duo is required before authentication can continue.',
  translatableMessage: { key: 'LOGIN.INFO_DUO_AUTH_REQUIRED', variables: null },
  statusCode: null,
  expected: [
    {
      name: 'duo_code',
      type: 'REDIRECT',
      redirectUrl: DUO_URL,
      redirectMessage: { key: 'LOGIN.INFO_DUO_REDIRECT_PENDING', variables: null },
    },
  ],
  type: 'INSUFFICIENT_CREDENTIALS',
};

function expectedOf(body: unknown): readonly FieldDescriptor[] {
  return parseApiErrorBody(body)?.expected ?? [];
}

describe('Duo (guacamole-auth-duo 1.6.0)', () => {
  it('is found as Duo, not as a sign-in provider', () => {
    const expected = expectedOf(duoBody);
    expect(findSsoRedirect(expected)).toBeUndefined();
    expect(findDuoRedirect(expected)).toEqual({
      paramName: 'duo_code',
      redirectUrl: DUO_URL,
      kind: 'duo',
    });
  });

  it('needs both duo_code and state back', () => {
    const duo = findDuoRedirect(expectedOf(duoBody));
    if (!duo) throw new Error('no duo');
    expect(returnParamNames(duo)).toEqual(['duo_code', 'state']);
    const targets = expectedReturnTargets(duo, BASE);
    // Duo returns to `duo-redirect-uri` with `?duo_code=…&state=…` (the web client's
    // relocateParameters.js then moves them behind `#/?`, both forms are accepted).
    expect(
      extractReturnParams(`${BASE}/?duo_code=C1&state=S1`, targets, ['duo_code', 'state']),
    ).toEqual({ duo_code: 'C1', state: 'S1' });
    expect(
      extractReturnParams(`${BASE}/#/?duo_code=C1&state=S1`, targets, ['duo_code', 'state']),
    ).toEqual({ duo_code: 'C1', state: 'S1' });
    // Only one of them: keep waiting.
    expect(
      extractReturnParams(`${BASE}/?duo_code=C1`, targets, ['duo_code', 'state']),
    ).toBeUndefined();
  });

  it('accepts the return address from the Duo request when it differs from the app’s address', () => {
    const other = 'https://remote.example.test/guac/';
    const url =
      'https://api-1234.duo.example.test/oauth/v1/authorize?scope=openid&response_type=code' +
      `&client_id=X&request=${jwt({ redirect_uri: other, state: 'S' })}`;
    const targets = expectedReturnTargets(
      { paramName: 'duo_code', redirectUrl: url, kind: 'duo' },
      BASE,
    );
    expect(targets).toEqual([BASE, other]);
    expect(
      extractReturnParams(`${other}?duo_code=C&state=S`, targets, ['duo_code', 'state']),
    ).toEqual({ duo_code: 'C', state: 'S' });
    // Anything else (the Duo page itself, another site) is ignored.
    expect(
      extractReturnParams(`https://api-1234.duo.example.test/frame?duo_code=C&state=S`, targets, [
        'duo_code',
        'state',
      ]),
    ).toBeUndefined();
  });
});

describe('SSO providers from api/patches', () => {
  // Abridged from a 1.6.0 server with the database and OpenID extensions.
  const patches = [
    '<meta name="after-children" content=".home-connection">\n<span class="jdbc-share-tag"></span>\n',
    '<meta name="after" content=".login-ui .login-dialog-middle:not(:has(~ .sso-providers))">\n<div class="sso-providers">\n    {{ \'LOGIN.SECTION_HEADER_SSO_OPTIONS\' | translate }}\n    <ul class="sso-provider-list"></ul>\n</div>\n',
    '<meta name="after-children" content=".login-ui .sso-provider-list">\n<li class="sso-provider sso-provider-openid"><a href="api/ext/openid/login">{{\n    \'LOGIN.NAME_IDP_OPENID\' | translate\n}}</a></li>\n',
  ];

  it('lists the OpenID provider with its login link', () => {
    expect(ssoProvidersFromPatches(patches, `${BASE}/`)).toEqual([
      { paramName: 'id_token', redirectUrl: `${BASE}/api/ext/openid/login`, kind: 'openid' },
    ]);
  });

  it('lists several providers once each and skips the certificate provider', () => {
    const li = (n: string) =>
      `<li class="sso-provider sso-provider-${n}"><a href="api/ext/${n}/login">x</a></li>`;
    const found = ssoProvidersFromPatches([li('saml'), li('ssl'), li('cas'), li('saml')], BASE);
    expect(found.map((f) => [f.kind, f.paramName])).toEqual([
      ['saml', 'state'],
      ['cas', 'ticket'],
    ]);
  });

  it('ignores anything that is not an array of strings', () => {
    expect(ssoProvidersFromPatches({ x: 1 }, BASE)).toEqual([]);
    expect(ssoProvidersFromPatches([42, null], BASE)).toEqual([]);
  });
});

describe('OpenID return URLs (shapes seen from Keycloak 26 and Guacamole 1.6.0)', () => {
  const idp =
    'https://idp.example.test/realms/lab/protocol/openid-connect/auth?scope=openid+email+profile' +
    `&response_type=id_token&client_id=guacamole&redirect_uri=${encodeURIComponent(`${BASE}/`)}&nonce=n1`;
  const redirect = { paramName: 'id_token', redirectUrl: idp, kind: 'openid' as const };

  it('takes the token from the fragment Keycloak appends to redirect_uri', () => {
    const back = `${BASE}/#session_state=x&iss=https%3A%2F%2Fidp.example.test%2Frealms%2Flab&id_token=T1`;
    expect(extractReturnParams(back, expectedReturnTargets(redirect, BASE), ['id_token'])).toEqual({
      id_token: 'T1',
    });
  });

  it('accepts redirect_uri on another host the server is configured with', () => {
    const r = {
      ...redirect,
      redirectUrl: idp.replace(
        encodeURIComponent(`${BASE}/`),
        encodeURIComponent('https://alt.example.test/g/'),
      ),
    };
    const targets = expectedReturnTargets(r, BASE);
    expect(
      extractReturnParams('https://alt.example.test/g/#id_token=T', targets, ['id_token']),
    ).toEqual({
      id_token: 'T',
    });
  });

  it('reads the app callback in the form Keycloak sends it', () => {
    const url = withAppCallback(idp, 'abc123');
    expect(url && new URL(url).searchParams.get('redirect_uri')).toBe(APP_SSO_CALLBACK);
    // Keycloak 26 returned exactly this shape (note the `/` after the host).
    const cb = `${APP_SSO_CALLBACK}/#state=abc123&session_state=s&iss=x&id_token=T2`;
    expect(extractCallbackParam(cb, 'id_token', 'abc123')).toBe('T2');
    expect(extractCallbackParam(cb, 'id_token', 'other')).toBeUndefined();
    // The app callback is never taken by the web-view check.
    expect(extractReturnParams(cb, [BASE], ['id_token'])).toBeUndefined();
  });
});
