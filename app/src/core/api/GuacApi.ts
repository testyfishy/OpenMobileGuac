import {
  HttpTransportError,
  isRedirectResponse,
  type FormFields,
  type HttpClient,
  type HttpRequest,
  type HttpResponse,
} from '../http/HttpClient.ts';
import { parseApiErrorBody } from '../models/ApiErrorBody.ts';
import { parseAuthSession, type AuthSession } from '../models/AuthSession.ts';
import {
  ROOT_GROUP_IDENTIFIER,
  parseConnectionGroup,
  type ConnectionTree,
  type DataSourceTree,
} from '../models/Connection.ts';
import { ModelParseError, isRecord } from '../models/json.ts';
import type { ServerProfile } from '../models/ServerProfile.ts';
import { ssoProvidersFromPatches, type SsoRedirect } from '../sso/sso.ts';
import { joinUrl, normalizeServerUrl, type ServerUrlCandidate } from '../url/normalizeServerUrl.ts';
import { GuacApiError, errorFromApiBody, type GuacErrorInfo } from './errors.ts';

/**
 * Client for the Guacamole 1.6.0 REST API. Every endpoint and field here is taken from the
 * upstream source; see docs/protocol-notes.md §1 and §2.
 *
 * Every method rejects only with `GuacApiError`.
 */

export const TOKEN_HEADER = 'Guacamole-Token';

const MAX_PROBE_REDIRECTS = 3;
const PROBE_PATH_RE = /\/api\/languages\/?$/;

/**
 * Where a probe redirect points, as a new candidate, when it stays on the same scheme, host
 * and port; otherwise `undefined`. `Location: /guacamole/api/languages` and
 * `Location: /guacamole/` both give the base `<origin>/guacamole`.
 */
function sameOriginProbeTarget(
  requestUrl: string,
  location: string | undefined,
  secure: boolean,
): ServerUrlCandidate | undefined {
  if (!location) return undefined;
  let from: URL;
  let to: URL;
  try {
    from = new URL(requestUrl);
    to = new URL(location, requestUrl);
  } catch {
    return undefined;
  }
  if (to.origin !== from.origin || to.username || to.password) return undefined;
  const path = to.pathname.replace(PROBE_PATH_RE, '').replace(/\/+$/, '');
  const baseUrl = `${to.origin}${path}`;
  if (`${baseUrl}/api/languages` === `${from.origin}${from.pathname}`) return undefined;
  return { baseUrl, secure };
}

export interface Credentials {
  readonly username: string;
  readonly password: string;
}

export interface GuacApiOptions {
  /** Per-request timeout in milliseconds. */
  readonly timeoutMs?: number;
}

export class GuacApi {
  private readonly http: HttpClient;
  private readonly timeoutMs: number | undefined;

  constructor(http: HttpClient, options: GuacApiOptions = {}) {
    this.http = http;
    this.timeoutMs = options.timeoutMs;
  }

  /**
   * Resolves user input to a working base URL (SPEC SRV-2). It probes the candidates from
   * `normalizeServerUrl` in order with the unauthenticated `GET api/languages`, so no
   * credentials are sent to an unconfirmed URL.
   *
   * When every candidate fails, the reported error is the most informative one: `tls`, then
   * `not-guacamole` (something answered), then `unreachable`.
   *
   * Without a typed scheme only https is tried unless `allowHttp` (AUDIT #11): a TLS error or
   * a blocked port 443 is reported (with `httpFallbackAvailable`), never silently replaced by
   * plain http. An explicit `http://` is the user's choice and is probed as typed.
   */
  async probe(input: string, opts: { allowHttp?: boolean } = {}): Promise<ServerUrlCandidate> {
    const normalized = normalizeServerUrl(input);
    if (!normalized.ok) throw new GuacApiError({ kind: 'invalid-url', reason: normalized.reason });
    const all = normalized.candidates;
    const schemeTyped = !(all.some((c) => c.secure) && all.some((c) => !c.secure));
    const candidates = schemeTyped || opts.allowHttp ? all : all.filter((c) => c.secure);

    const failures: GuacErrorInfo[] = [];
    for (const first of candidates) {
      // A same-origin redirect (for example `/` → `/guacamole/`) is followed here, and only
      // here: the probe carries no credentials, and the base URL it settles on is the one
      // later requests use. A redirect to another scheme, host or port is never followed.
      let candidate = first;
      // When a followed hop does not lead to Guacamole (a same-origin sign-in gateway such
      // as `/oauth2/sign_in`), the redirect is what the user needs to hear about.
      let firstRedirect: GuacErrorInfo | undefined;
      for (let hop = 0; ; hop++) {
        const url = joinUrl(candidate.baseUrl, 'api/languages');
        try {
          const res = await this.send({ method: 'GET', url });
          if (res.status === 200 && isRecord(res.body)) return candidate;
          failures.push(
            firstRedirect ?? { kind: 'not-guacamole', url: candidate.baseUrl, status: res.status },
          );
        } catch (err) {
          if (!(err instanceof GuacApiError)) throw err;
          const next =
            err.info.kind === 'redirected' && hop < MAX_PROBE_REDIRECTS
              ? sameOriginProbeTarget(url, err.info.location, candidate.secure)
              : undefined;
          if (err.info.kind === 'redirected') firstRedirect ??= err.info;
          if (next) {
            candidate = next;
            continue;
          }
          failures.push(firstRedirect ?? err.info);
        }
        break;
      }
    }
    const rank = (info: GuacErrorInfo): number =>
      info.kind === 'tls'
        ? 0
        : info.kind === 'redirected'
          ? 1
          : info.kind === 'not-guacamole'
            ? 2
            : 3;
    const best = [...failures].sort((a, b) => rank(a) - rank(b))[0];
    const error = new GuacApiError(best ?? { kind: 'invalid-url', reason: 'invalid' });
    error.httpFallbackAvailable = candidates.length < all.length;
    throw error;
  }

  /**
   * `POST api/tokens` with `username`, `password` and any `extraFields`.
   *
   * For a second login step (TOTP, etc.) the server answers `additional-credentials-required`
   * with the expected fields. Call `login` again with the same credentials and
   * `extraFields = { [field.name]: value }`, as the web client does.
   */
  async login(
    profile: Pick<ServerProfile, 'baseUrl'>,
    credentials: Credentials,
    extraFields: Readonly<Record<string, string>> = {},
  ): Promise<AuthSession> {
    return this.createToken(profile.baseUrl, {
      ...extraFields,
      username: credentials.username,
      password: credentials.password,
    });
  }

  /**
   * `POST api/tokens` with arbitrary parameters and no username/password: an SSO result
   * (`id_token`, `ticket`, `state`) or a share-link `key` (SRV-7, CON-6).
   */
  async loginWithParameters(
    profile: Pick<ServerProfile, 'baseUrl'>,
    parameters: Readonly<Record<string, string>>,
  ): Promise<AuthSession> {
    return this.createToken(profile.baseUrl, { ...parameters });
  }

  /**
   * Re-validates a stored token with `POST api/tokens` and `token=<token>`, as the web client
   * does on page load (`updateCurrentToken`). Returns a fresh `AuthSession` with the current
   * data sources. Rejects with `session-expired` if the token is no longer valid.
   *
   * If the token is unknown, upstream `AuthenticationService.authenticate` authenticates the
   * empty credentials as a new login. That can succeed with a *different* token, for example
   * as an anonymous user, so a changed token is also treated as `session-expired`.
   */
  async resumeSession(
    profile: Pick<ServerProfile, 'baseUrl'>,
    token: string,
  ): Promise<AuthSession> {
    let session: AuthSession;
    try {
      session = await this.createToken(profile.baseUrl, { token });
    } catch (err) {
      // An expired token makes the server fall back to credential auth with no
      // credentials, which can show up as INVALID_CREDENTIALS or INSUFFICIENT_CREDENTIALS.
      if (
        err instanceof GuacApiError &&
        (err.info.kind === 'invalid-credentials' ||
          err.info.kind === 'additional-credentials-required' ||
          (err.info.kind === 'server-error' && err.info.type === 'PERMISSION_DENIED'))
      ) {
        throw new GuacApiError(
          {
            kind: 'session-expired',
            status: err.info.status,
            message: err.info.message,
            translatableMessage: err.info.translatableMessage,
          },
          { cause: err },
        );
      }
      throw err;
    }
    if (session.token !== token) {
      // Best effort: do not leave the unintended new session open on the server.
      await this.logout(session).catch(() => undefined);
      throw new GuacApiError({
        kind: 'session-expired',
        status: 200,
        message: 'The server issued a new session instead of resuming the stored one',
        translatableMessage: undefined,
      });
    }
    return session;
  }

  /**
   * Sharing profiles of the connection behind an open tunnel (session sharing, 1.6.0):
   * `GET api/session/tunnels/{uuid}/activeConnection/connection/sharingProfiles`
   * (guacamole-client `TunnelResource` → `ActiveConnectionResource` →
   * `ConnectionResource.getSharingProfileDirectoryResource`; web client
   * `tunnelService.getSharingProfiles`). Only profiles the user may READ are listed.
   */
  async getTunnelSharingProfiles(
    session: AuthSession,
    tunnelUuid: string,
  ): Promise<{ readonly identifier: string; readonly name: string }[]> {
    const url = joinUrl(
      session.baseUrl,
      `api/session/tunnels/${encodeURIComponent(tunnelUuid)}/activeConnection/connection/sharingProfiles`,
    );
    const res = await this.send({ method: 'GET', url, headers: { [TOKEN_HEADER]: session.token } });
    if (res.status !== 200) throw this.errorFor(res, session.baseUrl, true);
    if (!isRecord(res.body)) {
      throw new GuacApiError({ kind: 'invalid-response', url, detail: 'sharing profiles' });
    }
    const out: { identifier: string; name: string }[] = [];
    for (const [id, v] of Object.entries(res.body)) {
      const name = isRecord(v) && typeof v['name'] === 'string' ? v['name'] : id;
      const identifier = isRecord(v) && typeof v['identifier'] === 'string' ? v['identifier'] : id;
      out.push({ identifier, name });
    }
    return out.sort((x, y) => x.name.localeCompare(y.name));
  }

  /**
   * A share key for the active connection behind a tunnel:
   * `GET api/session/tunnels/{uuid}/activeConnection/sharingCredentials/{profile}` →
   * `{ expected: [{ name: 'key', type: 'QUERY_PARAMETER' }], values: { key } }`
   * (`ActiveConnectionResource.getSharingCredentials`, JDBC `ConnectionSharingService`).
   * Returns the link the web client builds (`UserCredentials.getLink`):
   * `<base>/#/?key=<key>`.
   */
  async createShareLink(
    session: AuthSession,
    tunnelUuid: string,
    sharingProfileId: string,
  ): Promise<string> {
    const url = joinUrl(
      session.baseUrl,
      `api/session/tunnels/${encodeURIComponent(tunnelUuid)}/activeConnection/sharingCredentials/${encodeURIComponent(sharingProfileId)}`,
    );
    const res = await this.send({ method: 'GET', url, headers: { [TOKEN_HEADER]: session.token } });
    if (res.status !== 200) throw this.errorFor(res, session.baseUrl, true);
    const values = isRecord(res.body) && isRecord(res.body['values']) ? res.body['values'] : null;
    const key = values && typeof values['key'] === 'string' ? values['key'] : null;
    if (!key) throw new GuacApiError({ kind: 'invalid-response', url, detail: 'no share key' });
    return `${session.baseUrl.replace(/\/+$/, '')}/#/?key=${encodeURIComponent(key)}`;
  }

  /**
   * SSO providers the server advertises on its login page, from `GET api/patches` (no
   * token). Each SSO extension contributes an HTML patch linking to `api/ext/<name>/login`
   * (`guacamole-auth-sso-*` `html/sso-provider-<name>.html`). When a database or LDAP back end
   * decides the sign-in, this is the only sign of SSO: `POST api/tokens` then lists just
   * username and password. Resolves `[]` on any failure.
   */
  async getSsoProviders(profile: Pick<ServerProfile, 'baseUrl'>): Promise<SsoRedirect[]> {
    try {
      const res = await this.send({ method: 'GET', url: joinUrl(profile.baseUrl, 'api/patches') });
      return res.status === 200 ? ssoProvidersFromPatches(res.body, profile.baseUrl) : [];
    } catch {
      return [];
    }
  }

  /**
   * Whether the signed-in user may change their own password, as the web client decides it
   * (`guacSettingsPreferences.js` `canUpdateSelf`): `UPDATE` on their own user, or system
   * `ADMINISTER`, in `GET api/session/data/{ds}/self/effectivePermissions` of the data source
   * that authenticated them (`AuthSession.primaryDataSource`). `false` on any error, for an
   * anonymous session, and for back ends without a user directory (SSO, LDAP: `NOT_FOUND`).
   */
  async canChangePassword(session: AuthSession): Promise<boolean> {
    if (!session.username || !session.primaryDataSource) return false;
    const url = joinUrl(
      session.baseUrl,
      `api/session/data/${encodeURIComponent(session.primaryDataSource)}/self/effectivePermissions`,
    );
    try {
      const res = await this.send({
        method: 'GET',
        url,
        headers: { [TOKEN_HEADER]: session.token },
      });
      if (res.status !== 200 || !isRecord(res.body)) return false;
      const system = res.body['systemPermissions'];
      if (Array.isArray(system) && system.includes('ADMINISTER')) return true;
      const users = res.body['userPermissions'];
      const own = isRecord(users) ? users[session.username] : undefined;
      return Array.isArray(own) && own.includes('UPDATE');
    } catch {
      return false;
    }
  }

  /**
   * Changes the signed-in user's own password:
   * `PUT api/session/data/{ds}/users/{username}/password` with JSON
   * `{ oldPassword, newPassword }` (`UserResource.updatePassword`, `APIUserPasswordUpdate`;
   * web client `userService.updateUserPassword`). 204 on success; the session stays valid.
   *
   * Errors (checked against a 1.6.0 server):
   * - Wrong current password: `PERMISSION_DENIED` "Permission denied.", the same answer as
   *   for an account without `UPDATE` on itself and for an unknown token. If
   *   `HEAD api/session` says the token is still valid it is reported as
   *   `invalid-credentials`, else `session-expired`.
   * - Password policy: `BAD_REQUEST` with `translatableMessage` such as
   *   `PASSWORD_POLICY.ERROR_TOO_SHORT` `{ LENGTH }` (kept as `server-error`).
   * Passwords are never logged.
   */
  async changePassword(
    session: AuthSession,
    oldPassword: string,
    newPassword: string,
  ): Promise<void> {
    const url = joinUrl(
      session.baseUrl,
      `api/session/data/${encodeURIComponent(session.primaryDataSource)}/users/` +
        `${encodeURIComponent(session.username)}/password`,
    );
    const res = await this.send({
      method: 'PUT',
      url,
      headers: { [TOKEN_HEADER]: session.token },
      body: { kind: 'json', value: { oldPassword, newPassword } },
    });
    if (res.status >= 200 && res.status < 300) return;
    const body = parseApiErrorBody(res.body);
    if (body?.type === 'PERMISSION_DENIED') {
      const valid = await this.isSessionValid(session).catch(() => true);
      const detail = {
        status: res.status,
        message: body.message,
        translatableMessage: body.translatableMessage,
      };
      throw new GuacApiError(
        valid ? { kind: 'invalid-credentials', ...detail } : { kind: 'session-expired', ...detail },
      );
    }
    throw this.errorFor(res, session.baseUrl, true);
  }

  /**
   * Whether the token is still valid. Network errors still reject.
   *
   * `HEAD api/session` (`SessionResource.checkValidity`) only exists from Guacamole 1.6.0;
   * 1.5.x and older answer a *valid* token with 405 (no such method), while a dead token is
   * refused with 401/403 before the method is looked up. So only 401/403 count as expired.
   * Any other answer is settled the way the web client re-validates on page load
   * (`POST api/tokens` with `token=`, `resumeSession`), which every version supports.
   */
  async isSessionValid(session: AuthSession): Promise<boolean> {
    const res = await this.send({
      method: 'HEAD',
      url: joinUrl(session.baseUrl, 'api/session'),
      headers: { [TOKEN_HEADER]: session.token },
    });
    if (res.status >= 200 && res.status < 300) return true;
    if (res.status === 401 || res.status === 403) return false;
    try {
      await this.resumeSession(session, session.token);
      return true;
    } catch (err) {
      if (err instanceof GuacApiError && err.info.kind === 'session-expired') return false;
      throw err;
    }
  }

  /**
   * `DELETE api/session` with the token header (what the web client's `logout` does). A token
   * the server already considers gone (403/404) counts as success.
   */
  async logout(session: AuthSession): Promise<void> {
    const res = await this.send({
      method: 'DELETE',
      url: joinUrl(session.baseUrl, 'api/session'),
      headers: { [TOKEN_HEADER]: session.token },
    });
    if (res.status < 300 || res.status === 403 || res.status === 404) return;
    throw this.errorFor(res, session.baseUrl, true);
  }

  /**
   * Gets the tree for every data source in the session, in session order, with
   * `GET api/session/data/{ds}/connectionGroups/ROOT/tree`. Like the web client's
   * `dataSourceService.apply`, it skips a data source that answers `NOT_FOUND` and fails on
   * any other error.
   */
  async getConnectionTree(session: AuthSession): Promise<ConnectionTree> {
    const results = await Promise.all(
      session.dataSources.map((ds) => this.getDataSourceTree(session, ds)),
    );
    return { dataSources: results.filter((r): r is DataSourceTree => r !== undefined) };
  }

  private async getDataSourceTree(
    session: AuthSession,
    dataSource: string,
  ): Promise<DataSourceTree | undefined> {
    const url = joinUrl(
      session.baseUrl,
      `api/session/data/${encodeURIComponent(dataSource)}/connectionGroups/` +
        `${encodeURIComponent(ROOT_GROUP_IDENTIFIER)}/tree`,
    );
    const res = await this.send({ method: 'GET', url, headers: { [TOKEN_HEADER]: session.token } });
    if (res.status !== 200) {
      const apiError = parseApiErrorBody(res.body);
      if (apiError?.type === 'NOT_FOUND') return undefined;
      throw this.errorFor(res, session.baseUrl, true);
    }
    if (!isRecord(res.body)) throw this.unexpected(res, session.baseUrl, url);
    try {
      return { dataSource, root: parseConnectionGroup(res.body, dataSource) };
    } catch (err) {
      if (err instanceof ModelParseError) {
        throw new GuacApiError(
          { kind: 'invalid-response', url, detail: err.message },
          { cause: err },
        );
      }
      throw err;
    }
  }

  private async createToken(baseUrl: string, fields: FormFields): Promise<AuthSession> {
    const url = joinUrl(baseUrl, 'api/tokens');
    const res = await this.send({ method: 'POST', url, body: { kind: 'form', fields } });
    if (res.status !== 200) throw this.errorFor(res, baseUrl, false);
    if (!isRecord(res.body)) throw this.unexpected(res, baseUrl, url);
    try {
      return parseAuthSession(res.body, baseUrl);
    } catch (err) {
      if (err instanceof ModelParseError) {
        // A JSON object without an auth token is almost certainly not Guacamole.
        throw new GuacApiError(
          { kind: 'not-guacamole', url: baseUrl, status: res.status },
          { cause: err },
        );
      }
      throw err;
    }
  }

  /**
   * Sends a request and maps transport failures to `GuacApiError`. A redirect (never followed
   * by the HTTP clients) rejects with `redirected`.
   */
  private async send(req: HttpRequest): Promise<HttpResponse> {
    let res: HttpResponse;
    try {
      res = await this.http.request(
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
    if (isRedirectResponse(res)) {
      throw new GuacApiError({
        kind: 'redirected',
        url: req.url,
        location: res.headers['location'],
      });
    }
    return res;
  }

  private errorFor(res: HttpResponse, baseUrl: string, sessionScoped: boolean): GuacApiError {
    const body = parseApiErrorBody(res.body);
    if (body) return new GuacApiError(errorFromApiBody(body, res.status, sessionScoped));
    return new GuacApiError({ kind: 'not-guacamole', url: baseUrl, status: res.status });
  }

  private unexpected(res: HttpResponse, baseUrl: string, url: string): GuacApiError {
    // A 200 with a non-JSON body (an HTML proxy or login page) means this is not the API.
    if (typeof res.body === 'string' || res.body === null) {
      return new GuacApiError({ kind: 'not-guacamole', url: baseUrl, status: res.status });
    }
    return new GuacApiError({ kind: 'invalid-response', url, detail: 'expected a JSON object' });
  }
}
