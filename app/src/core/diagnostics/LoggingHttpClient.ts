import {
  HttpTransportError,
  type HttpClient,
  type HttpRequest,
  type HttpResponse,
} from '../http/HttpClient.ts';
import type { Logger } from './log.ts';

/**
 * Logs method, path, status and duration of every request. Never logs headers, bodies or
 * query values (they carry tokens and passwords).
 */
export class LoggingHttpClient implements HttpClient {
  private readonly inner: HttpClient;
  private readonly log: Logger;
  private readonly now: () => number;

  constructor(inner: HttpClient, log: Logger, now: () => number = () => Date.now()) {
    this.inner = inner;
    this.log = log;
    this.now = now;
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    const started = this.now();
    const where = describeUrl(req.url);
    try {
      const res = await this.inner.request(req);
      const ms = this.now() - started;
      this.log.log(
        res.status >= 500 ? 'warn' : 'debug',
        'http',
        `${req.method} ${where} → ${res.status} (${ms} ms)`,
      );
      return res;
    } catch (err) {
      const kind = err instanceof HttpTransportError ? err.kind : 'error';
      this.log.warn('http', `${req.method} ${where} failed: ${kind} (${this.now() - started} ms)`);
      throw err;
    }
  }
}

/** `https://host:port/path` with the query and fragment removed. */
export function describeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return '(invalid url)';
  }
}
