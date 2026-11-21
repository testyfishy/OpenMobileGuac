import { describe, expect, it } from 'vitest';
import { HttpTransportError, type HttpRequest } from '../http/HttpClient.ts';
import type { AuthSession } from '../models/AuthSession.ts';
import { FakeHttpClient, jsonResponse, textResponse } from '../testing/FakeHttpClient.ts';
import {
  BASE_URL,
  authResultJson,
  invalidCredentialsJson,
  languagesJson,
  notFoundJson,
  permissionDeniedJson,
  sharedTreeJson,
  totpEnrollJson,
  totpRequiredJson,
  totpWrongCodeJson,
  treeJson,
} from '../testing/fixtures.ts';
import { GuacApiError, isGuacApiError, type GuacErrorInfo } from './errors.ts';
import { GuacApi, TOKEN_HEADER } from './GuacApi.ts';
import { parseShareLink } from '../links/links.ts';

const profile = { baseUrl: BASE_URL };
const creds = { username: 'testuser', password: 'pw & =?' };
const TOKENS = `${BASE_URL}/api/tokens`;

const session: AuthSession = {
  baseUrl: BASE_URL,
  token: authResultJson.authToken,
  username: 'testuser',
  primaryDataSource: 'postgresql',
  dataSources: ['postgresql', 'postgresql-shared'],
};

async function errorInfo(p: Promise<unknown>): Promise<GuacErrorInfo> {
  try {
    await p;
  } catch (err) {
    if (err instanceof GuacApiError) return err.info;
    throw err;
  }
  throw new Error('expected rejection');
}

function formFields(req: HttpRequest | undefined): Record<string, unknown> {
  if (req?.body?.kind !== 'form') throw new Error('expected a form body');
  return { ...req.body.fields };
}

describe('GuacApi.login', () => {
  it('posts a form to api/tokens and returns the session', async () => {
    const http = new FakeHttpClient().on('POST', TOKENS, () => jsonResponse(200, authResultJson));
    const result = await new GuacApi(http).login(profile, creds);

    expect(result).toEqual(session);
    expect(http.requests).toHaveLength(1);
    expect(http.requests[0]?.method).toBe('POST');
    expect(formFields(http.requests[0])).toEqual({ username: 'testuser', password: 'pw & =?' });
    expect(http.requests[0]?.headers?.[TOKEN_HEADER]).toBeUndefined();
  });

  it('rejects a redirect as redirected instead of following it with the password', async () => {
    for (const status of [301, 302, 307, 308, 0]) {
      const http = new FakeHttpClient().on('POST', TOKENS, () => ({
        status,
        headers: (status === 0 ? {} : { location: 'https://gateway.example/login' }) as Record<
          string,
          string
        >,
        body: null,
      }));
      const info = await errorInfo(new GuacApi(http).login(profile, creds));
      expect(info).toEqual({
        kind: 'redirected',
        url: TOKENS,
        location: status === 0 ? undefined : 'https://gateway.example/login',
      });
      expect(http.requests).toHaveLength(1);
    }
  });

  it('maps INVALID_CREDENTIALS (403) to invalid-credentials', async () => {
    const http = new FakeHttpClient().on('POST', TOKENS, () =>
      jsonResponse(403, invalidCredentialsJson),
    );
    const info = await errorInfo(new GuacApi(http).login(profile, creds));
    expect(info).toMatchObject({
      kind: 'invalid-credentials',
      status: 403,
      translatableMessage: { key: 'APP.TEXT_UNTRANSLATED' },
    });
  });

  it('supports the TOTP flow: additional credentials, then resubmission with all fields', async () => {
    const http = new FakeHttpClient().on('POST', TOKENS, (req) => {
      const fields = formFields(req);
      if (fields['guac-totp'] === undefined) return jsonResponse(403, totpRequiredJson);
      if (fields['guac-totp'] !== '123456') return jsonResponse(400, totpWrongCodeJson);
      return jsonResponse(200, authResultJson);
    });
    const api = new GuacApi(http);

    const first = await errorInfo(api.login(profile, creds));
    expect(first.kind).toBe('additional-credentials-required');
    if (first.kind !== 'additional-credentials-required') return;
    expect(first.expected.map((f) => [f.name, f.type])).toEqual([['guac-totp', 'GUAC_TOTP_CODE']]);
    expect(first.translatableMessage?.key).toBe('TOTP.INFO_CODE_REQUIRED');

    const wrong = await errorInfo(api.login(profile, creds, { 'guac-totp': '000000' }));
    expect(wrong).toMatchObject({ kind: 'server-error', type: 'BAD_REQUEST', status: 400 });

    const ok = await api.login(profile, creds, { 'guac-totp': '123456' });
    expect(ok.token).toBe(authResultJson.authToken);
    expect(formFields(http.requests[2])).toEqual({
      'guac-totp': '123456',
      username: 'testuser',
      password: 'pw & =?',
    });
  });

  it('passes TOTP enrolment details through', async () => {
    const http = new FakeHttpClient().on('POST', TOKENS, () => jsonResponse(403, totpEnrollJson));
    const info = await errorInfo(new GuacApi(http).login(profile, creds));
    expect(
      info.kind === 'additional-credentials-required' && info.expected[0]?.extra['qrCode'],
    ).toBe('data:image/png;base64,AAAA');
  });

  it('does not let extra fields override the credentials', async () => {
    const http = new FakeHttpClient().on('POST', TOKENS, () => jsonResponse(200, authResultJson));
    await new GuacApi(http).login(profile, creds, { username: 'other' });
    expect(formFields(http.requests[0])['username']).toBe('testuser');
  });

  it('reports a non-Guacamole answer as not-guacamole', async () => {
    const html = new FakeHttpClient().on('POST', TOKENS, () =>
      textResponse(200, '<html>login</html>'),
    );
    expect((await errorInfo(new GuacApi(html).login(profile, creds))).kind).toBe('not-guacamole');

    const notFound = new FakeHttpClient().on('POST', TOKENS, () => textResponse(404, 'Not Found'));
    expect(await errorInfo(new GuacApi(notFound).login(profile, creds))).toEqual({
      kind: 'not-guacamole',
      url: BASE_URL,
      status: 404,
    });

    const wrongJson = new FakeHttpClient().on('POST', TOKENS, () =>
      jsonResponse(200, { ok: true }),
    );
    expect((await errorInfo(new GuacApi(wrongJson).login(profile, creds))).kind).toBe(
      'not-guacamole',
    );
  });

  it('maps transport errors to unreachable / tls', async () => {
    const down = new FakeHttpClient().on('POST', TOKENS, (req) => {
      throw new HttpTransportError('unreachable', req.url, 'Failed to fetch');
    });
    expect(await errorInfo(new GuacApi(down).login(profile, creds))).toEqual({
      kind: 'unreachable',
      url: TOKENS,
      timedOut: false,
    });

    const slow = new FakeHttpClient().on('POST', TOKENS, (req) => {
      throw new HttpTransportError('timeout', req.url, 'timeout');
    });
    expect(await errorInfo(new GuacApi(slow).login(profile, creds))).toMatchObject({
      timedOut: true,
    });

    const tls = new FakeHttpClient().on('POST', TOKENS, (req) => {
      throw new HttpTransportError('tls', req.url, 'certificate not trusted');
    });
    expect((await errorInfo(new GuacApi(tls).login(profile, creds))).kind).toBe('tls');
  });

  it('passes the configured timeout', async () => {
    const http = new FakeHttpClient().on('POST', TOKENS, () => jsonResponse(200, authResultJson));
    await new GuacApi(http, { timeoutMs: 1234 }).login(profile, creds);
    expect(http.requests[0]?.timeoutMs).toBe(1234);
  });

  it('maps INTERNAL_ERROR to server-error', async () => {
    const http = new FakeHttpClient().on('POST', TOKENS, () =>
      jsonResponse(500, { type: 'INTERNAL_ERROR', message: 'Unexpected internal error' }),
    );
    expect(await errorInfo(new GuacApi(http).login(profile, creds))).toMatchObject({
      kind: 'server-error',
      type: 'INTERNAL_ERROR',
      message: 'Unexpected internal error',
    });
  });
});

describe('GuacApi.resumeSession', () => {
  it('re-validates a stored token', async () => {
    const http = new FakeHttpClient().on('POST', TOKENS, () => jsonResponse(200, authResultJson));
    const s = await new GuacApi(http).resumeSession(profile, authResultJson.authToken);
    expect(s.token).toBe(authResultJson.authToken);
    expect(formFields(http.requests[0])).toEqual({ token: authResultJson.authToken });
  });

  it('reports an expired token as session-expired', async () => {
    const http = new FakeHttpClient().on('POST', TOKENS, () =>
      jsonResponse(403, invalidCredentialsJson),
    );
    expect((await errorInfo(new GuacApi(http).resumeSession(profile, 'stale'))).kind).toBe(
      'session-expired',
    );
  });

  it('treats a different (for example anonymous) token as session-expired and revokes it', async () => {
    const http = new FakeHttpClient()
      .on('POST', TOKENS, () =>
        jsonResponse(200, { ...authResultJson, authToken: 'NEW', username: '' }),
      )
      .on('DELETE', `${BASE_URL}/api/session`, () => ({ status: 204, headers: {}, body: null }));
    expect((await errorInfo(new GuacApi(http).resumeSession(profile, 'stale'))).kind).toBe(
      'session-expired',
    );
    expect(http.requests[1]?.headers?.[TOKEN_HEADER]).toBe('NEW');
  });
});

describe('GuacApi.getConnectionTree', () => {
  const treeUrl = (ds: string): string =>
    `${BASE_URL}/api/session/data/${ds}/connectionGroups/ROOT/tree`;

  it('fetches every data source with the token header, in session order', async () => {
    const http = new FakeHttpClient()
      .on('GET', treeUrl('postgresql'), () => jsonResponse(200, treeJson))
      .on('GET', treeUrl('postgresql-shared'), () => jsonResponse(200, sharedTreeJson));
    const tree = await new GuacApi(http).getConnectionTree(session);

    expect(tree.dataSources.map((d) => d.dataSource)).toEqual(['postgresql', 'postgresql-shared']);
    expect(tree.dataSources[1]?.root.childConnections[0]?.dataSource).toBe('postgresql-shared');
    for (const req of http.requests) {
      expect(req.headers?.[TOKEN_HEADER]).toBe(authResultJson.authToken);
      expect(req.url).not.toContain('token=');
    }
  });

  it('URL-encodes data source names', async () => {
    const http = new FakeHttpClient().on(
      'GET',
      () => true,
      () => jsonResponse(200, sharedTreeJson),
    );
    await new GuacApi(http).getConnectionTree({ ...session, dataSources: ['a b/c'] });
    expect(http.requests[0]?.url).toBe(
      `${BASE_URL}/api/session/data/a%20b%2Fc/connectionGroups/ROOT/tree`,
    );
  });

  it('skips a data source that answers NOT_FOUND', async () => {
    const http = new FakeHttpClient()
      .on('GET', treeUrl('postgresql'), () => jsonResponse(200, treeJson))
      .on('GET', treeUrl('postgresql-shared'), () => jsonResponse(404, notFoundJson));
    const tree = await new GuacApi(http).getConnectionTree(session);
    expect(tree.dataSources.map((d) => d.dataSource)).toEqual(['postgresql']);
  });

  it('shows the data sources that loaded when another one fails, and lists it', async () => {
    const http = new FakeHttpClient()
      .on('GET', treeUrl('postgresql'), () => jsonResponse(200, treeJson))
      .on('GET', treeUrl('postgresql-shared'), () => {
        throw new HttpTransportError('timeout', treeUrl('postgresql-shared'), 'slow');
      });
    const tree = await new GuacApi(http).getConnectionTree(session);
    expect(tree.dataSources.map((d) => d.dataSource)).toEqual(['postgresql']);
    expect(tree.unavailable).toEqual(['postgresql-shared']);
  });

  it('does not wait long for a slow data source once one has answered', async () => {
    const http = new FakeHttpClient()
      .on('GET', treeUrl('postgresql'), () => jsonResponse(200, treeJson))
      .on('GET', treeUrl('postgresql-shared'), () => new Promise<never>(() => undefined));
    const tree = await new GuacApi(http).getConnectionTree(session, { secondaryGraceMs: 10 });
    expect(tree.dataSources.map((d) => d.dataSource)).toEqual(['postgresql']);
    expect(tree.unavailable).toEqual(['postgresql-shared']);
  });

  it('still fails when every data source failed, and on any expired sign-in', async () => {
    const down = new FakeHttpClient().on(
      'GET',
      () => true,
      () => {
        throw new HttpTransportError('unreachable', BASE_URL, 'down');
      },
    );
    const info = await errorInfo(new GuacApi(down).getConnectionTree(session));
    expect(info.kind).toBe('unreachable');
    const mixed = new FakeHttpClient()
      .on('GET', treeUrl('postgresql'), () => jsonResponse(200, treeJson))
      .on('GET', treeUrl('postgresql-shared'), () => jsonResponse(403, permissionDeniedJson));
    const err = await new GuacApi(mixed).getConnectionTree(session).catch((e: unknown) => e);
    expect(isGuacApiError(err, 'session-expired')).toBe(true);
  });

  it('reports an expired token (PERMISSION_DENIED) as session-expired', async () => {
    const http = new FakeHttpClient().on(
      'GET',
      () => true,
      () => jsonResponse(403, permissionDeniedJson),
    );
    const err = await new GuacApi(http).getConnectionTree(session).catch((e: unknown) => e);
    expect(isGuacApiError(err, 'session-expired')).toBe(true);
  });

  it('reports a malformed tree as invalid-response with the field path', async () => {
    const http = new FakeHttpClient().on(
      'GET',
      () => true,
      () => jsonResponse(200, { identifier: 'ROOT', childConnections: [{ name: 'x' }] }),
    );
    const info = await errorInfo(new GuacApi(http).getConnectionTree(session));
    expect(info.kind).toBe('invalid-response');
    expect(info.kind === 'invalid-response' && info.detail).toContain(
      'childConnections[0].identifier',
    );
  });
});

describe('GuacApi.logout / isSessionValid', () => {
  const sessionUrl = `${BASE_URL}/api/session`;

  it('DELETEs api/session with the token header', async () => {
    const http = new FakeHttpClient().on('DELETE', sessionUrl, () => ({
      status: 204,
      headers: {},
      body: null,
    }));
    await new GuacApi(http).logout(session);
    expect(http.requests[0]?.headers?.[TOKEN_HEADER]).toBe(session.token);
  });

  it('treats an already-invalid token as logged out', async () => {
    const http = new FakeHttpClient().on('DELETE', sessionUrl, () =>
      jsonResponse(403, permissionDeniedJson),
    );
    await expect(new GuacApi(http).logout(session)).resolves.toBeUndefined();
  });

  it('checks validity with HEAD api/session', async () => {
    let valid = true;
    const http = new FakeHttpClient().on('HEAD', sessionUrl, () => ({
      status: valid ? 204 : 403,
      headers: {},
      body: null,
    }));
    const api = new GuacApi(http);
    expect(await api.isSessionValid(session)).toBe(true);
    valid = false;
    expect(await api.isSessionValid(session)).toBe(false);
  });

  it('falls back to POST api/tokens on a pre-1.6.0 server that has no HEAD api/session', async () => {
    let tokenValid = true;
    const http = new FakeHttpClient()
      // guacamole-client 1.5.x: SessionResource has no @HEAD, so a valid token gets 405.
      .on('HEAD', sessionUrl, () => ({ status: 405, headers: {}, body: null }))
      .on('POST', TOKENS, () =>
        tokenValid ? jsonResponse(200, authResultJson) : jsonResponse(403, invalidCredentialsJson),
      );
    const api = new GuacApi(http);
    expect(await api.isSessionValid(session)).toBe(true);
    expect(formFields(http.requests[1])).toEqual({ token: session.token });
    tokenValid = false;
    expect(await api.isSessionValid(session)).toBe(false);
  });

  it('does not ask POST api/tokens when HEAD api/session refuses the token', async () => {
    const http = new FakeHttpClient().on('HEAD', sessionUrl, () =>
      jsonResponse(403, permissionDeniedJson),
    );
    expect(await new GuacApi(http).isSessionValid(session)).toBe(false);
    expect(http.requests).toHaveLength(1);
  });
});

describe('GuacApi.probe', () => {
  it('returns the first candidate that serves api/languages, without sending credentials', async () => {
    const http = new FakeHttpClient()
      .on(
        'GET',
        () => true,
        () => textResponse(404, 'Not Found'),
      )
      .on('GET', 'https://guac.example/api/languages', () => jsonResponse(200, languagesJson));
    const found = await new GuacApi(http).probe('guac.example');
    expect(found).toEqual({ baseUrl: 'https://guac.example', secure: true });
    expect(http.requests.map((r) => r.url)).toEqual([
      'https://guac.example/guacamole/api/languages',
      'https://guac.example/api/languages',
    ]);
    expect(http.requests.every((r) => r.method === 'GET' && r.body === undefined)).toBe(true);
  });

  it('prefers tls over not-guacamole over unreachable when all candidates fail', async () => {
    const http = new FakeHttpClient().on(
      'GET',
      () => true,
      (req) => {
        if (req.url.startsWith('https://'))
          throw new HttpTransportError('tls', req.url, 'handshake');
        if (req.url.includes('/guacamole/')) return textResponse(200, '<html></html>');
        throw new HttpTransportError('unreachable', req.url, 'refused');
      },
    );
    expect(
      (await errorInfo(new GuacApi(http).probe('guac.example', { allowHttp: true }))).kind,
    ).toBe('tls');

    const http2 = new FakeHttpClient().on(
      'GET',
      () => true,
      (req) => {
        if (req.url.includes('/guacamole/')) return textResponse(200, '<html></html>');
        throw new HttpTransportError('unreachable', req.url, 'refused');
      },
    );
    expect(
      (await errorInfo(new GuacApi(http2).probe('guac.example', { allowHttp: true }))).kind,
    ).toBe('not-guacamole');

    const http3 = new FakeHttpClient().on(
      'GET',
      () => true,
      (req) => {
        throw new HttpTransportError('unreachable', req.url, 'refused');
      },
    );
    expect(
      (await errorInfo(new GuacApi(http3).probe('guac.example', { allowHttp: true }))).kind,
    ).toBe('unreachable');
  });

  it('never falls back to http on its own when https fails (AUDIT #11)', async () => {
    const http = new FakeHttpClient().on(
      'GET',
      () => true,
      (req) => {
        if (req.url.startsWith('https://')) throw new HttpTransportError('tls', req.url, 'cert');
        return jsonResponse(200, languagesJson);
      },
    );
    const err = await new GuacApi(http).probe('guac.example:8443').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GuacApiError);
    expect((err as GuacApiError).info.kind).toBe('tls');
    expect((err as GuacApiError).httpFallbackAvailable).toBe(true);
    expect(http.requests.every((r) => r.url.startsWith('https://'))).toBe(true);
    // Only after the user's explicit choice.
    const found = await new GuacApi(http).probe('guac.example:8443', { allowHttp: true });
    expect(found).toEqual({ baseUrl: 'http://guac.example:8443/guacamole', secure: false });
    // A typed http:// is the user's choice already; no fallback flag needed.
    const typed = await new GuacApi(http).probe('http://guac.example:8443');
    expect(typed.secure).toBe(false);
  });

  it('follows a same-origin redirect during the probe only', async () => {
    const http = new FakeHttpClient()
      .on('GET', 'https://guac.example/guacamole/api/languages', () => ({
        status: 404,
        headers: {},
        body: 'Not Found',
      }))
      .on('GET', 'https://guac.example/api/languages', () => ({
        status: 301,
        headers: { location: '/remote/' },
        body: null,
      }))
      .on('GET', 'https://guac.example/remote/api/languages', () =>
        jsonResponse(200, languagesJson),
      );
    expect(await new GuacApi(http).probe('guac.example')).toEqual({
      baseUrl: 'https://guac.example/remote',
      secure: true,
    });
    expect(http.requests.every((r) => r.body === undefined && !r.headers)).toBe(true);
  });

  it('never follows a cross-origin redirect and reports it', async () => {
    const http = new FakeHttpClient().on(
      'GET',
      () => true,
      () => ({ status: 302, headers: { location: 'https://sso.example/login' }, body: null }),
    );
    expect(await errorInfo(new GuacApi(http).probe('https://guac.example/guacamole'))).toEqual({
      kind: 'redirected',
      url: 'https://guac.example/guacamole/api/languages',
      location: 'https://sso.example/login',
    });
    expect(http.requests.every((r) => r.url.startsWith('https://guac.example/'))).toBe(true);
    // http → https on the same host is a different origin too: not followed.
    const upgrade = new FakeHttpClient().on(
      'GET',
      () => true,
      (req) => ({
        status: 301,
        headers: { location: req.url.replace('http:', 'https:') },
        body: null,
      }),
    );
    expect(
      (await errorInfo(new GuacApi(upgrade).probe('http://guac.example/guacamole'))).kind,
    ).toBe('redirected');
    expect(upgrade.requests).toHaveLength(1);
  });

  it('reports the redirect when a same-origin hop is not Guacamole (a sign-in gateway)', async () => {
    const http = new FakeHttpClient()
      .on('GET', 'https://guac.example/guacamole/api/languages', () => ({
        status: 302,
        headers: { location: '/oauth2/sign_in' },
        body: null,
      }))
      .on('GET', 'https://guac.example/oauth2/sign_in/api/languages', () =>
        textResponse(200, '<html>Sign in</html>'),
      );
    expect(await errorInfo(new GuacApi(http).probe('https://guac.example/guacamole'))).toEqual({
      kind: 'redirected',
      url: 'https://guac.example/guacamole/api/languages',
      location: '/oauth2/sign_in',
    });
  });

  it('stops after a few same-origin redirects', async () => {
    let n = 0;
    const http = new FakeHttpClient().on(
      'GET',
      () => true,
      () => ({ status: 302, headers: { location: `/loop${++n}/` }, body: null }),
    );
    expect((await errorInfo(new GuacApi(http).probe('https://guac.example/guacamole'))).kind).toBe(
      'redirected',
    );
    expect(http.requests.length).toBeLessThanOrEqual(4);
  });

  it('rejects unusable input without any request', async () => {
    const http = new FakeHttpClient();
    expect(await errorInfo(new GuacApi(http).probe(''))).toEqual({
      kind: 'invalid-url',
      reason: 'empty',
    });
    expect(http.requests).toHaveLength(0);
  });
});

describe('session sharing (1.6.0 tunnel REST)', () => {
  const tunnel = '0b1f6a3e-1111-2222-3333-444455556666';
  const base = `${session.baseUrl}/api/session/tunnels/${tunnel}/activeConnection`;

  it('lists the sharing profiles of the connection behind the tunnel', async () => {
    const http = new FakeHttpClient().on('GET', `${base}/connection/sharingProfiles`, () =>
      jsonResponse(200, {
        '7': { identifier: '7', name: 'Watch only', primaryConnectionIdentifier: '1' },
        '3': { identifier: '3', name: 'Collaborate', primaryConnectionIdentifier: '1' },
      }),
    );
    const list = await new GuacApi(http).getTunnelSharingProfiles(session, tunnel);
    expect(list).toEqual([
      { identifier: '3', name: 'Collaborate' },
      { identifier: '7', name: 'Watch only' },
    ]);
    expect(http.requests[0]?.headers?.[TOKEN_HEADER]).toBe(session.token);
  });

  it('builds the web client share link from the sharing credentials', async () => {
    const http = new FakeHttpClient().on('GET', `${base}/sharingCredentials/7`, () =>
      jsonResponse(200, {
        expected: [{ name: 'key', type: 'QUERY_PARAMETER' }],
        values: { key: 'abc+/=' },
      }),
    );
    const link = await new GuacApi(http).createShareLink(session, tunnel, '7');
    expect(link).toBe(`${session.baseUrl}/#/?key=abc%2B%2F%3D`);
    expect(parseShareLink(link)).toEqual({ baseUrl: session.baseUrl, key: 'abc+/=' });
  });

  it('reports a refused profile as an error', async () => {
    const http = new FakeHttpClient().on('GET', `${base}/sharingCredentials/9`, () =>
      jsonResponse(403, {
        message: 'Permission denied.',
        type: 'PERMISSION_DENIED',
        expected: null,
      }),
    );
    await expect(new GuacApi(http).createShareLink(session, tunnel, '9')).rejects.toBeInstanceOf(
      GuacApiError,
    );
  });
});

describe('GuacApi.changePassword (UserResource.updatePassword, 1.6.0)', () => {
  const PW_URL = `${BASE_URL}/api/session/data/postgresql/users/testuser/password`;
  const HEAD = `${BASE_URL}/api/session`;
  const denied = {
    message: 'Permission denied.',
    translatableMessage: {
      key: 'APP.TEXT_UNTRANSLATED',
      variables: { MESSAGE: 'Permission denied.' },
    },
    statusCode: null,
    expected: null,
    type: 'PERMISSION_DENIED',
  };

  it('PUTs { oldPassword, newPassword } as JSON with the token header', async () => {
    const http = new FakeHttpClient().on('PUT', PW_URL, () => jsonResponse(204, null));
    await new GuacApi(http).changePassword(session, 'old pw', 'new pw');
    const req = http.requests[0];
    expect(req?.method).toBe('PUT');
    expect(req?.headers?.[TOKEN_HEADER]).toBe(session.token);
    expect(req?.body).toEqual({
      kind: 'json',
      value: { oldPassword: 'old pw', newPassword: 'new pw' },
    });
  });

  it('encodes the data source and username in the path', async () => {
    const odd = { ...session, primaryDataSource: 'my ds', username: 'a/b' };
    const url = `${BASE_URL}/api/session/data/my%20ds/users/a%2Fb/password`;
    const http = new FakeHttpClient().on('PUT', url, () => jsonResponse(204, null));
    await new GuacApi(http).changePassword(odd, 'o', 'n');
    expect(http.requests[0]?.url).toBe(url);
  });

  it('reports a wrong current password (PERMISSION_DENIED, session still valid) as invalid-credentials', async () => {
    const http = new FakeHttpClient()
      .on('PUT', PW_URL, () => jsonResponse(403, denied))
      .on('HEAD', HEAD, () => jsonResponse(204, null));
    const info = await errorInfo(new GuacApi(http).changePassword(session, 'wrong', 'n'));
    expect(info.kind).toBe('invalid-credentials');
  });

  it('reports PERMISSION_DENIED with a dead token as session-expired', async () => {
    const http = new FakeHttpClient()
      .on('PUT', PW_URL, () => jsonResponse(403, denied))
      .on('HEAD', HEAD, () => jsonResponse(403, permissionDeniedJson));
    const info = await errorInfo(new GuacApi(http).changePassword(session, 'o', 'n'));
    expect(info.kind).toBe('session-expired');
  });

  it('keeps a password-policy refusal with its translatable message', async () => {
    const policy = {
      message: 'Password does not meet minimum length requirements.',
      translatableMessage: { key: 'PASSWORD_POLICY.ERROR_TOO_SHORT', variables: { LENGTH: 10 } },
      statusCode: null,
      expected: null,
      type: 'BAD_REQUEST',
    };
    const http = new FakeHttpClient().on('PUT', PW_URL, () => jsonResponse(400, policy));
    const info = await errorInfo(new GuacApi(http).changePassword(session, 'o', 'short'));
    expect(info).toMatchObject({
      kind: 'server-error',
      type: 'BAD_REQUEST',
      translatableMessage: { key: 'PASSWORD_POLICY.ERROR_TOO_SHORT', variables: { LENGTH: 10 } },
    });
  });
});

describe('GuacApi.canChangePassword', () => {
  const PERMS = `${BASE_URL}/api/session/data/postgresql/self/effectivePermissions`;
  const perms = (users: Record<string, string[]>, system: string[] = []) => ({
    connectionPermissions: {},
    connectionGroupPermissions: {},
    sharingProfilePermissions: {},
    activeConnectionPermissions: {},
    userPermissions: users,
    userGroupPermissions: {},
    systemPermissions: system,
  });

  it('is true with UPDATE on the own user or with ADMINISTER', async () => {
    let http = new FakeHttpClient().on('GET', PERMS, () =>
      jsonResponse(200, perms({ testuser: ['READ', 'UPDATE'] })),
    );
    expect(await new GuacApi(http).canChangePassword(session)).toBe(true);
    http = new FakeHttpClient().on('GET', PERMS, () =>
      jsonResponse(200, perms({}, ['ADMINISTER'])),
    );
    expect(await new GuacApi(http).canChangePassword(session)).toBe(true);
  });

  it('is false with READ only (the 1.6.0 default for a new database user)', async () => {
    const http = new FakeHttpClient().on('GET', PERMS, () =>
      jsonResponse(200, perms({ testuser: ['READ'] })),
    );
    expect(await new GuacApi(http).canChangePassword(session)).toBe(false);
  });

  it('is false for a data source without users (SSO) and for anonymous sessions', async () => {
    const sso = { ...session, primaryDataSource: 'openid' };
    const http = new FakeHttpClient().on(
      'GET',
      `${BASE_URL}/api/session/data/openid/self/effectivePermissions`,
      () => jsonResponse(404, notFoundJson),
    );
    expect(await new GuacApi(http).canChangePassword(sso)).toBe(false);
    expect(
      await new GuacApi(new FakeHttpClient()).canChangePassword({ ...session, username: '' }),
    ).toBe(false);
  });
});

describe('GuacApi.getSsoProviders', () => {
  it('reads the login links from api/patches and never rejects', async () => {
    const patch =
      '<li class="sso-provider sso-provider-openid"><a href="api/ext/openid/login">x</a></li>';
    const http = new FakeHttpClient().on('GET', `${BASE_URL}/api/patches`, () =>
      jsonResponse(200, [patch]),
    );
    expect(await new GuacApi(http).getSsoProviders(profile)).toEqual([
      { paramName: 'id_token', redirectUrl: `${BASE_URL}/api/ext/openid/login`, kind: 'openid' },
    ]);
    const down = new FakeHttpClient().on('GET', `${BASE_URL}/api/patches`, () => {
      throw new HttpTransportError('unreachable', `${BASE_URL}/api/patches`, 'down');
    });
    expect(await new GuacApi(down).getSsoProviders(profile)).toEqual([]);
  });
});

describe('GuacApi.login: Duo return (guacamole-auth-duo 1.6.0)', () => {
  it('posts duo_code and state together with the username and password', async () => {
    const http = new FakeHttpClient().on('POST', TOKENS, () => jsonResponse(200, authResultJson));
    await new GuacApi(http).login(profile, creds, { duo_code: 'C1', state: 'S1' });
    // The web client posts only the URL parameters (duo_code, state); the server then
    // replaces the credentials with the ones it deferred under `state`
    // (DuoAuthenticationProvider.updateCredentials). The resent username and password
    // only matter when `state` is unknown or used: a fresh Duo step instead of a failure.
    expect(formFields(http.requests[0])).toEqual({
      username: 'testuser',
      password: 'pw & =?',
      duo_code: 'C1',
      state: 'S1',
    });
  });
});
