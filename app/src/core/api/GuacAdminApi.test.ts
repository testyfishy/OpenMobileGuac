import { describe, expect, it } from 'vitest';
import { HttpTransportError, type HttpRequest } from '../http/HttpClient.ts';
import type { ManagedConnection } from '../models/Admin.ts';
import type { AuthSession } from '../models/AuthSession.ts';
import { FakeHttpClient, jsonResponse, textResponse } from '../testing/FakeHttpClient.ts';
import { BASE_URL, notFoundJson, permissionDeniedJson } from '../testing/fixtures.ts';
import { GuacApiError, type GuacErrorInfo } from './errors.ts';
import { GuacAdminApi } from './GuacAdminApi.ts';
import { TOKEN_HEADER } from './GuacApi.ts';

const session: AuthSession = {
  baseUrl: BASE_URL,
  token: 'TOKEN123',
  username: 'testuser',
  primaryDataSource: 'postgresql',
  dataSources: ['postgresql'],
};
const DATA = `${BASE_URL}/api/session/data/postgresql`;
const SESSION = `${BASE_URL}/api/session`;

/** `GuacamoleClientException` from the database extension (docs/protocol-notes.md §8.1). */
const duplicateNameJson = {
  message: 'The connection "Office PC" already exists.',
  translatableMessage: {
    key: 'APP.TEXT_UNTRANSLATED',
    variables: { MESSAGE: 'The connection "Office PC" already exists.' },
  },
  statusCode: null,
  expected: null,
  patches: null,
  type: 'BAD_REQUEST',
};

const connectionJson = {
  identifier: '7',
  parentIdentifier: 'ROOT',
  name: 'Office PC',
  protocol: 'rdp',
  attributes: { 'max-connections': null, 'guacd-hostname': 'proxy.example', weight: null },
  activeConnections: 0,
};
const parametersJson = { hostname: 'host.example', port: '3389', password: 'secret' };

const draft: ManagedConnection = {
  parentIdentifier: 'ROOT',
  name: 'Office PC',
  protocol: 'rdp',
  parameters: { hostname: 'host.example', 'color-depth': '16' },
  attributes: {},
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

/** A server where the session is still valid (so 403 means a real permission denial). */
function server(sessionValid = true): FakeHttpClient {
  return new FakeHttpClient().on('HEAD', SESSION, () =>
    sessionValid
      ? { status: 204, headers: {}, body: null }
      : jsonResponse(403, permissionDeniedJson),
  );
}

const denied = () => jsonResponse(403, permissionDeniedJson);
const bad = () => jsonResponse(400, duplicateNameJson);

describe('GuacAdminApi error mapping', () => {
  it('reports permission-denied when the session is still valid', async () => {
    const http = server(true).on('GET', `${DATA}/self/effectivePermissions`, denied);
    const info = await errorInfo(
      new GuacAdminApi(http).getEffectivePermissions(session, 'postgresql'),
    );
    expect(info.kind).toBe('permission-denied');
    expect(http.requests.map((r) => r.method)).toEqual(['GET', 'HEAD']);
  });

  it('reports session-expired when HEAD api/session also fails', async () => {
    const http = server(false).on('GET', `${DATA}/self/effectivePermissions`, denied);
    const info = await errorInfo(
      new GuacAdminApi(http).getEffectivePermissions(session, 'postgresql'),
    );
    expect(info.kind).toBe('session-expired');
  });

  it('keeps permission-denied on a pre-1.6.0 server without HEAD api/session (405)', async () => {
    const http = new FakeHttpClient()
      .on('GET', `${DATA}/self/effectivePermissions`, denied)
      .on('HEAD', SESSION, () => ({ status: 405, headers: {}, body: null }));
    const info = await errorInfo(
      new GuacAdminApi(http).getEffectivePermissions(session, 'postgresql'),
    );
    expect(info.kind).toBe('permission-denied');
  });

  it('keeps permission-denied when the validity check cannot be made', async () => {
    const http = new FakeHttpClient()
      .on('GET', `${DATA}/self/effectivePermissions`, denied)
      .on('HEAD', SESSION, (req) => {
        throw new HttpTransportError('unreachable', req.url, 'offline');
      });
    const info = await errorInfo(
      new GuacAdminApi(http).getEffectivePermissions(session, 'postgresql'),
    );
    expect(info.kind).toBe('permission-denied');
  });

  it('maps NOT_FOUND to not-found and a proxy page to not-guacamole', async () => {
    const http = server()
      .on('GET', `${DATA}/connections/9`, () => jsonResponse(404, notFoundJson))
      .on('GET', `${DATA}/connections/9/parameters`, () => jsonResponse(404, notFoundJson))
      .on('GET', `${DATA}/connectionGroups/9`, () => textResponse(502, '<html>Bad gateway</html>'));
    const api = new GuacAdminApi(http);
    expect((await errorInfo(api.getConnection(session, 'postgresql', '9'))).kind).toBe('not-found');
    expect((await errorInfo(api.getGroup(session, 'postgresql', '9'))).kind).toBe('not-guacamole');
  });

  it('maps transport failures', async () => {
    const http = new FakeHttpClient().on('GET', `${DATA}/self/effectivePermissions`, (req) => {
      throw new HttpTransportError('timeout', req.url, 'slow');
    });
    const info = await errorInfo(
      new GuacAdminApi(http).getEffectivePermissions(session, 'postgresql'),
    );
    expect(info).toMatchObject({ kind: 'unreachable', timedOut: true });
  });
});

describe('GuacAdminApi permissions', () => {
  it('GETs self/effectivePermissions with the token header and parses the sets', async () => {
    const http = server().on('GET', `${DATA}/self/effectivePermissions`, () =>
      jsonResponse(200, {
        connectionPermissions: { '7': ['READ', 'UPDATE'] },
        connectionGroupPermissions: { ROOT: ['READ', 'UPDATE'] },
        sharingProfilePermissions: {},
        activeConnectionPermissions: { a1: ['DELETE'] },
        userPermissions: {},
        userGroupPermissions: {},
        systemPermissions: ['CREATE_CONNECTION'],
      }),
    );
    const p = await new GuacAdminApi(http).getEffectivePermissions(session, 'postgresql');
    expect(http.requests[0]?.headers?.[TOKEN_HEADER]).toBe('TOKEN123');
    expect([...p.system]).toEqual(['CREATE_CONNECTION']);
    expect(p.connections.get('7')?.has('UPDATE')).toBe(true);
    expect(p.activeConnections.get('a1')?.has('DELETE')).toBe(true);
  });

  it('rejects a malformed permission set as invalid-response', async () => {
    const http = server().on('GET', `${DATA}/self/effectivePermissions`, () =>
      jsonResponse(200, { systemPermissions: 'ADMINISTER' }),
    );
    const info = await errorInfo(
      new GuacAdminApi(http).getEffectivePermissions(session, 'postgresql'),
    );
    expect(info.kind).toBe('invalid-response');
  });
});

describe('GuacAdminApi schema', () => {
  const protocols = {
    rdp: {
      name: 'rdp',
      connectionForms: [
        { name: 'network', fields: [{ name: 'hostname', type: 'TEXT' }] },
        {
          name: 'display',
          fields: [{ name: 'color-depth', type: 'ENUM', options: ['', '8', '16', '24', '32'] }],
        },
      ],
      sharingProfileForms: [],
    },
  };
  const attrs = [{ name: 'concurrency', fields: [{ name: 'max-connections', type: 'NUMERIC' }] }];
  const schemaServer = () =>
    server()
      .on('GET', `${DATA}/schema/protocols`, () => jsonResponse(200, protocols))
      .on('GET', `${DATA}/schema/connectionAttributes`, () => jsonResponse(200, attrs))
      .on('GET', `${DATA}/schema/connectionGroupAttributes`, () => jsonResponse(200, []));

  it('loads protocols and attribute forms once per data source', async () => {
    const http = schemaServer();
    const api = new GuacAdminApi(http);
    const s = await api.getSchema(session, 'postgresql');
    await api.getSchema(session, 'postgresql');
    expect(http.requests).toHaveLength(3);
    expect(s.protocols['rdp']?.connectionForms[1]?.fields[0]).toEqual({
      name: 'color-depth',
      type: 'ENUM',
      options: ['', '8', '16', '24', '32'],
    });
    expect(s.connectionAttributes[0]?.fields[0]?.name).toBe('max-connections');
  });

  it('does not cache a failed load and maps 403', async () => {
    const http = server()
      .on('GET', `${DATA}/schema/protocols`, denied)
      .on('GET', `${DATA}/schema/connectionAttributes`, () => jsonResponse(200, attrs))
      .on('GET', `${DATA}/schema/connectionGroupAttributes`, () => jsonResponse(200, []));
    const api = new GuacAdminApi(http);
    expect((await errorInfo(api.getSchema(session, 'postgresql'))).kind).toBe('permission-denied');
    http.on('GET', `${DATA}/schema/protocols`, () => jsonResponse(200, protocols));
    await expect(api.getSchema(session, 'postgresql')).resolves.toBeDefined();
  });

  it('loads server translations without a token and never rejects', async () => {
    const http = new FakeHttpClient()
      .on('GET', `${BASE_URL}/translations/es.json`, () => jsonResponse(200, { APP: {} }))
      .on('GET', `${BASE_URL}/translations/xx.json`, () => textResponse(404, 'nope'));
    const api = new GuacAdminApi(http);
    expect(await api.getServerTranslations(BASE_URL, 'es')).toEqual({ APP: {} });
    expect(http.requests[0]?.headers).toBeUndefined();
    expect(await api.getServerTranslations(BASE_URL, 'xx')).toBeNull();
    expect(await api.getServerTranslations(BASE_URL, 'zz')).toBeNull(); // no route → transport-ish error
  });
});

describe('GuacAdminApi connections', () => {
  const full = () =>
    server()
      .on('GET', `${DATA}/connections/7`, () => jsonResponse(200, connectionJson))
      .on('GET', `${DATA}/connections/7/parameters`, () => jsonResponse(200, parametersJson));

  it('gets a connection together with its parameters (nulls dropped)', async () => {
    const c = await new GuacAdminApi(full()).getConnection(session, 'postgresql', '7');
    expect(c).toEqual({
      identifier: '7',
      parentIdentifier: 'ROOT',
      name: 'Office PC',
      protocol: 'rdp',
      attributes: { 'guacd-hostname': 'proxy.example' },
      parameters: parametersJson,
    });
  });

  it('surfaces a parameters 403 as permission-denied', async () => {
    const http = full().on('GET', `${DATA}/connections/7/parameters`, denied);
    expect(
      (await errorInfo(new GuacAdminApi(http).getConnection(session, 'postgresql', '7'))).kind,
    ).toBe('permission-denied');
  });

  it('creates with POST and no identifier, returning the new identifier', async () => {
    let sent: HttpRequest | undefined;
    const http = server().on('POST', `${DATA}/connections`, (req) => {
      sent = req;
      return jsonResponse(200, {
        ...(req.body?.kind === 'json' ? (req.body.value as object) : {}),
        identifier: '42',
      });
    });
    const id = await new GuacAdminApi(http).createConnection(session, 'postgresql', {
      ...draft,
      identifier: 'should-not-be-sent',
    });
    expect(id).toBe('42');
    expect(sent?.body).toEqual({
      kind: 'json',
      value: {
        parentIdentifier: 'ROOT',
        name: 'Office PC',
        protocol: 'rdp',
        parameters: { hostname: 'host.example', 'color-depth': '16' },
        attributes: {},
      },
    });
  });

  it('create: maps a duplicate-name BAD_REQUEST and a 403', async () => {
    const api = (h: FakeHttpClient) =>
      new GuacAdminApi(h).createConnection(session, 'postgresql', draft);
    const dup = await errorInfo(api(server().on('POST', `${DATA}/connections`, bad)));
    expect(dup).toMatchObject({
      kind: 'server-error',
      type: 'BAD_REQUEST',
      message: 'The connection "Office PC" already exists.',
    });
    expect((await errorInfo(api(server().on('POST', `${DATA}/connections`, denied)))).kind).toBe(
      'permission-denied',
    );
  });

  it('create: a response without an identifier is invalid', async () => {
    const http = server().on('POST', `${DATA}/connections`, () => jsonResponse(200, { name: 'x' }));
    expect(
      (await errorInfo(new GuacAdminApi(http).createConnection(session, 'postgresql', draft))).kind,
    ).toBe('invalid-response');
  });

  it('updates with PUT sending every replaced field, attributes always present', async () => {
    let sent: HttpRequest | undefined;
    const http = server().on('PUT', `${DATA}/connections/7`, (req) => {
      sent = req;
      return { status: 204, headers: {}, body: null };
    });
    await new GuacAdminApi(http).updateConnection(session, 'postgresql', '7', draft);
    expect(sent?.body).toEqual({
      kind: 'json',
      value: { ...draft, parameters: { ...draft.parameters }, attributes: {}, identifier: '7' },
    });
  });

  it('update: maps BAD_REQUEST and 403', async () => {
    const run = (h: FakeHttpClient) =>
      errorInfo(new GuacAdminApi(h).updateConnection(session, 'postgresql', '7', draft));
    expect((await run(server().on('PUT', `${DATA}/connections/7`, bad))).kind).toBe('server-error');
    expect((await run(server().on('PUT', `${DATA}/connections/7`, denied))).kind).toBe(
      'permission-denied',
    );
  });

  it('move loads the connection and PUTs the full parameter map back with the new parent', async () => {
    let sent: HttpRequest | undefined;
    const http = full().on('PUT', `${DATA}/connections/7`, (req) => {
      sent = req;
      return { status: 204, headers: {}, body: null };
    });
    await new GuacAdminApi(http).moveConnection(session, 'postgresql', '7', '12');
    expect(sent?.body).toEqual({
      kind: 'json',
      value: {
        identifier: '7',
        parentIdentifier: '12',
        name: 'Office PC',
        protocol: 'rdp',
        parameters: parametersJson,
        attributes: { 'guacd-hostname': 'proxy.example' },
      },
    });
  });

  it('move: a 403 on the PUT is permission-denied', async () => {
    const http = full().on('PUT', `${DATA}/connections/7`, denied);
    expect(
      (await errorInfo(new GuacAdminApi(http).moveConnection(session, 'postgresql', '7', '12')))
        .kind,
    ).toBe('permission-denied');
  });

  it('deletes with DELETE; maps 403 and 404', async () => {
    const ok = server().on('DELETE', `${DATA}/connections/7`, () => ({
      status: 204,
      headers: {},
      body: null,
    }));
    await new GuacAdminApi(ok).deleteConnection(session, 'postgresql', '7');
    expect(ok.requests[0]?.method).toBe('DELETE');
    const no = server().on('DELETE', `${DATA}/connections/7`, denied);
    expect(
      (await errorInfo(new GuacAdminApi(no).deleteConnection(session, 'postgresql', '7'))).kind,
    ).toBe('permission-denied');
    const gone = server().on('DELETE', `${DATA}/connections/7`, () =>
      jsonResponse(404, notFoundJson),
    );
    expect(
      (await errorInfo(new GuacAdminApi(gone).deleteConnection(session, 'postgresql', '7'))).kind,
    ).toBe('not-found');
  });

  it('encodes identifiers in paths', async () => {
    const http = server().on('DELETE', `${DATA}/connections/a%2Fb`, () => ({
      status: 204,
      headers: {},
      body: null,
    }));
    await new GuacAdminApi(http).deleteConnection(session, 'postgresql', 'a/b');
    expect(http.requests[0]?.url).toBe(`${DATA}/connections/a%2Fb`);
  });

  it('reads history (epoch or ISO dates) and maps 403', async () => {
    const http = server().on('GET', `${DATA}/connections/7/history`, () =>
      jsonResponse(200, [
        { username: 'a', startDate: 1000, endDate: 61000, remoteHost: '192.0.2.1', active: false },
        { username: 'b', startDate: '2026-01-01T00:00:00Z', endDate: null, active: true },
      ]),
    );
    const h = await new GuacAdminApi(http).getConnectionHistory(session, 'postgresql', '7');
    expect(h[0]).toEqual({
      username: 'a',
      startDate: 1000,
      endDate: 61000,
      remoteHost: '192.0.2.1',
      active: false,
    });
    expect(h[1]?.startDate).toBe(Date.parse('2026-01-01T00:00:00Z'));
    const no = server().on('GET', `${DATA}/connections/7/history`, denied);
    expect(
      (await errorInfo(new GuacAdminApi(no).getConnectionHistory(session, 'postgresql', '7'))).kind,
    ).toBe('permission-denied');
  });
});

describe('GuacAdminApi groups', () => {
  const groupJson = {
    identifier: '3',
    parentIdentifier: 'ROOT',
    name: 'Lab',
    type: 'BALANCING',
    attributes: { 'max-connections': '4', 'enable-session-affinity': null },
    activeConnections: 0,
  };

  it('gets, creates, updates and deletes groups', async () => {
    const sent: HttpRequest[] = [];
    const http = server()
      .on('GET', `${DATA}/connectionGroups/3`, () => jsonResponse(200, groupJson))
      .on('POST', `${DATA}/connectionGroups`, (req) => {
        sent.push(req);
        return jsonResponse(200, { identifier: '8' });
      })
      .on('PUT', `${DATA}/connectionGroups/3`, (req) => {
        sent.push(req);
        return { status: 204, headers: {}, body: null };
      })
      .on('DELETE', `${DATA}/connectionGroups/3`, () => ({ status: 204, headers: {}, body: null }));
    const api = new GuacAdminApi(http);
    const g = await api.getGroup(session, 'postgresql', '3');
    expect(g).toEqual({
      identifier: '3',
      parentIdentifier: 'ROOT',
      name: 'Lab',
      type: 'BALANCING',
      attributes: { 'max-connections': '4' },
    });
    const newGroup = {
      parentIdentifier: 'ROOT',
      name: 'New',
      type: 'ORGANIZATIONAL',
      attributes: {},
    };
    expect(await api.createGroup(session, 'postgresql', newGroup)).toBe('8');
    expect(sent[0]?.body).toEqual({ kind: 'json', value: newGroup });
    await api.moveGroup(session, 'postgresql', '3', '5');
    expect(sent[1]?.body).toEqual({
      kind: 'json',
      value: { ...g, parentIdentifier: '5', identifier: '3' },
    });
    await api.deleteGroup(session, 'postgresql', '3');
  });

  it('maps validation and permission errors on group writes', async () => {
    const cycle = {
      message: 'A connection group may not contain itself.',
      type: 'INTERNAL_ERROR',
    };
    const http = server()
      .on('POST', `${DATA}/connectionGroups`, bad)
      .on('PUT', `${DATA}/connectionGroups/3`, () => jsonResponse(500, cycle))
      .on('DELETE', `${DATA}/connectionGroups/3`, denied);
    const api = new GuacAdminApi(http);
    const g = { parentIdentifier: 'ROOT', name: 'Lab', type: 'ORGANIZATIONAL', attributes: {} };
    expect(await errorInfo(api.createGroup(session, 'postgresql', g))).toMatchObject({
      kind: 'server-error',
      type: 'BAD_REQUEST',
    });
    expect(await errorInfo(api.updateGroup(session, 'postgresql', '3', g))).toMatchObject({
      kind: 'server-error',
      type: 'INTERNAL_ERROR',
      message: 'A connection group may not contain itself.',
    });
    expect((await errorInfo(api.deleteGroup(session, 'postgresql', '3'))).kind).toBe(
      'permission-denied',
    );
  });
});

describe('GuacAdminApi active connections', () => {
  it('lists active connections from the identifier map', async () => {
    const http = server().on('GET', `${DATA}/activeConnections`, () =>
      jsonResponse(200, {
        a1: {
          identifier: 'a1',
          connectionIdentifier: '7',
          startDate: 5000,
          remoteHost: '192.0.2.9',
          username: 'bob',
          connectable: true,
        },
      }),
    );
    const list = await new GuacAdminApi(http).listActiveConnections(session, 'postgresql');
    expect(list).toEqual([
      {
        identifier: 'a1',
        connectionIdentifier: '7',
        startDate: 5000,
        remoteHost: '192.0.2.9',
        username: 'bob',
        connectable: true,
      },
    ]);
  });

  it('kills with one PATCH of remove operations, like the web client', async () => {
    let sent: HttpRequest | undefined;
    const http = server().on('PATCH', `${DATA}/activeConnections`, (req) => {
      sent = req;
      return jsonResponse(200, { patches: [] });
    });
    const api = new GuacAdminApi(http);
    await api.killActiveConnections(session, 'postgresql', ['a1', 'a2']);
    expect(sent?.body).toEqual({
      kind: 'json',
      value: [
        { op: 'remove', path: '/a1' },
        { op: 'remove', path: '/a2' },
      ],
    });
    await api.killActiveConnections(session, 'postgresql', []);
    expect(http.requests).toHaveLength(1);
  });

  it('maps a refused kill (403) and a failed patch (400)', async () => {
    const run = (h: FakeHttpClient) =>
      errorInfo(new GuacAdminApi(h).killActiveConnections(session, 'postgresql', ['a1']));
    expect((await run(server().on('PATCH', `${DATA}/activeConnections`, denied))).kind).toBe(
      'permission-denied',
    );
    const failed = {
      message: 'The provided patches failed to apply.',
      type: 'BAD_REQUEST',
      patches: [{ op: 'remove', path: '/a1' }],
    };
    expect(
      await run(server().on('PATCH', `${DATA}/activeConnections`, () => jsonResponse(400, failed))),
    ).toMatchObject({ kind: 'server-error', type: 'BAD_REQUEST' });
  });
});

describe('GuacAdminApi reads refused with 403', () => {
  it('maps a 403 on every read to permission-denied', async () => {
    const http = server()
      .on('GET', `${DATA}/activeConnections`, denied)
      .on('GET', `${DATA}/connectionGroups/3`, denied);
    const api = new GuacAdminApi(http);
    expect((await errorInfo(api.listActiveConnections(session, 'postgresql'))).kind).toBe(
      'permission-denied',
    );
    expect((await errorInfo(api.getGroup(session, 'postgresql', '3'))).kind).toBe(
      'permission-denied',
    );
  });
});

describe('GuacAdminApi group writes refused', () => {
  const g = { parentIdentifier: 'ROOT', name: 'Lab', type: 'ORGANIZATIONAL', attributes: {} };

  it('maps 403 on create and update, and BAD_REQUEST on update', async () => {
    const http = server()
      .on('POST', `${DATA}/connectionGroups`, denied)
      .on('PUT', `${DATA}/connectionGroups/3`, denied)
      .on('PUT', `${DATA}/connectionGroups/4`, bad);
    const api = new GuacAdminApi(http);
    expect((await errorInfo(api.createGroup(session, 'postgresql', g))).kind).toBe(
      'permission-denied',
    );
    expect((await errorInfo(api.updateGroup(session, 'postgresql', '3', g))).kind).toBe(
      'permission-denied',
    );
    expect(await errorInfo(api.updateGroup(session, 'postgresql', '4', g))).toMatchObject({
      kind: 'server-error',
      type: 'BAD_REQUEST',
    });
  });
});
