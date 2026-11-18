/**
 * The only way core code talks HTTP (SPEC §8.2). Implementations:
 * - `FetchHttpClient`: browser `fetch`, for dev mode (through the Vite proxy).
 * - `NativeHttpClient`: Capacitor's native HTTP, which is not subject to CORS.
 * Pick one with `createHttpClient()` in `core/platform.ts`.
 *
 * Contract:
 * - Any HTTP status, including 4xx/5xx, resolves with an `HttpResponse`.
 * - Failure to get a response at all rejects with `HttpTransportError`.
 */

export type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Form values; an array produces a repeated key (`a=1&a=2`). */
export type FormFields = Readonly<Record<string, string | readonly string[]>>;

export type HttpBody =
  | { readonly kind: 'form'; readonly fields: FormFields }
  | { readonly kind: 'json'; readonly value: unknown };

export interface HttpRequest {
  readonly method: HttpMethod;
  /** Absolute URL. Query parameters go in `query`, not here. */
  readonly url: string;
  readonly query?: FormFields;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: HttpBody;
  /** Overall timeout in milliseconds. Implementations default to `DEFAULT_TIMEOUT_MS`. */
  readonly timeoutMs?: number;
}

export interface HttpResponse {
  readonly status: number;
  /** Header names are lower-cased. */
  readonly headers: Readonly<Record<string, string>>;
  /**
   * Parsed JSON when the response is JSON and parses, otherwise the raw text. `null` when
   * the body is empty (for example 204, or HEAD).
   */
  readonly body: unknown;
}

export interface HttpClient {
  request(request: HttpRequest): Promise<HttpResponse>;
}

export const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Why no response was received.
 * - `unreachable`: DNS failure, connection refused, no route, offline, CORS block in a browser.
 * - `tls`: certificate or handshake failure. Only the native client can detect this; browser
 *   `fetch` reports TLS failures as `unreachable`.
 * - `timeout`: no response within the timeout.
 */
export type HttpTransportErrorKind = 'unreachable' | 'tls' | 'timeout';

export class HttpTransportError extends Error {
  readonly kind: HttpTransportErrorKind;
  readonly url: string;

  constructor(kind: HttpTransportErrorKind, url: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'HttpTransportError';
    this.kind = kind;
    this.url = url;
  }
}

/** `application/x-www-form-urlencoded` encoding, as jQuery's `$.param` produces for flat data. */
export function encodeForm(fields: FormFields): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    const values: readonly string[] = typeof value === 'string' ? [value] : value;
    for (const v of values) parts.push(`${formEscape(key)}=${formEscape(v)}`);
  }
  return parts.join('&');
}

function formEscape(s: string): string {
  return encodeURIComponent(s).replace(/%20/g, '+');
}

/** Appends `query` to `url`, keeping any query the URL already has. */
export function withQuery(url: string, query: FormFields | undefined): string {
  if (!query || Object.keys(query).length === 0) return url;
  const encoded = encodeForm(query);
  return url + (url.includes('?') ? '&' : '?') + encoded;
}

export function isJsonContentType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return mime === 'application/json' || mime.endsWith('+json');
}

/** Parses a text body according to its content type, falling back to the raw text. */
export function decodeTextBody(text: string, contentType: string | undefined): unknown {
  if (text.length === 0) return null;
  if (isJsonContentType(contentType)) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return text;
}

export function lowerCaseHeaders(
  headers: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = v;
  return out;
}

/** Content type and serialised body for a request body. */
export function serializeBody(body: HttpBody): { contentType: string; text: string } {
  if (body.kind === 'form') {
    return { contentType: 'application/x-www-form-urlencoded', text: encodeForm(body.fields) };
  }
  return { contentType: 'application/json', text: JSON.stringify(body.value) };
}
