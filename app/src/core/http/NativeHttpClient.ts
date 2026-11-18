import {
  CapacitorHttp,
  type HttpOptions,
  type HttpResponse as CapHttpResponse,
} from '@capacitor/core';
import {
  DEFAULT_TIMEOUT_MS,
  HttpTransportError,
  decodeTextBody,
  lowerCaseHeaders,
  serializeBody,
  withQuery,
  type HttpClient,
  type HttpRequest,
  type HttpResponse,
  type HttpTransportErrorKind,
} from './HttpClient.ts';

/** The part of Capacitor's `CapacitorHttpPlugin` we use (types from `@capacitor/core` 8.6). */
export interface NativeHttpPlugin {
  request(options: HttpOptions): Promise<CapHttpResponse>;
}

/**
 * `HttpClient` over Capacitor's built-in native HTTP (`CapacitorHttp` from `@capacitor/core`).
 * Requests are made by the OS HTTP stack, so the WebView's CORS rules do not apply
 * (SPEC §8.3).
 *
 * Notes, checked against the installed `@capacitor/core` / `@capacitor/android` 8.6.2 sources:
 * - Bodies are sent as pre-encoded strings with an explicit `Content-Type`. Android's
 *   `CapacitorHttpUrlConnection.setRequestBody` writes a string body as-is for
 *   `application/x-www-form-urlencoded`.
 * - The query string is built here, not with `params`, so both HTTP clients encode it the same
 *   way.
 * - HTTP error statuses resolve normally. The plugin rejects only when there is no response.
 * - `data` is already parsed when the response content type is JSON, and is a string
 *   otherwise.
 *
 * Unverified: the error text for TLS failures. It is matched heuristically in
 * `classifyNativeError`. iOS has not been checked at all.
 */
export class NativeHttpClient implements HttpClient {
  private readonly plugin: NativeHttpPlugin;

  constructor(plugin: NativeHttpPlugin = CapacitorHttp) {
    this.plugin = plugin;
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    const url = withQuery(req.url, req.query);
    const headers: Record<string, string> = { ...req.headers };
    let data: string | undefined;
    if (req.body) {
      const serialized = serializeBody(req.body);
      headers['Content-Type'] = serialized.contentType;
      data = serialized.text;
    }
    const timeout = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    let res: CapHttpResponse;
    try {
      res = await this.plugin.request({
        url,
        method: req.method,
        headers,
        data,
        connectTimeout: timeout,
        readTimeout: timeout,
        responseType: 'text',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new HttpTransportError(classifyNativeError(message), url, message, { cause: err });
    }

    const responseHeaders = lowerCaseHeaders(res.headers);
    const raw: unknown = res.data;
    let body: unknown;
    if (raw === undefined || raw === null || raw === '') body = null;
    else if (typeof raw === 'string') body = decodeTextBody(raw, responseHeaders['content-type']);
    else body = raw;
    return { status: res.status, headers: responseHeaders, body };
  }
}

const TLS_PATTERN =
  /ssl|tls|certificate|cert ?path|x\.?509|handshake|trust anchor|not trusted|untrusted|-1202|-1200/i;
const TIMEOUT_PATTERN = /time(d)? ?out|-1001/i;

/** Heuristic mapping of native error text to a transport error kind. Unverified on iOS. */
export function classifyNativeError(message: string): HttpTransportErrorKind {
  if (TLS_PATTERN.test(message)) return 'tls';
  if (TIMEOUT_PATTERN.test(message)) return 'timeout';
  return 'unreachable';
}
