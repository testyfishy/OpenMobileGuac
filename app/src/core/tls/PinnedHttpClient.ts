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
} from '../http/HttpClient.ts';
import { nativeErrorCode, nativeErrorDer, type PinnedTlsPlugin } from './plugin.ts';

/**
 * A pinned server presented a certificate other than the trusted one. It is a `tls`
 * transport error, so the API layer reports it like any certificate failure; the UI then
 * inspects the server again and shows old vs new (`TlsTrustService.inspect`).
 */
export class CertificateMismatchError extends HttpTransportError {
  /** The presented leaf certificate, base64 DER, when native code supplied it. */
  readonly der: string | undefined;

  constructor(url: string, der: string | undefined, options?: ErrorOptions) {
    super('tls', url, 'The server presented a different certificate', options);
    this.name = 'CertificateMismatchError';
    this.der = der;
  }
}

/** `HttpClient` over the `PinnedTls` plugin for one request with the given pins. */
export async function pinnedRequest(
  plugin: PinnedTlsPlugin,
  req: HttpRequest,
  pins: readonly string[],
): Promise<HttpResponse> {
  if (pins.length === 0) throw new Error('pinnedRequest needs at least one pin');
  const url = withQuery(req.url, req.query);
  const headers: Record<string, string> = { ...req.headers };
  let data: string | undefined;
  if (req.body) {
    const serialized = serializeBody(req.body);
    headers['Content-Type'] = serialized.contentType;
    data = serialized.text;
  }
  let res;
  try {
    res = await plugin.request({
      url,
      method: req.method,
      headers,
      ...(data !== undefined ? { data } : {}),
      timeoutMs: req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      pins: [...pins],
    });
  } catch (err) {
    const code = nativeErrorCode(err);
    const message = err instanceof Error ? err.message : String(err);
    if (code === 'PIN_MISMATCH') {
      throw new CertificateMismatchError(url, nativeErrorDer(err), { cause: err });
    }
    const kind = code === 'TLS' ? 'tls' : code === 'TIMEOUT' ? 'timeout' : 'unreachable';
    throw new HttpTransportError(kind, url, message, { cause: err });
  }
  const responseHeaders = lowerCaseHeaders(res.headers ?? {});
  const body = decodeTextBody(res.data ?? '', responseHeaders['content-type']);
  return { status: res.status, headers: responseHeaders, body };
}

/** Looks up the pins that apply to a URL (empty: none). */
export interface PinLookup {
  pinsFor(url: string): Promise<readonly string[]>;
}

/**
 * Sends a request through the pinned native path only when the URL's scheme, host and port
 * have a trusted certificate; every other request goes to `system` unchanged, so servers
 * the OS already trusts behave exactly as without this feature.
 */
export class PinRoutingHttpClient implements HttpClient {
  private readonly system: HttpClient;
  private readonly plugin: PinnedTlsPlugin;
  private readonly lookup: PinLookup;

  constructor(system: HttpClient, plugin: PinnedTlsPlugin, lookup: PinLookup) {
    this.system = system;
    this.plugin = plugin;
    this.lookup = lookup;
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    const pins = await this.lookup.pinsFor(req.url).catch(() => []);
    if (pins.length === 0) return this.system.request(req);
    return pinnedRequest(this.plugin, req, pins);
  }
}
