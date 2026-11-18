import { describe, expect, it } from 'vitest';
import {
  authResultJson,
  sharedTreeJson,
  totpEnrollJson,
  totpRequiredJson,
  treeJson,
} from '../testing/fixtures.ts';
import { parseApiErrorBody } from './ApiErrorBody.ts';
import { parseAuthSession } from './AuthSession.ts';
import { flattenConnections, parseConnection, parseConnectionGroup } from './Connection.ts';
import { ModelParseError } from './json.ts';
import { parseServerProfile } from './ServerProfile.ts';

const BASE = 'https://guac.example/guacamole';

describe('parseAuthSession', () => {
  it('parses APIAuthenticationResult', () => {
    expect(parseAuthSession(authResultJson, BASE)).toEqual({
      baseUrl: BASE,
      token: authResultJson.authToken,
      username: 'testuser',
      primaryDataSource: 'postgresql',
      dataSources: ['postgresql', 'postgresql-shared'],
    });
  });

  it('falls back to the primary data source when the list is missing', () => {
    const s = parseAuthSession({ ...authResultJson, availableDataSources: undefined }, BASE);
    expect(s.dataSources).toEqual(['postgresql']);
  });

  it('accepts the anonymous (empty) username', () => {
    expect(parseAuthSession({ ...authResultJson, username: '' }, BASE).username).toBe('');
  });

  it('rejects a missing or empty token', () => {
    expect(() => parseAuthSession({ ...authResultJson, authToken: '' }, BASE)).toThrow(
      ModelParseError,
    );
    expect(() => parseAuthSession({ username: 'x', dataSource: 'y' }, BASE)).toThrow(/authToken/);
    expect(() => parseAuthSession('<html>', BASE)).toThrow(ModelParseError);
  });
});

describe('parseConnectionGroup', () => {
  const root = parseConnectionGroup(treeJson, 'postgresql');

  it('parses the root and its children in order', () => {
    expect(root.kind).toBe('group');
    expect(root.identifier).toBe('ROOT');
    expect(root.parentIdentifier).toBeUndefined();
    expect(root.childConnections.map((c) => c.name)).toEqual(['Desktop RDP', 'Shell']);
    expect(root.childConnectionGroups.map((g) => [g.name, g.type])).toEqual([
      ['Lab', 'ORGANIZATIONAL'],
      ['Pool', 'BALANCING'],
    ]);
  });

  it('tags every node with its data source', () => {
    const lab = root.childConnectionGroups[0];
    expect(lab?.dataSource).toBe('postgresql');
    expect(lab?.childConnections[0]?.dataSource).toBe('postgresql');
  });

  it('parses connection fields, dropping null attributes', () => {
    const vnc = root.childConnectionGroups[0]?.childConnections[0];
    expect(vnc).toEqual({
      kind: 'connection',
      dataSource: 'postgresql',
      identifier: '7',
      parentIdentifier: '3',
      name: 'Lab VNC',
      protocol: 'vnc',
      activeConnections: 1,
      lastActive: 1763452800000,
      attributes: { 'max-connections': '' },
      sharingProfiles: [],
    });
  });

  it('parses sharing profiles', () => {
    expect(root.childConnections[0]?.sharingProfiles).toEqual([
      { identifier: '9', name: 'View only' },
    ]);
  });

  it('treats absent child lists as empty (Jackson NON_NULL)', () => {
    const pool = root.childConnectionGroups[1];
    expect(pool?.childConnections).toEqual([]);
    expect(pool?.childConnectionGroups).toEqual([]);
    const shared = parseConnectionGroup(sharedTreeJson, 'postgresql-shared');
    expect(shared.childConnectionGroups).toEqual([]);
    expect(shared.childConnections[0]?.attributes).toEqual({});
  });

  it('accepts lastActive as an ISO string', () => {
    const c = parseConnection(
      { identifier: '1', name: 'x', protocol: 'rdp', lastActive: '2025-11-18T08:00:00Z' },
      'ds',
    );
    expect(c.lastActive).toBe(Date.parse('2025-11-18T08:00:00Z'));
  });

  it('reports the path of a bad field', () => {
    const bad = {
      ...treeJson,
      childConnectionGroups: [
        { identifier: '3', childConnections: [{ identifier: '7', name: 5 }] },
      ],
    };
    expect(() => parseConnectionGroup(bad, 'ds')).toThrow(
      'childConnectionGroups[0].childConnections[0].name: expected a string',
    );
  });

  it('rejects a missing identifier and over-deep trees', () => {
    expect(() => parseConnectionGroup({ name: 'x' }, 'ds')).toThrow(/identifier/);
    let deep: Record<string, unknown> = { identifier: 'leaf' };
    for (let i = 0; i < 70; i++) deep = { identifier: `g${i}`, childConnectionGroups: [deep] };
    expect(() => parseConnectionGroup(deep, 'ds')).toThrow(/too deep/);
  });

  it('flattens connections depth first', () => {
    const tree = {
      dataSources: [
        { dataSource: 'postgresql', root },
        {
          dataSource: 'postgresql-shared',
          root: parseConnectionGroup(sharedTreeJson, 'postgresql-shared'),
        },
      ],
    };
    expect(flattenConnections(tree).map((c) => c.identifier)).toEqual(['1', '2', '7', 'abc-123']);
  });
});

describe('parseApiErrorBody', () => {
  it('parses an insufficient-credentials error with expected fields', () => {
    expect(parseApiErrorBody(totpRequiredJson)).toEqual({
      type: 'INSUFFICIENT_CREDENTIALS',
      message: totpRequiredJson.message,
      translatableMessage: { key: 'TOTP.INFO_CODE_REQUIRED', variables: undefined },
      statusCode: undefined,
      expected: [{ name: 'guac-totp', type: 'GUAC_TOTP_CODE', options: undefined, extra: {} }],
    });
  });

  it('keeps extension-specific field properties in extra', () => {
    const field = parseApiErrorBody(totpEnrollJson)?.expected[0];
    expect(field?.extra).toMatchObject({ secret: 'AAAAAAAAAAAAAAAA', digits: 6, period: 30 });
  });

  it('keeps ENUM options and skips malformed fields', () => {
    const body = parseApiErrorBody({
      type: 'INSUFFICIENT_CREDENTIALS',
      expected: [{ name: 'realm', type: 'ENUM', options: ['a', 'b'] }, { type: 'TEXT' }, 'junk'],
    });
    expect(body?.expected).toEqual([
      { name: 'realm', type: 'ENUM', options: ['a', 'b'], extra: {} },
    ]);
  });

  it('returns undefined for non-Guacamole bodies', () => {
    expect(parseApiErrorBody('<html>Bad gateway</html>')).toBeUndefined();
    expect(parseApiErrorBody({ error: 'nope' })).toBeUndefined();
    expect(parseApiErrorBody(null)).toBeUndefined();
  });
});

describe('parseServerProfile', () => {
  const valid = {
    id: 'p1',
    name: 'Home',
    baseUrl: 'https://guac.example/guacamole',
    username: 'testuser',
    rememberPassword: true,
    createdAt: 1,
  };

  it('parses a valid profile and defaults optional fields', () => {
    expect(parseServerProfile(valid)).toEqual(valid);
    expect(parseServerProfile({ id: 'p2', name: '', baseUrl: 'http://guac.example' })).toEqual({
      id: 'p2',
      name: '',
      baseUrl: 'http://guac.example',
      username: '',
      rememberPassword: false,
      createdAt: 0,
    });
  });

  it('rejects non-http URLs and missing ids', () => {
    expect(() => parseServerProfile({ ...valid, baseUrl: 'javascript:alert(1)' })).toThrow(/http/);
    expect(() => parseServerProfile({ ...valid, baseUrl: 'not a url' })).toThrow(/valid URL/);
    expect(() => parseServerProfile({ ...valid, id: '' })).toThrow(/id/);
  });
});
