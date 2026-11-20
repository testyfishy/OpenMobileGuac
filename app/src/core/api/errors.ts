import type {
  ApiErrorBody,
  ApiErrorType,
  FieldDescriptor,
  TranslatableMessage,
} from '../models/ApiErrorBody.ts';

/**
 * The typed error taxonomy for `GuacApi`. UI code switches on `error.info.kind`, and every
 * kind maps to a distinct message (SPEC SRV-2, SRV-5).
 *
 * Classification uses the error JSON's `type`, never the HTTP status alone. Upstream answers
 * 403 for bad credentials, insufficient credentials and an expired token alike
 * (docs/protocol-notes.md §1.4).
 */
export type GuacErrorInfo =
  /** No HTTP response: DNS, refused, offline, timeout, or (browser only) TLS. */
  | { readonly kind: 'unreachable'; readonly url: string; readonly timedOut: boolean }
  /** TLS failure detected by the native HTTP stack. */
  | { readonly kind: 'tls'; readonly url: string }
  /** Something answered, but not like a Guacamole server (HTML, a proxy page, a 404). */
  | { readonly kind: 'not-guacamole'; readonly url: string; readonly status: number | undefined }
  /** The URL is not usable at all (empty, bad syntax, unsupported scheme). */
  | { readonly kind: 'invalid-url'; readonly reason: 'empty' | 'invalid' | 'unsupported-scheme' }
  /**
   * `INVALID_CREDENTIALS`: wrong username or password. `expected` carries the fields the
   * server listed; an SSO extension lists a `REDIRECT` field here (SRV-7).
   */
  | ({
      readonly kind: 'invalid-credentials';
      readonly expected?: readonly FieldDescriptor[];
    } & ServerDetail)
  /**
   * `INSUFFICIENT_CREDENTIALS`: the server wants more fields (TOTP, etc.). Render
   * `expected`, then call `login` again with the same credentials plus the new values.
   */
  | ({
      readonly kind: 'additional-credentials-required';
      readonly expected: readonly FieldDescriptor[];
    } & ServerDetail)
  /**
   * `PERMISSION_DENIED` on a session-scoped request: the token is unknown or expired. This is
   * indistinguishable upstream from a real permission denial.
   */
  | ({ readonly kind: 'session-expired' } & ServerDetail)
  /**
   * `PERMISSION_DENIED` on a management call while the session is still valid (checked with
   * `HEAD api/session`): the account may not do this (docs/protocol-notes.md §8.3).
   */
  | ({ readonly kind: 'permission-denied' } & ServerDetail)
  /** `NOT_FOUND` on a management call: the object no longer exists on the server. */
  | ({ readonly kind: 'not-found' } & ServerDetail)
  /** The server returned JSON of an unexpected shape on a known endpoint. */
  | { readonly kind: 'invalid-response'; readonly url: string; readonly detail: string }
  /**
   * Any other Guacamole error, for example `BAD_REQUEST` for a wrong TOTP code, or
   * `INTERNAL_ERROR`. Show `translatableMessage`/`message`.
   */
  | ({ readonly kind: 'server-error'; readonly type: ApiErrorType } & ServerDetail);

export type GuacErrorKind = GuacErrorInfo['kind'];

interface ServerDetail {
  readonly status: number;
  readonly message: string | undefined;
  readonly translatableMessage: TranslatableMessage | undefined;
}

export class GuacApiError extends Error {
  readonly info: GuacErrorInfo;
  /**
   * Set by `GuacApi.probe` when no scheme was typed and every https candidate failed: the
   * caller may offer "Use http instead — not encrypted" and probe again with `allowHttp`.
   * Nothing was sent over http (AUDIT #11).
   */
  httpFallbackAvailable = false;

  constructor(info: GuacErrorInfo, options?: ErrorOptions) {
    super(describe(info), options);
    this.name = 'GuacApiError';
    this.info = info;
  }

  get kind(): GuacErrorKind {
    return this.info.kind;
  }
}

export function isGuacApiError(err: unknown, kind?: GuacErrorKind): err is GuacApiError {
  return err instanceof GuacApiError && (kind === undefined || err.info.kind === kind);
}

/** Maps a parsed Guacamole error body to the taxonomy. */
export function errorFromApiBody(
  body: ApiErrorBody,
  status: number,
  sessionScoped: boolean,
): GuacErrorInfo {
  const detail: ServerDetail = {
    status,
    message: body.message,
    translatableMessage: body.translatableMessage,
  };
  switch (body.type) {
    case 'INVALID_CREDENTIALS':
      return body.expected.length > 0
        ? { kind: 'invalid-credentials', expected: body.expected, ...detail }
        : { kind: 'invalid-credentials', ...detail };
    case 'INSUFFICIENT_CREDENTIALS':
      return { kind: 'additional-credentials-required', expected: body.expected, ...detail };
    case 'PERMISSION_DENIED':
      if (sessionScoped) return { kind: 'session-expired', ...detail };
      return { kind: 'server-error', type: body.type, ...detail };
    default:
      return { kind: 'server-error', type: body.type, ...detail };
  }
}

function describe(info: GuacErrorInfo): string {
  switch (info.kind) {
    case 'unreachable':
      return info.timedOut ? `Timed out contacting ${info.url}` : `Cannot reach ${info.url}`;
    case 'tls':
      return `Secure connection to ${info.url} failed`;
    case 'not-guacamole':
      return `${info.url} does not look like a Guacamole server`;
    case 'invalid-url':
      return `Invalid server URL (${info.reason})`;
    case 'invalid-response':
      return `Unexpected response from ${info.url}: ${info.detail}`;
    case 'invalid-credentials':
      return 'Invalid username or password';
    case 'additional-credentials-required':
      return `Additional credentials required: ${info.expected.map((f) => f.name).join(', ')}`;
    case 'session-expired':
      return 'Session expired';
    case 'permission-denied':
      return 'Permission denied';
    case 'not-found':
      return 'Not found';
    case 'server-error':
      return info.message ?? `Server error (${info.type})`;
  }
}
