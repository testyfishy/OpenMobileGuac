import { describe, expect, it } from 'vitest';
import { HttpTransportError, type HttpClient, type HttpRequest } from '../http/HttpClient.ts';
import { probeWebSocket, runConnectionTest, type WebSocketLike } from './connectionTest.ts';
import { describeWebView, parseWebView } from './deviceInfo.ts';
import { Logger, filterByLevel, formatLog, redactHosts, redactSecrets } from './log.ts';
import { describeUrl } from './LoggingHttpClient.ts';

describe('redaction', () => {
  it('removes token, password and SSO values', () => {
    const s = redactSecrets(
      'POST /api/tokens username=alice&password=hunter2 token=abc123 id_token=eyJx.y.z Guacamole-Token: 0123ABCD',
    );
    expect(s).not.toContain('hunter2');
    expect(s).not.toContain('abc123');
    expect(s).not.toContain('eyJx');
    expect(s).not.toContain('0123ABCD');
    expect(s).toContain('username=alice');
  });

  it('removes long opaque strings and otpauth URIs', () => {
    const s = redactSecrets(
      'got 8C6A1F0E2B3D4C5E6F708192A3B4C5D6E7F8091A2B3C4D5E6F708192 and otpauth://totp/x?secret=ABC',
    );
    expect(s).toBe('got [redacted] and otpauth://[redacted]');
  });

  it.each([
    ['prose', 'the password is hunter2 now', 'hunter2'],
    ['prose token', 'token was 0a1b2c3d', '0a1b2c3d'],
    ['userinfo', 'GET https://testuser:hunter2@guac.example/x', 'hunter2'],
    ['bearer header', 'Authorization: Bearer abc.def.ghi', 'abc.def'],
    ['bearer bare', 'sent Bearer sometokenvalue', 'sometokenvalue'],
    ['pwd', 'login pwd=hunter2&user=x', 'hunter2'],
    ['passphrase', '{"passphrase":"correct horse"}', 'correct'],
    ['json password', '{"password": "hunter2"}', 'hunter2'],
    ['tunnel token', 'Guacamole-Tunnel-Token: 1234-abcd', '1234-abcd'],
    ['totp seed', 'seed=JBSWY3DPEHPK3PXP', 'JBSWY3DP'],
  ])('closes the %s gap (AUDIT DIAG-1)', (_label, input, secret) => {
    expect(redactSecrets(input)).not.toContain(secret);
  });

  it('keeps user names and ordinary text', () => {
    expect(redactSecrets('GET https://testuser:hunter2@guac.example/x')).toContain('testuser');
    expect(redactSecrets('connected for 12:30:45')).toBe('connected for 12:30:45');
  });

  it.each([
    ['fe80::1', 'link-local'],
    ['::1', 'loopback'],
    ['2001:db8::5%en0', 'zone'],
    ['2001:db8:0:0:0:0:0:1', 'full'],
    ['[fe80::1]:8080', 'bracketed'],
  ])('hides compressed IPv6 %s (%s)', (addr) => {
    expect(redactHosts(`from ${addr} ok`)).not.toMatch(/fe80|::1|db8/);
  });

  it('does not treat times or C++ names as IPv6', () => {
    expect(redactHosts('at 12:30:45 in Foo::bar')).toBe('at 12:30:45 in Foo::bar');
  });

  it('optionally hides hosts and addresses', () => {
    const s = redactHosts(
      'GET https://guac.example:8443/guacamole/api from 192.0.2.20 via host.example.ts.net',
    );
    expect(s).toBe('GET https://<host>:8443/guacamole/api from <ip> via <host>');
  });
});

describe('Logger', () => {
  it('keeps a bounded buffer, notifies, filters and formats', () => {
    let t = 0;
    const log = new Logger({ capacity: 3, now: () => (t += 1000) });
    let notified = 0;
    const off = log.subscribe(() => notified++);
    log.debug('a', 'one');
    log.info('a', 'two');
    log.warn('b', 'three password=x');
    log.error('b', 'four');
    off();
    expect(notified).toBe(4);
    expect(log.entries().map((e) => e.message)).toEqual([
      'two',
      'three password=[redacted]',
      'four',
    ]);
    expect(filterByLevel(log.entries(), 'warn')).toHaveLength(2);
    expect(formatLog(log.entries(), { hideHosts: true, minLevel: 'error' })).toMatch(
      /^1970-01-01T00:00:04.000Z ERROR \[b\] four$/,
    );
  });
});

describe('describeUrl', () => {
  it('drops query and fragment', () => {
    expect(describeUrl('https://guac.example/guacamole/api/tokens?token=abc#x')).toBe(
      'https://guac.example/guacamole/api/tokens',
    );
  });
});

describe('device info', () => {
  it('recognises Android WebView, iOS WKWebView and desktop Chrome', () => {
    const android = parseWebView(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.6778.39 Mobile Safari/537.36',
    );
    expect(describeWebView(android)).toBe('Android System WebView 131.0.6778.39');
    const ios = parseWebView(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    );
    expect(describeWebView(ios)).toBe('WKWebView 17.4');
    const chrome = parseWebView(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    );
    expect(describeWebView(chrome)).toBe('Chromium 131.0.0.0');
  });
});

class FakeWs implements WebSocketLike {
  onopen: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  closed = false;
  close(): void {
    this.closed = true;
  }
}

function http(
  handler: (req: HttpRequest) => { status: number; body: unknown } | Error,
): HttpClient {
  return {
    request: async (req) => {
      const r = handler(req);
      if (r instanceof Error) throw r;
      return { status: r.status, headers: {}, body: r.body };
    },
  };
}

describe('connection test', () => {
  it('reports the working candidate, API, websocket and latency', async () => {
    let t = 0;
    const sockets: { url: string; ws: FakeWs }[] = [];
    // Typed http:// (no scheme would try only https, AUDIT #11).
    const result = await runConnectionTest('http://guac.example:8080', {
      http: http((req) =>
        req.url.startsWith('https://')
          ? new HttpTransportError('unreachable', req.url, 'refused')
          : req.url.includes('/guacamole/')
            ? { status: 200, body: { en: 'English' } }
            : { status: 404, body: 'Not found' },
      ),
      now: () => (t += 10),
      openWebSocket: (url) => {
        const ws = new FakeWs();
        sockets.push({ url, ws });
        queueMicrotask(() => ws.onopen?.({}));
        return ws;
      },
    });
    expect(result.api).toBe('ok');
    expect(result.workingUrl).toMatch(/^http:\/\/guac\.example:8080\/guacamole$/);
    expect(result.candidates[0]).toMatchObject({ status: 'ok' });
    expect(result.websocket).toBe('ok');
    expect(sockets[0]?.url).toBe('ws://guac.example:8080/guacamole/websocket-tunnel');
    expect(sockets[0]?.ws.closed).toBe(true);
    expect(result.latencyMs).toBe(10);
  });

  it('without a scheme, tries only https and lists http as skipped (AUDIT #11)', async () => {
    const urls: string[] = [];
    const result = await runConnectionTest('guac.example:8080', {
      http: http((req) => {
        urls.push(req.url);
        return new HttpTransportError('tls', req.url, 'cert');
      }),
    });
    expect(urls.every((u) => u.startsWith('https://'))).toBe(true);
    expect(result.candidates.filter((c) => c.baseUrl.startsWith('http:'))).toEqual([
      { baseUrl: 'http://guac.example:8080/guacamole', status: 'skipped' },
      { baseUrl: 'http://guac.example:8080', status: 'skipped' },
    ]);
  });

  it('fails cleanly for an unreachable host and skips the websocket step', async () => {
    const result = await runConnectionTest('https://unreachable.invalid', {
      http: http((req) => new HttpTransportError('unreachable', req.url, 'dns')),
      openWebSocket: () => {
        throw new Error('must not be called');
      },
    });
    expect(result.api).toBe('fail');
    expect(result.websocket).toBe('skipped');
    expect(result.workingUrl).toBeUndefined();
    expect(result.candidates.every((c) => c.failure === 'unreachable')).toBe(true);
  });

  it('labels a redirect as such (never followed)', async () => {
    const result = await runConnectionTest('https://guac.example/guacamole', {
      http: http(() => ({ status: 302, body: null })),
    });
    expect(result.api).toBe('fail');
    expect(result.candidates[0]).toMatchObject({ failure: 'redirected', httpStatus: 302 });
  });

  it('flags invalid input', async () => {
    const result = await runConnectionTest('', { http: http(() => ({ status: 200, body: {} })) });
    expect(result.invalid).toBe(true);
  });

  it('times out a websocket that never answers', async () => {
    const r = await probeWebSocket('ws://x', () => new FakeWs(), 5);
    expect(r).toEqual({ status: 'fail', detail: 'timeout' });
  });
});
