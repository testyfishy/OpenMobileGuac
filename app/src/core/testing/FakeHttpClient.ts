import type { HttpClient, HttpRequest, HttpResponse } from '../http/HttpClient.ts';

/**
 * A scripted `HttpClient` for tests. Each handler sees the request and returns a response, or
 * throws (for example an `HttpTransportError`). Unmatched requests fail the test loudly.
 */
export type FakeHandler = (req: HttpRequest) => HttpResponse | Promise<HttpResponse>;

export interface FakeRoute {
  readonly method: HttpRequest['method'];
  /** Exact URL (without query) or a predicate. */
  readonly url: string | ((url: string) => boolean);
  readonly handler: FakeHandler;
}

export class FakeHttpClient implements HttpClient {
  readonly requests: HttpRequest[] = [];
  private readonly routes: FakeRoute[] = [];

  on(method: HttpRequest['method'], url: FakeRoute['url'], handler: FakeHandler): this {
    this.routes.push({ method, url, handler });
    return this;
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    this.requests.push(req);
    // Later routes win, so a test can override a default.
    for (let i = this.routes.length - 1; i >= 0; i--) {
      const route = this.routes[i];
      if (!route || route.method !== req.method) continue;
      const matches = typeof route.url === 'string' ? route.url === req.url : route.url(req.url);
      if (matches) return route.handler(req);
    }
    throw new Error(`FakeHttpClient: no route for ${req.method} ${req.url}`);
  }
}

export function jsonResponse(status: number, body: unknown): HttpResponse {
  return { status, headers: { 'content-type': 'application/json' }, body };
}

export function textResponse(
  status: number,
  body: string,
  contentType = 'text/html',
): HttpResponse {
  return { status, headers: { 'content-type': contentType }, body };
}
