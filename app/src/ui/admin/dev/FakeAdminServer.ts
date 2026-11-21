import {
  HttpTransportError,
  type HttpClient,
  type HttpRequest,
  type HttpResponse,
} from '../../../core/http/HttpClient.ts';
import { PROTOCOL_FIXTURE } from './protocolFixture.ts';

/**
 * DEV HARNESS ONLY (`?harness=admin`). An in-memory stand-in for a Guacamole 1.6.0 server with
 * the database extension, so connection management can be exercised in a desktop browser
 * without a real server. Endpoints and JSON shapes follow docs/protocol-notes.md §1, §2 and §8;
 * server-side checks mimic the database extension (permission checks, blank / duplicate
 * names, no group cycles, cascading folder delete). It is never part of a release build:
 * `main.tsx` loads it through a DEV-guarded dynamic import.
 *
 * Accounts (any non-empty password):
 * - `admin`: system ADMINISTER.
 * - `editor`: CREATE_CONNECTION, UPDATE/DELETE on "Office PC", UPDATE on folder "Lab".
 * - `viewer`: READ only; no management UI.
 * - `stale`: permissions say ADMINISTER, but every change is refused with 403 (as when an
 *   administrator revoked the rights after sign-in).
 */

export const FAKE_BASE_URL = 'https://guac.example/guacamole';
/** A second address the fake also answers (dev only: changing a server's address). */
export const FAKE_ALT_BASE_URL = 'https://other.guac.example/guacamole';
/** Grepped for in `dist/` to prove the harness is not shipped. */
export const FAKE_BACKEND_MARKER = 'omg-fake-admin-backend';
const DS = 'postgresql';

type Json = Record<string, unknown>;

interface Conn {
  identifier: string;
  parentIdentifier: string;
  name: string;
  protocol: string;
  parameters: Record<string, string>;
  attributes: Record<string, string>;
}

interface Group {
  identifier: string;
  parentIdentifier: string;
  name: string;
  type: 'ORGANIZATIONAL' | 'BALANCING';
  attributes: Record<string, string>;
}

interface Active {
  identifier: string;
  connectionIdentifier: string;
  startDate: number;
  remoteHost: string;
  username: string;
}

type UserName = 'admin' | 'editor' | 'viewer' | 'stale';
const USERS: readonly UserName[] = ['admin', 'editor', 'viewer', 'stale'];

function form(name: string, specs: readonly string[]) {
  return {
    name,
    fields: specs.map((spec) => {
      const [field = '', type = 'TEXT', opts] = spec.split(':');
      return opts === undefined
        ? { name: field, type }
        : { name: field, type, options: opts.split('|') };
    }),
  };
}

/** Database-extension attribute forms (`ModeledConnection.ATTRIBUTES`, `ModeledConnectionGroup`). */
const CONNECTION_ATTRIBUTES = [
  form('concurrency', ['max-connections:NUMERIC', 'max-connections-per-user:NUMERIC']),
  form('load-balancing', ['weight:NUMERIC', 'failover-only:BOOLEAN:true']),
  form('guacd', ['guacd-hostname:TEXT', 'guacd-port:NUMERIC', 'guacd-encryption:ENUM:|none|ssl']),
];
const GROUP_ATTRIBUTES = [
  form('concurrency', [
    'max-connections:NUMERIC',
    'max-connections-per-user:NUMERIC',
    'enable-session-affinity:BOOLEAN:true',
  ]),
];
const ATTRIBUTE_NAMES = CONNECTION_ATTRIBUTES.flatMap((f) => f.fields.map((x) => x.name));
const GROUP_ATTRIBUTE_NAMES = GROUP_ATTRIBUTES.flatMap((f) => f.fields.map((x) => x.name));

/**
 * A few labels in the server's translation format (`translations/en.json`), written for this
 * harness, to exercise the lookup path: links (`@:`), trailing colons, section headers.
 * Everything else falls back to labels derived from parameter names.
 */
const TRANSLATIONS_EN = {
  APP: { FIELD_HOSTNAME: 'Host name:' },
  PROTOCOL_RDP: {
    NAME: 'RDP',
    FIELD_HEADER_HOSTNAME: '@:APP.FIELD_HOSTNAME',
    SECTION_HEADER_NETWORK: 'Network',
    FIELD_OPTION_SECURITY_NLA: 'NLA (Network Level Authentication)',
  },
  PROTOCOL_VNC: { NAME: 'VNC' },
  PROTOCOL_SSH: { NAME: 'SSH' },
  CONNECTION_ATTRIBUTES: {
    SECTION_HEADER_GUACD: 'Proxy (guacd)',
    FIELD_HEADER_GUACD_HOSTNAME: 'guacd host:',
  },
};

function apiError(status: number, type: string, message: string): HttpResponse {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    body: {
      message,
      translatableMessage: { key: 'APP.TEXT_UNTRANSLATED', variables: { MESSAGE: message } },
      statusCode: null,
      expected: null,
      patches: null,
      type,
    },
  };
}

function json(status: number, body: unknown): HttpResponse {
  return { status, headers: { 'content-type': 'application/json' }, body };
}

const noContent: HttpResponse = { status: 204, headers: {}, body: null };
const denied = () => apiError(403, 'PERMISSION_DENIED', 'Permission denied.');
const notFound = (id: string) => apiError(404, 'NOT_FOUND', `Not found: "${id}"`);

export class FakeAdminServer implements HttpClient {
  readonly marker = FAKE_BACKEND_MARKER;
  private readonly tokens = new Map<string, UserName>();
  private nextId = 100;
  private groups = new Map<string, Group>();
  private conns = new Map<string, Conn>();
  private active: Active[] = [];
  private readonly latencyMs: number;

  constructor(latencyMs = 150) {
    this.latencyMs = latencyMs;
    const g = (identifier: string, name: string, parentIdentifier = 'ROOT'): void => {
      this.groups.set(identifier, {
        identifier,
        parentIdentifier,
        name,
        type: 'ORGANIZATIONAL',
        attributes: {},
      });
    };
    g('1', 'Lab');
    g('2', 'Servers');
    g('3', 'Linux', '2');
    const c = (
      identifier: string,
      name: string,
      protocol: string,
      parentIdentifier: string,
      parameters: Record<string, string>,
    ): void => {
      this.conns.set(identifier, {
        identifier,
        parentIdentifier,
        name,
        protocol,
        parameters,
        attributes: {},
      });
    };
    c('1', 'Office PC', 'rdp', 'ROOT', {
      hostname: 'host.example',
      port: '3389',
      username: 'demo',
      password: 'example-password',
      security: 'nla',
      'ignore-cert': 'true',
      'enable-wallpaper': 'true',
      'color-depth': '32',
    });
    c('2', 'Build box', 'ssh', '3', { hostname: 'build.host.example', port: '22' });
    c('3', 'Test VM', 'vnc', '1', {
      hostname: 'vm.host.example',
      port: '5901',
      password: 'vnc-pass',
    });
    this.active = [
      {
        identifier: 'a1',
        connectionIdentifier: '1',
        startDate: Date.now() - 25 * 60_000,
        remoteHost: '192.0.2.10',
        username: 'editor',
      },
    ];
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
    // Dev inspection: what reached which host, and whether it carried a token or password.
    const log = ((globalThis as { __omgFakeLog?: unknown[] }).__omgFakeLog ??= []);
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? '');
    log.push({
      method: req.method,
      url: req.url.split('?')[0],
      token: req.headers?.['Guacamole-Token'] ?? null,
      // Field names only (never values): e.g. ["username", "password"].
      fields:
        typeof req.body === 'object' && req.body !== null
          ? Object.keys(req.body)
          : [...new URLSearchParams(body).keys()],
    });
    // A second address served by the same fake, to try changing a server's address.
    const base = req.url.startsWith(`${FAKE_ALT_BASE_URL}/`) ? FAKE_ALT_BASE_URL : FAKE_BASE_URL;
    if (!req.url.startsWith(`${base}/`)) {
      // Anything else (e.g. a probe of another address) is unreachable.
      throw new HttpTransportError('unreachable', req.url, 'fake server: unknown host');
    }
    const path = req.url.slice(base.length + 1).split('?')[0] ?? '';
    return this.route(req, path);
  }

  private user(req: HttpRequest): UserName | undefined {
    const token = req.headers?.['Guacamole-Token'];
    return token ? this.tokens.get(token) : undefined;
  }

  private route(req: HttpRequest, path: string): HttpResponse {
    if (path === 'api/languages' && req.method === 'GET')
      return json(200, { en: 'English', es: 'Español' });
    if (path === 'translations/en.json' && req.method === 'GET') return json(200, TRANSLATIONS_EN);
    if (path.startsWith('translations/')) return { status: 404, headers: {}, body: null };
    if (path === 'api/tokens' && req.method === 'POST') return this.login(req);
    const user = this.user(req);
    if (path === 'api/session') {
      if (!user) return denied();
      if (req.method === 'DELETE') {
        const token = req.headers?.['Guacamole-Token'];
        if (token) this.tokens.delete(token);
      }
      return noContent;
    }
    if (!user) return denied();
    const prefix = `api/session/data/${DS}/`;
    if (!path.startsWith(prefix)) return notFound(path);
    const rest = path.slice(prefix.length).split('/').map(decodeURIComponent);
    return this.data(req, user, rest);
  }

  private login(req: HttpRequest): HttpResponse {
    const fields = req.body?.kind === 'form' ? req.body.fields : {};
    const one = (k: string) => {
      const v = fields[k];
      return typeof v === 'string' ? v : (v?.[0] ?? '');
    };
    const token = one('token');
    if (token) {
      const u = this.tokens.get(token);
      if (u) return this.authResult(token, u);
    }
    const username = one('username') as UserName;
    if (!USERS.includes(username) || one('password') === '') {
      return {
        ...apiError(403, 'INVALID_CREDENTIALS', 'Invalid login.'),
      };
    }
    const fresh = `fake-${Math.random().toString(36).slice(2)}`;
    this.tokens.set(fresh, username);
    return this.authResult(fresh, username);
  }

  private authResult(token: string, username: UserName): HttpResponse {
    return json(200, {
      authToken: token,
      username,
      dataSource: DS,
      availableDataSources: [DS],
    });
  }

  // ---- permissions ----------------------------------------------------------------------

  private permissions(user: UserName): Json {
    const read = (ids: Iterable<string>) =>
      Object.fromEntries([...ids].map((id) => [id, ['READ']]));
    const base = {
      connectionPermissions: read(this.conns.keys()),
      connectionGroupPermissions: { ...read(this.groups.keys()), ROOT: ['READ', 'UPDATE'] },
      sharingProfilePermissions: {},
      // `ActiveConnectionPermissionService`: READ on every visible one, DELETE on own ones.
      activeConnectionPermissions: Object.fromEntries(
        this.active.map((a) => [a.identifier, a.username === user ? ['READ', 'DELETE'] : ['READ']]),
      ),
      userPermissions: { [user]: ['READ'] },
      userGroupPermissions: {},
      systemPermissions: [] as string[],
    };
    if (user === 'admin' || user === 'stale') return { ...base, systemPermissions: ['ADMINISTER'] };
    if (user === 'editor') {
      return {
        ...base,
        systemPermissions: ['CREATE_CONNECTION'],
        connectionPermissions: {
          ...base.connectionPermissions,
          '1': ['READ', 'UPDATE', 'DELETE'],
        },
        connectionGroupPermissions: { ...base.connectionGroupPermissions, '1': ['READ', 'UPDATE'] },
      };
    }
    return base;
  }

  private has(user: UserName, kind: 'conn' | 'group', id: string, type: string): boolean {
    if (user === 'stale') return false;
    if (user === 'admin') return true;
    const p = this.permissions(user);
    const map = (kind === 'conn' ? p['connectionPermissions'] : p['connectionGroupPermissions']) as
      Record<string, string[]> | undefined;
    return map?.[id]?.includes(type) ?? false;
  }

  private canCreate(user: UserName, what: 'conn' | 'group'): boolean {
    if (user === 'admin') return true;
    if (user === 'editor') return what === 'conn';
    return false;
  }

  /** Database rule: changed parents (other than the root) need UPDATE. */
  private canUseParent(user: UserName, parent: string): boolean {
    return parent === 'ROOT' || user === 'admin' || this.has(user, 'group', parent, 'UPDATE');
  }

  // ---- data ---------------------------------------------------------------------------------

  private data(req: HttpRequest, user: UserName, rest: string[]): HttpResponse {
    const [kind, id, sub] = rest;
    if (kind === 'self' && id === 'effectivePermissions') return json(200, this.permissions(user));
    if (kind === 'schema') return this.schema(id);
    if (kind === 'connectionGroups' && sub === 'tree' && req.method === 'GET')
      return json(200, this.tree());
    if (kind === 'connections') return this.connections(req, user, id, sub);
    if (kind === 'connectionGroups') return this.groupsRoute(req, user, id);
    if (kind === 'activeConnections') return this.activeRoute(req, user);
    return notFound(rest.join('/'));
  }

  private schema(what: string | undefined): HttpResponse {
    if (what === 'protocols') {
      const out: Json = {};
      for (const [name, forms] of Object.entries(PROTOCOL_FIXTURE)) {
        out[name] = {
          name,
          connectionForms: forms.map(([n, specs]) => form(n, specs)),
          sharingProfileForms: [],
        };
      }
      return json(200, out);
    }
    if (what === 'connectionAttributes') return json(200, CONNECTION_ATTRIBUTES);
    if (what === 'connectionGroupAttributes') return json(200, GROUP_ATTRIBUTES);
    return notFound(`schema/${what ?? ''}`);
  }

  private apiConnection(c: Conn): Json {
    // Like the database extension: every attribute name is present, unset ones as null.
    const attributes: Json = Object.fromEntries(ATTRIBUTE_NAMES.map((n) => [n, null]));
    Object.assign(attributes, c.attributes);
    return {
      identifier: c.identifier,
      parentIdentifier: c.parentIdentifier,
      name: c.name,
      protocol: c.protocol,
      attributes,
      activeConnections: this.active.filter((a) => a.connectionIdentifier === c.identifier).length,
    };
  }

  private apiGroup(g: Group): Json {
    const attributes: Json = Object.fromEntries(GROUP_ATTRIBUTE_NAMES.map((n) => [n, null]));
    Object.assign(attributes, g.attributes);
    return {
      identifier: g.identifier,
      parentIdentifier: g.parentIdentifier,
      name: g.name,
      type: g.type,
      attributes,
      activeConnections: 0,
    };
  }

  private tree(): Json {
    const build = (id: string): Json => {
      const groups = [...this.groups.values()].filter((g) => g.parentIdentifier === id);
      const conns = [...this.conns.values()].filter((c) => c.parentIdentifier === id);
      const self = id === 'ROOT' ? undefined : this.groups.get(id);
      return {
        ...(self
          ? this.apiGroup(self)
          : {
              identifier: 'ROOT',
              name: 'ROOT',
              type: 'ORGANIZATIONAL',
              activeConnections: 0,
              attributes: {},
            }),
        childConnectionGroups: groups.map((g) => build(g.identifier)),
        childConnections: conns.map((c) => this.apiConnection(c)),
      };
    };
    return build('ROOT');
  }

  private body(req: HttpRequest): Json | undefined {
    return req.body?.kind === 'json' && req.body.value && typeof req.body.value === 'object'
      ? (req.body.value as Json)
      : undefined;
  }

  private strings(raw: unknown): Record<string, string> {
    const out: Record<string, string> = {};
    if (raw && typeof raw === 'object')
      for (const [k, v] of Object.entries(raw as Json))
        if (typeof v === 'string' && v !== '') out[k] = v;
    return out;
  }

  private nameProblem(
    kind: 'connection' | 'connection group',
    name: string,
    parent: string,
    self: string | undefined,
  ): HttpResponse | undefined {
    if (name.trim() === '')
      return apiError(
        400,
        'BAD_REQUEST',
        `${kind === 'connection' ? 'Connection' : 'Connection group'} names must not be blank.`,
      );
    const siblings =
      kind === 'connection'
        ? [...this.conns.values()].filter((c) => c.parentIdentifier === parent)
        : [...this.groups.values()].filter((g) => g.parentIdentifier === parent);
    if (siblings.some((s) => s.name === name && s.identifier !== self))
      return apiError(400, 'BAD_REQUEST', `The ${kind} "${name}" already exists.`);
    return undefined;
  }

  private connections(
    req: HttpRequest,
    user: UserName,
    id: string | undefined,
    sub: string | undefined,
  ): HttpResponse {
    if (id === undefined) {
      if (req.method !== 'POST') return notFound('connections');
      const b = this.body(req);
      if (!b) return apiError(400, 'BAD_REQUEST', 'Data must be submitted when creating objects.');
      if (!this.canCreate(user, 'conn')) return denied();
      const parent = typeof b['parentIdentifier'] === 'string' ? b['parentIdentifier'] : 'ROOT';
      if (!this.canUseParent(user, parent)) return denied();
      const name = typeof b['name'] === 'string' ? b['name'] : '';
      const problem = this.nameProblem('connection', name, parent, undefined);
      if (problem) return problem;
      const parameters = this.strings(b['parameters']);
      const tooLong = Object.entries(parameters).find(([, v]) => v.length > 4096);
      if (tooLong)
        return apiError(
          400,
          'BAD_REQUEST',
          `The value provided for connection parameter "${tooLong[0]}" exceeds the maximum allowed length.`,
        );
      const identifier = String(this.nextId++);
      this.conns.set(identifier, {
        identifier,
        parentIdentifier: parent,
        name,
        protocol: typeof b['protocol'] === 'string' ? b['protocol'] : '',
        parameters,
        attributes: this.strings(b['attributes']),
      });
      return json(200, { ...b, identifier });
    }
    const conn = this.conns.get(id);
    if (!conn) return notFound(id);
    if (sub === 'parameters' && req.method === 'GET') {
      if (!this.has(user, 'conn', id, 'UPDATE') && user !== 'stale')
        return apiError(
          403,
          'PERMISSION_DENIED',
          'Permission to read connection parameters denied.',
        );
      return json(200, { ...conn.parameters });
    }
    if (sub === 'history' && req.method === 'GET') {
      const now = Date.now();
      return json(200, [
        ...this.active
          .filter((a) => a.connectionIdentifier === id)
          .map((a) => ({
            username: a.username,
            startDate: a.startDate,
            endDate: null,
            remoteHost: a.remoteHost,
            active: true,
          })),
        {
          username: 'admin',
          startDate: now - 26 * 3600_000,
          endDate: now - 25 * 3600_000,
          remoteHost: '192.0.2.20',
          active: false,
        },
        {
          username: 'editor',
          startDate: now - 50 * 3600_000,
          endDate: now - 49.5 * 3600_000,
          remoteHost: '198.51.100.7',
          active: false,
        },
      ]);
    }
    if (sub !== undefined) return notFound(`${id}/${sub}`);
    if (req.method === 'GET') return json(200, this.apiConnection(conn));
    if (req.method === 'DELETE') {
      if (!this.has(user, 'conn', id, 'DELETE')) return denied();
      this.conns.delete(id);
      this.active = this.active.filter((a) => a.connectionIdentifier !== id);
      return noContent;
    }
    if (req.method === 'PUT') {
      const b = this.body(req);
      if (!b) return apiError(400, 'BAD_REQUEST', 'Data must be submitted when updating objects.');
      if (!this.has(user, 'conn', id, 'UPDATE')) return denied();
      const parent = typeof b['parentIdentifier'] === 'string' ? b['parentIdentifier'] : 'ROOT';
      if (
        parent !== conn.parentIdentifier &&
        (!this.canUseParent(user, parent) || !this.canUseParent(user, conn.parentIdentifier))
      )
        return denied();
      const name = typeof b['name'] === 'string' ? b['name'] : '';
      const problem = this.nameProblem('connection', name, parent, id);
      if (problem) return problem;
      // A full replace, like ConnectionObjectTranslator.applyExternalChanges.
      this.conns.set(id, {
        identifier: id,
        parentIdentifier: parent,
        name,
        protocol: typeof b['protocol'] === 'string' ? b['protocol'] : conn.protocol,
        parameters: this.strings(b['parameters']),
        attributes: this.strings(b['attributes']),
      });
      return noContent;
    }
    return notFound(id);
  }

  private groupsRoute(req: HttpRequest, user: UserName, id: string | undefined): HttpResponse {
    if (id === undefined) {
      if (req.method !== 'POST') return notFound('connectionGroups');
      const b = this.body(req);
      if (!b) return apiError(400, 'BAD_REQUEST', 'Data must be submitted when creating objects.');
      if (!this.canCreate(user, 'group')) return denied();
      const parent = typeof b['parentIdentifier'] === 'string' ? b['parentIdentifier'] : 'ROOT';
      if (!this.canUseParent(user, parent)) return denied();
      const name = typeof b['name'] === 'string' ? b['name'] : '';
      const problem = this.nameProblem('connection group', name, parent, undefined);
      if (problem) return problem;
      const identifier = String(this.nextId++);
      this.groups.set(identifier, {
        identifier,
        parentIdentifier: parent,
        name,
        type: b['type'] === 'BALANCING' ? 'BALANCING' : 'ORGANIZATIONAL',
        attributes: this.strings(b['attributes']),
      });
      return json(200, { ...b, identifier });
    }
    const group = this.groups.get(id);
    if (!group) return notFound(id);
    if (req.method === 'GET') return json(200, this.apiGroup(group));
    if (req.method === 'DELETE') {
      if (!this.has(user, 'group', id, 'DELETE')) return denied();
      this.deleteGroupCascade(id);
      return noContent;
    }
    if (req.method === 'PUT') {
      const b = this.body(req);
      if (!b) return apiError(400, 'BAD_REQUEST', 'Data must be submitted when updating objects.');
      if (!this.has(user, 'group', id, 'UPDATE')) return denied();
      const parent = typeof b['parentIdentifier'] === 'string' ? b['parentIdentifier'] : 'ROOT';
      const name = typeof b['name'] === 'string' ? b['name'] : '';
      const problem = this.nameProblem('connection group', name, parent, id);
      if (problem) return problem;
      // ConnectionGroupService.beforeUpdate: walk up from the new parent.
      for (
        let p: string | undefined = parent;
        p && p !== 'ROOT';
        p = this.groups.get(p)?.parentIdentifier
      ) {
        if (p === id)
          return apiError(500, 'INTERNAL_ERROR', 'A connection group may not contain itself.');
      }
      this.groups.set(id, {
        identifier: id,
        parentIdentifier: parent,
        name,
        type: b['type'] === 'BALANCING' ? 'BALANCING' : 'ORGANIZATIONAL',
        attributes: this.strings(b['attributes']),
      });
      return noContent;
    }
    return notFound(id);
  }

  /** `ON DELETE CASCADE` on the parent of groups and connections. */
  private deleteGroupCascade(id: string): void {
    for (const g of [...this.groups.values()])
      if (g.parentIdentifier === id) this.deleteGroupCascade(g.identifier);
    for (const c of [...this.conns.values()])
      if (c.parentIdentifier === id) this.conns.delete(c.identifier);
    this.groups.delete(id);
  }

  /**
   * Like the 1.6.0 database extension (`ActiveConnectionService.retrieveObjects`,
   * `TrackedActiveConnection.init`): every active connection on a readable connection is
   * listed (every fake connection is readable), but `username`, `remoteHost` and
   * `connectable` only for administrators or the user's own ones.
   */
  private activeRoute(req: HttpRequest, user: UserName): HttpResponse {
    const privileged = user === 'admin' || user === 'stale';
    if (req.method === 'GET') {
      return json(
        200,
        Object.fromEntries(
          this.active.map((a) => {
            const full = privileged || a.username === user;
            return [
              a.identifier,
              {
                identifier: a.identifier,
                connectionIdentifier: a.connectionIdentifier,
                startDate: a.startDate,
                connectable: full,
                ...(full ? { username: a.username, remoteHost: a.remoteHost } : {}),
              },
            ];
          }),
        ),
      );
    }
    if (req.method === 'PATCH') {
      const patches =
        req.body?.kind === 'json' && Array.isArray(req.body.value)
          ? (req.body.value as Json[])
          : [];
      const ids = patches
        .filter((p) => p['op'] === 'remove')
        .map((p) => String(p['path']).slice(1));
      // DELETE: administrators, or the user's own active connections.
      const allowed = (id: string) =>
        user === 'admin' || this.active.some((a) => a.identifier === id && a.username === user);
      if (!ids.every(allowed)) return denied();
      this.active = this.active.filter((a) => !ids.includes(a.identifier));
      return json(200, {
        patches: ids.map((identifier) => ({ op: 'remove', identifier, path: `/${identifier}` })),
      });
    }
    return notFound('activeConnections');
  }
}
