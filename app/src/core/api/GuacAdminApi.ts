import {
  HttpTransportError,
  type HttpClient,
  type HttpRequest,
  type HttpResponse,
} from '../http/HttpClient.ts';
import {
  connectionBody,
  groupBody,
  parseActiveConnections,
  parseForms,
  parseHistory,
  parseManagedConnection,
  parseManagedGroup,
  parseParameters,
  parsePermissionSet,
  parseProtocols,
  type ActiveConnection,
  type HistoryEntry,
  type ManagedConnection,
  type ManagedGroup,
  type PermissionSet,
  type ProtocolSchema,
  type SchemaForm,
} from '../models/Admin.ts';
import { parseApiErrorBody } from '../models/ApiErrorBody.ts';
import type { AuthSession } from '../models/AuthSession.ts';
import { ModelParseError, isRecord } from '../models/json.ts';
import { joinUrl } from '../url/normalizeServerUrl.ts';
import { GuacApiError, errorFromApiBody, type GuacErrorInfo } from './errors.ts';
import { TOKEN_HEADER } from './GuacApi.ts';

/**
 * Connection management against the Guacamole 1.6.0 REST API: schema, effective
 * permissions, connection and group CRUD, active connections and history. Every endpoint and
 * field is taken from the upstream source; see docs/protocol-notes.md §8.
 *
 * Every method rejects only with `GuacApiError`. On top of `GuacApi`'s taxonomy:
 * - `permission-denied`: `PERMISSION_DENIED` while `HEAD api/session` says the token is
 *   still valid. (Upstream answers an expired token and a real denial identically.)
 * - `not-found`: `NOT_FOUND`, e.g. the object was deleted elsewhere.
 * - Validation failures (blank or duplicate name, value too long) stay `server-error` with
 *   type `BAD_REQUEST`; show the server's message.
 *
 * Parameter maps carry passwords. This class never logs request or response bodies (and
 * the app's `LoggingHttpClient` logs only method, path and status).
 */

export interface GuacAdminApiOptions {
  readonly timeoutMs?: number;
}

/** Schema for one data source: everything the editors need to render forms. */
export interface DataSourceSchema {
  readonly protocols: Readonly<Record<string, ProtocolSchema>>;
  readonly connectionAttributes: readonly SchemaForm[];
  readonly groupAttributes: readonly SchemaForm[];
}

export class GuacAdminApi {
  private readonly http: HttpClient;
  private readonly timeoutMs: number | undefined;
  /** Schema per `baseUrl|dataSource`. The schema is static per server deployment. */
  private readonly schemaCache = new Map<string, Promise<DataSourceSchema>>();
  /** Server translation tables per `baseUrl|language` (no token involved). */
  private readonly translationCache = new Map<string, Promise<Record<string, unknown> | null>>();

  constructor(http: HttpClient, options: GuacAdminApiOptions = {}) {
    this.http = http;
    this.timeoutMs = options.timeoutMs;
  }

  // ---- permissions ------------------------------------------------------------------------

  /** `GET self/effectivePermissions` for one data source (§8.3). */
  async getEffectivePermissions(session: AuthSession, dataSource: string): Promise<PermissionSet> {
    const body = await this.getJson(session, dataSource, 'self/effectivePermissions');
    return this.parse(body, session, dataSource, 'self/effectivePermissions', parsePermissionSet);
  }

  // ---- schema -----------------------------------------------------------------------------

  /**
   * Protocols plus connection and group attribute forms, cached per server and data source.
   * A failed load is not cached.
   */
  getSchema(session: AuthSession, dataSource: string): Promise<DataSourceSchema> {
    const key = `${session.baseUrl}|${dataSource}`;
    const cached = this.schemaCache.get(key);
    if (cached) return cached;
    const load = (async (): Promise<DataSourceSchema> => {
      const [protocols, connectionAttributes, groupAttributes] = await Promise.all([
        this.getJson(session, dataSource, 'schema/protocols'),
        this.getJson(session, dataSource, 'schema/connectionAttributes'),
        this.getJson(session, dataSource, 'schema/connectionGroupAttributes'),
      ]);
      return {
        protocols: this.parse(protocols, session, dataSource, 'schema/protocols', parseProtocols),
        connectionAttributes: this.parse(
          connectionAttributes,
          session,
          dataSource,
          'schema/connectionAttributes',
          (raw) => parseForms(raw),
        ),
        groupAttributes: this.parse(
          groupAttributes,
          session,
          dataSource,
          'schema/connectionGroupAttributes',
          (raw) => parseForms(raw),
        ),
      };
    })();
    this.schemaCache.set(key, load);
    load.catch(() => this.schemaCache.delete(key));
    return load;
  }

  /**
   * The server's own translation table, `GET translations/{lang}.json` (no token; §8.4).
   * Resolves `null` when the server has none or it cannot be loaded: callers then derive
   * labels from field names. Never rejects.
   */
  getServerTranslations(
    baseUrl: string,
    language: string,
  ): Promise<Record<string, unknown> | null> {
    const key = `${baseUrl}|${language}`;
    const cached = this.translationCache.get(key);
    if (cached) return cached;
    const load = this.send({
      method: 'GET',
      url: joinUrl(baseUrl, `translations/${encodeURIComponent(language)}.json`),
    }).then(
      (res) => (res.status === 200 && isRecord(res.body) ? res.body : null),
      () => null,
    );
    this.translationCache.set(key, load);
    return load;
  }

  // ---- connections ------------------------------------------------------------------------

  /**
   * `GET connections/{id}` plus `GET connections/{id}/parameters` (needs UPDATE or
   * ADMINISTER; §8.1). The result is complete enough to PUT back.
   */
  async getConnection(
    session: AuthSession,
    dataSource: string,
    identifier: string,
  ): Promise<ManagedConnection> {
    const path = `connections/${encodeURIComponent(identifier)}`;
    const [raw, rawParams] = await Promise.all([
      this.getJson(session, dataSource, path),
      this.getJson(session, dataSource, `${path}/parameters`),
    ]);
    const base = this.parse(raw, session, dataSource, path, parseManagedConnection);
    const parameters = this.parse(
      rawParams,
      session,
      dataSource,
      `${path}/parameters`,
      parseParameters,
    );
    return { ...base, parameters };
  }

  /** `POST connections`. Resolves the new connection's identifier. */
  async createConnection(
    session: AuthSession,
    dataSource: string,
    connection: ManagedConnection,
  ): Promise<string> {
    const { identifier: _ignored, ...rest } = connection;
    void _ignored;
    const res = await this.write(session, dataSource, 'POST', 'connections', connectionBody(rest));
    return this.createdIdentifier(res, session, dataSource, 'connections');
  }

  /** `PUT connections/{id}` with the full object (a full replace; §8.1). */
  async updateConnection(
    session: AuthSession,
    dataSource: string,
    identifier: string,
    connection: ManagedConnection,
  ): Promise<void> {
    await this.write(
      session,
      dataSource,
      'PUT',
      `connections/${encodeURIComponent(identifier)}`,
      connectionBody({ ...connection, identifier }),
    );
  }

  /**
   * Moves a connection: loads it with its parameters, changes only `parentIdentifier`, and
   * PUTs everything back, so no parameter or attribute is lost.
   */
  async moveConnection(
    session: AuthSession,
    dataSource: string,
    identifier: string,
    parentIdentifier: string,
  ): Promise<void> {
    const current = await this.getConnection(session, dataSource, identifier);
    await this.updateConnection(session, dataSource, identifier, { ...current, parentIdentifier });
  }

  async deleteConnection(
    session: AuthSession,
    dataSource: string,
    identifier: string,
  ): Promise<void> {
    await this.write(
      session,
      dataSource,
      'DELETE',
      `connections/${encodeURIComponent(identifier)}`,
    );
  }

  /** `GET connections/{id}/history`, newest first (at most 1000 server-side). */
  async getConnectionHistory(
    session: AuthSession,
    dataSource: string,
    identifier: string,
  ): Promise<HistoryEntry[]> {
    const path = `connections/${encodeURIComponent(identifier)}/history`;
    const raw = await this.getJson(session, dataSource, path);
    return this.parse(raw, session, dataSource, path, parseHistory);
  }

  // ---- groups -----------------------------------------------------------------------------

  async getGroup(
    session: AuthSession,
    dataSource: string,
    identifier: string,
  ): Promise<ManagedGroup> {
    const path = `connectionGroups/${encodeURIComponent(identifier)}`;
    const raw = await this.getJson(session, dataSource, path);
    return this.parse(raw, session, dataSource, path, parseManagedGroup);
  }

  async createGroup(
    session: AuthSession,
    dataSource: string,
    group: ManagedGroup,
  ): Promise<string> {
    const { identifier: _ignored, ...rest } = group;
    void _ignored;
    const res = await this.write(session, dataSource, 'POST', 'connectionGroups', groupBody(rest));
    return this.createdIdentifier(res, session, dataSource, 'connectionGroups');
  }

  async updateGroup(
    session: AuthSession,
    dataSource: string,
    identifier: string,
    group: ManagedGroup,
  ): Promise<void> {
    await this.write(
      session,
      dataSource,
      'PUT',
      `connectionGroups/${encodeURIComponent(identifier)}`,
      groupBody({ ...group, identifier }),
    );
  }

  /** Loads the group and PUTs it back with a new parent (keeps type and attributes). */
  async moveGroup(
    session: AuthSession,
    dataSource: string,
    identifier: string,
    parentIdentifier: string,
  ): Promise<void> {
    const current = await this.getGroup(session, dataSource, identifier);
    await this.updateGroup(session, dataSource, identifier, { ...current, parentIdentifier });
  }

  /** Deletes the group. The database extension deletes its contents too (§8.2). */
  async deleteGroup(session: AuthSession, dataSource: string, identifier: string): Promise<void> {
    await this.write(
      session,
      dataSource,
      'DELETE',
      `connectionGroups/${encodeURIComponent(identifier)}`,
    );
  }

  // ---- active connections -----------------------------------------------------------------

  async listActiveConnections(
    session: AuthSession,
    dataSource: string,
  ): Promise<ActiveConnection[]> {
    const raw = await this.getJson(session, dataSource, 'activeConnections');
    return this.parse(raw, session, dataSource, 'activeConnections', parseActiveConnections);
  }

  /** `PATCH activeConnections` with one `remove` per identifier, like the web client. */
  async killActiveConnections(
    session: AuthSession,
    dataSource: string,
    identifiers: readonly string[],
  ): Promise<void> {
    if (identifiers.length === 0) return;
    await this.write(
      session,
      dataSource,
      'PATCH',
      'activeConnections',
      identifiers.map((id) => ({ op: 'remove', path: `/${id}` })),
    );
  }

  // ---- plumbing ---------------------------------------------------------------------------

  private url(session: AuthSession, dataSource: string, path: string): string {
    return joinUrl(session.baseUrl, `api/session/data/${encodeURIComponent(dataSource)}/${path}`);
  }

  private async getJson(session: AuthSession, dataSource: string, path: string): Promise<unknown> {
    const url = this.url(session, dataSource, path);
    const res = await this.send({ method: 'GET', url, headers: { [TOKEN_HEADER]: session.token } });
    if (res.status !== 200) throw await this.errorFor(res, session);
    if (isRecord(res.body) || Array.isArray(res.body)) return res.body;
    if (typeof res.body === 'string' || res.body === null) {
      throw new GuacApiError({ kind: 'not-guacamole', url: session.baseUrl, status: res.status });
    }
    throw new GuacApiError({ kind: 'invalid-response', url, detail: 'expected JSON' });
  }

  private async write(
    session: AuthSession,
    dataSource: string,
    method: 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    path: string,
    value?: unknown,
  ): Promise<HttpResponse> {
    const url = this.url(session, dataSource, path);
    const res = await this.send({
      method,
      url,
      headers: { [TOKEN_HEADER]: session.token },
      ...(value === undefined ? {} : { body: { kind: 'json' as const, value } }),
    });
    if (res.status < 200 || res.status >= 300) throw await this.errorFor(res, session);
    return res;
  }

  private createdIdentifier(
    res: HttpResponse,
    session: AuthSession,
    dataSource: string,
    path: string,
  ): string {
    const id = isRecord(res.body) ? res.body['identifier'] : undefined;
    if (typeof id === 'string' && id.length > 0) return id;
    throw new GuacApiError({
      kind: 'invalid-response',
      url: this.url(session, dataSource, path),
      detail: 'created object has no identifier',
    });
  }

  private parse<T>(
    raw: unknown,
    session: AuthSession,
    dataSource: string,
    path: string,
    fn: (raw: unknown) => T,
  ): T {
    try {
      return fn(raw);
    } catch (err) {
      if (err instanceof ModelParseError) {
        throw new GuacApiError(
          {
            kind: 'invalid-response',
            url: this.url(session, dataSource, path),
            detail: err.message,
          },
          { cause: err },
        );
      }
      throw err;
    }
  }

  /**
   * Maps an error response. `PERMISSION_DENIED` is disambiguated with `HEAD api/session`
   * (docs/protocol-notes.md §1.4, §8.3).
   */
  private async errorFor(res: HttpResponse, session: AuthSession): Promise<GuacApiError> {
    const body = parseApiErrorBody(res.body);
    if (!body)
      return new GuacApiError({ kind: 'not-guacamole', url: session.baseUrl, status: res.status });
    const detail = {
      status: res.status,
      message: body.message,
      translatableMessage: body.translatableMessage,
    };
    if (body.type === 'NOT_FOUND') return new GuacApiError({ kind: 'not-found', ...detail });
    if (body.type === 'PERMISSION_DENIED') {
      let valid: boolean;
      try {
        const head = await this.send({
          method: 'HEAD',
          url: joinUrl(session.baseUrl, 'api/session'),
          headers: { [TOKEN_HEADER]: session.token },
        });
        // Only 401/403 mean a dead token: before 1.6.0 there is no `HEAD api/session`, and
        // a valid token gets 405 (docs/protocol-notes.md §1.3).
        valid = head.status !== 401 && head.status !== 403;
      } catch {
        // Cannot tell; treat it as a permission problem rather than signing the user out.
        valid = true;
      }
      return new GuacApiError(
        valid ? { kind: 'permission-denied', ...detail } : { kind: 'session-expired', ...detail },
      );
    }
    const info: GuacErrorInfo = errorFromApiBody(body, res.status, true);
    return new GuacApiError(info);
  }

  private async send(req: HttpRequest): Promise<HttpResponse> {
    try {
      return await this.http.request(
        this.timeoutMs === undefined ? req : { ...req, timeoutMs: this.timeoutMs },
      );
    } catch (err) {
      if (err instanceof HttpTransportError) {
        const info: GuacErrorInfo =
          err.kind === 'tls'
            ? { kind: 'tls', url: req.url }
            : { kind: 'unreachable', url: req.url, timedOut: err.kind === 'timeout' };
        throw new GuacApiError(info, { cause: err });
      }
      throw err;
    }
  }
}
