import type { NativeTlsResponse, PinnedTlsPlugin } from '../tls/plugin.ts';
import {
  DEFAULT_TIMEOUT_MS,
  HttpTransportError,
  decodeTextBody,
  lowerCaseHeaders,
  serializeBody,
  withQuery,
  type HttpClient,
  type HttpConnectionInfo,
  type HttpRequest,
  type HttpResponse,
} from './HttpClient.ts';

/**
 * iOS REST over the app's own plugin (`PinnedTls.systemRequest`): the operating system's
 * trust, one long-lived URLSession per origin, redirects refused in the session delegate.
 *
 * Why (checked in `@capacitor/ios` 8.6 `CapacitorUrlRequest.getUrlSession`): CapacitorHttp
 * with `disableRedirects: true` creates `URLSession(configuration: .default, delegate:)` for
 * every request and invalidates it when the request ends, so no connection is ever reused:
 * every REST call pays a new TCP and TLS handshake. Without `disableRedirects` it uses
 * `URLSession.shared` (keep-alive), but then follows redirects and re-sends custom headers
 * such as `Guacamole-Token` (and, on 307/308, the POST body with the password) to the
 * target: not acceptable (docs/AUDIT.md §7).
 *
 * Fallback: when native code lacks the method (`UNIMPLEMENTED`, an older native build),
 * nothing was sent; the request goes to `fallback` (CapacitorHttp with `disableRedirects`)
 * and so does every later one in this run. When it refuses one request's arguments
 * (`BAD_REQUEST`, also before sending), only that request falls back. Any other
 * failure is reported as-is, never retried: a POST that timed out may have reached the server
 * (a sign-in, a used TOTP code).
 */
export class PooledNativeHttpClient implements HttpClient {
  private readonly plugin: Pick<PinnedTlsPlugin, 'systemRequest'>;
  private readonly fallback: HttpClient;
  private readonly onFallback: ((reason: string) => void) | undefined;
  private disabled = false;

  constructor(
    plugin: Pick<PinnedTlsPlugin, 'systemRequest'>,
    fallback: HttpClient,
    onFallback?: (reason: string) => void,
  ) {
    this.plugin = plugin;
    this.fallback = fallback;
    this.onFallback = onFallback;
  }

  /** False once the native path was found missing in this run. */
  get pooled(): boolean {
    return !this.disabled;
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    if (this.disabled) return this.fallback.request(req);
    const url = withQuery(req.url, req.query);
    const headers: Record<string, string> = { ...req.headers };
    let data: string | undefined;
    if (req.body) {
      const serialized = serializeBody(req.body);
      headers['Content-Type'] = serialized.contentType;
      data = serialized.text;
    }
    let res: NativeTlsResponse;
    try {
      res = await this.plugin.systemRequest({
        url,
        method: req.method,
        headers,
        ...(data !== undefined ? { data } : {}),
        timeoutMs: req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
    } catch (err) {
      const code = rawCode(err);
      const message = err instanceof Error ? err.message : String(err);
      if (code === 'UNIMPLEMENTED') {
        // An older native build: CapacitorHttp for the rest of this run.
        this.disabled = true;
        this.onFallback?.(code);
        return this.fallback.request(req);
      }
      if (code === 'BAD_REQUEST') {
        // Native code refused this URL before sending anything: this request only.
        this.onFallback?.(code);
        return this.fallback.request(req);
      }
      const kind = code === 'TLS' ? 'tls' : code === 'TIMEOUT' ? 'timeout' : 'unreachable';
      throw new HttpTransportError(kind, url, message, { cause: err });
    }
    const responseHeaders = lowerCaseHeaders(res.headers ?? {});
    const body = decodeTextBody(res.data ?? '', responseHeaders['content-type']);
    return {
      status: res.status,
      headers: responseHeaders,
      body,
      connection: connectionInfo('pooled', res),
    };
  }
}

function rawCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/** Diagnostics from native metrics (fields the platform did not report stay undefined). */
export function connectionInfo(
  path: HttpConnectionInfo['path'],
  res: Pick<NativeTlsResponse, 'reused' | 'protocol' | 'connectMs' | 'tlsMs'>,
): HttpConnectionInfo {
  return {
    path,
    ...(typeof res.reused === 'boolean' ? { reused: res.reused } : {}),
    ...(typeof res.protocol === 'string' && res.protocol ? { protocol: res.protocol } : {}),
    ...(typeof res.connectMs === 'number' ? { connectMs: res.connectMs } : {}),
    ...(typeof res.tlsMs === 'number' ? { tlsMs: res.tlsMs } : {}),
  };
}
