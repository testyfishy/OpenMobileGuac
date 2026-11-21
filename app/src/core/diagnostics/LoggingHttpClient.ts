import {
  HttpTransportError,
  type HttpClient,
  type HttpConnectionInfo,
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

  /** Requests on the network right now (sent and not answered). */
  private active = 0;

  async request(req: HttpRequest): Promise<HttpResponse> {
    const started = this.now();
    const where = describeUrl(req.url);
    this.active++;
    // How many were already on the network when this one started (DIAG: contention).
    const alongside = this.active - 1;
    try {
      const res = await this.inner.request(req);
      const ms = this.now() - started;
      this.log.log(
        res.status >= 500 ? 'warn' : 'debug',
        'http',
        `${req.method} ${where} → ${res.status} (${ms} ms${describeConnection(res.connection)}, ${alongside} other in flight)`,
      );
      return res;
    } catch (err) {
      const kind = err instanceof HttpTransportError ? err.kind : 'error';
      this.log.warn(
        'http',
        `${req.method} ${where} failed: ${kind} (${this.now() - started} ms, ${alongside} other in flight)`,
      );
      throw err;
    } finally {
      this.active--;
    }
  }
}

/** `, pooled, reused` / `, pooled, new connection: connect 40 ms, TLS 85 ms, h2`. */
export function describeConnection(c: HttpConnectionInfo | undefined): string {
  if (!c) return '';
  const parts: string[] = [c.path];
  if (c.reused === true) parts.push('reused connection');
  else if (c.reused === false) {
    const times: string[] = [];
    if (c.connectMs !== undefined) times.push(`connect ${c.connectMs} ms`);
    if (c.tlsMs !== undefined) times.push(`TLS ${c.tlsMs} ms`);
    parts.push(times.length > 0 ? `new connection: ${times.join(', ')}` : 'new connection');
  }
  if (c.protocol) parts.push(c.protocol);
  return `, ${parts.join(', ')}`;
}

/**
 * `https://host:port/path` with the query and fragment removed, and the user or group name
 * after `/users/` or `/userGroups/` replaced (a change of password puts it in the path).
 */
export function describeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const path = u.pathname.replace(/(\/users|\/userGroups)\/[^/]+/g, '$1/<user>');
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return '(invalid url)';
  }
}
