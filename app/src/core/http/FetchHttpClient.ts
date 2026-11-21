import {
  DEFAULT_TIMEOUT_MS,
  HttpTransportError,
  OPAQUE_REDIRECT_STATUS,
  decodeTextBody,
  serializeBody,
  withQuery,
  type HttpClient,
  type HttpRequest,
  type HttpResponse,
} from './HttpClient.ts';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/**
 * `HttpClient` over the browser's `fetch`. Used in desktop-browser dev mode, where requests
 * go through the Vite dev proxy (Guacamole sends no CORS headers).
 *
 * Limitation: `fetch` reports DNS failure, refused connections, CORS blocks and TLS failures
 * all as the same `TypeError`, so TLS problems surface as `unreachable` here.
 */
export class FetchHttpClient implements HttpClient {
  private readonly fetchImpl: FetchLike;

  constructor(fetchImpl?: FetchLike) {
    this.fetchImpl = fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    const url = withQuery(req.url, req.query);
    const headers: Record<string, string> = { ...req.headers };
    let body: string | undefined;
    if (req.body) {
      const serialized = serializeBody(req.body);
      headers['Content-Type'] = serialized.contentType;
      body = serialized.text;
    }

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, req.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    try {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: req.method,
          headers,
          body,
          signal: controller.signal,
          credentials: 'omit',
          // Never replay a request (and its token header) to wherever the server points.
          redirect: 'manual',
        });
      } catch (err) {
        if (timedOut) {
          throw new HttpTransportError('timeout', url, 'Request timed out', { cause: err });
        }
        throw new HttpTransportError('unreachable', url, describe(err), { cause: err });
      }

      if (response.type === 'opaqueredirect') {
        // The browser hides the status and `Location` of a redirect it did not follow.
        return { status: OPAQUE_REDIRECT_STATUS, headers: {}, body: null };
      }
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key.toLowerCase()] = value;
      });
      let text = '';
      if (req.method !== 'HEAD') {
        try {
          text = await response.text();
        } catch (err) {
          const kind = timedOut ? 'timeout' : 'unreachable';
          throw new HttpTransportError(kind, url, describe(err), { cause: err });
        }
      }
      return {
        status: response.status,
        headers: responseHeaders,
        body: decodeTextBody(text, responseHeaders['content-type']),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
