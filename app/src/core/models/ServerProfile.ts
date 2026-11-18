import {
  ModelParseError,
  expectNonEmptyString,
  expectRecord,
  expectString,
  optionalBoolean,
  optionalNumber,
  optionalString,
} from './json.ts';

/**
 * A saved Guacamole server (SPEC SRV-1).
 *
 * Holds no secrets: the saved password and auth token live in `SecureStore`, keyed by
 * `id` (see `storage/SecureStore.ts`). A profile can therefore be exported as-is (SRV-10).
 */
export interface ServerProfile {
  /** Stable local id (not sent to the server). */
  readonly id: string;
  /** Display name chosen by the user. */
  readonly name: string;
  /**
   * Normalised base URL including the web application's context path and no trailing slash,
   * for example `https://guac.example/guacamole`. See `url/normalizeServerUrl.ts`.
   */
  readonly baseUrl: string;
  /** Username to pre-fill; empty when not set. */
  readonly username: string;
  /** Whether the user asked for the password to be saved (in SecureStore). */
  readonly rememberPassword: boolean;
  /** Creation time, epoch milliseconds. */
  readonly createdAt: number;
}

/** Throws `ModelParseError` unless `url` is an absolute http(s) URL. */
export function assertHttpBaseUrl(url: string, path = 'baseUrl'): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ModelParseError(path, 'not a valid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ModelParseError(path, 'must use http or https');
  }
}

export function parseServerProfile(raw: unknown, path = ''): ServerProfile {
  const obj = expectRecord(raw, path);
  const baseUrl = expectNonEmptyString(obj, 'baseUrl', path);
  assertHttpBaseUrl(baseUrl, path ? `${path}.baseUrl` : 'baseUrl');
  return {
    id: expectNonEmptyString(obj, 'id', path),
    name: expectString(obj, 'name', path),
    baseUrl,
    username: optionalString(obj, 'username', path) ?? '',
    rememberPassword: optionalBoolean(obj, 'rememberPassword', path) ?? false,
    createdAt: optionalNumber(obj, 'createdAt', path) ?? 0,
  };
}
