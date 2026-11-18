import { expectNonEmptyString, expectRecord, expectString, stringArray } from './json.ts';

/**
 * A logged-in session with one server.
 *
 * Built from the `POST api/tokens` response (`APIAuthenticationResult`), see
 * docs/protocol-notes.md §1.1.
 */
export interface AuthSession {
  /** Base URL the token is valid for (no trailing slash). */
  readonly baseUrl: string;
  /** Value for the `Guacamole-Token` header and the tunnel `token=` parameter. */
  readonly token: string;
  /** Username as reported by the server; `''` means anonymous. */
  readonly username: string;
  /** Identifier of the auth provider that authenticated the user. */
  readonly primaryDataSource: string;
  /** Every data source the user has a context in, in server order. Never empty. */
  readonly dataSources: readonly string[];
}

/** Parses the raw `APIAuthenticationResult` JSON. */
export function parseAuthSession(raw: unknown, baseUrl: string): AuthSession {
  const obj = expectRecord(raw, '');
  const token = expectNonEmptyString(obj, 'authToken', '');
  const username = expectString(obj, 'username', '');
  const primaryDataSource = expectNonEmptyString(obj, 'dataSource', '');
  const available = stringArray(obj, 'availableDataSources', '');
  // Defensive: the primary source is always one of the user's contexts upstream, but make
  // sure the list is never empty and has no duplicates.
  const dataSources = [...new Set(available.length > 0 ? available : [primaryDataSource])];
  return { baseUrl, token, username, primaryDataSource, dataSources };
}
