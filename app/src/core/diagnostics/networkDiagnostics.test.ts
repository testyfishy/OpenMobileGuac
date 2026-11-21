import { describe, expect, it } from 'vitest';
import { describeNetwork } from './deviceInfo.ts';
import { LoggingHttpClient, describeConnection } from './LoggingHttpClient.ts';
import { Logger } from './log.ts';
import {
  describeClose,
  instrumentWebSockets,
  logNativeSocketClose,
} from './webSocketDiagnostics.ts';
import type { HttpClient, HttpResponse } from '../http/HttpClient.ts';

describe('describeConnection', () => {
  it('says whether a connection was reused, and how long a new one took', () => {
    expect(describeConnection(undefined)).toBe('');
    expect(describeConnection({ path: 'capacitor' })).toBe(', capacitor');
    expect(describeConnection({ path: 'pooled', reused: true, protocol: 'h2' })).toBe(
      ', pooled, reused connection, h2',
    );
    expect(describeConnection({ path: 'pinned', reused: false, connectMs: 40, tlsMs: 85 })).toBe(
      ', pinned, new connection: connect 40 ms, TLS 85 ms',
    );
  });
});

describe('LoggingHttpClient', () => {
  it('logs the connection path and how many requests were in flight alongside', async () => {
    const log = new Logger();
    let release: (r: HttpResponse) => void = () => undefined;
    const inner: HttpClient = {
      request: (req) =>
        req.url.endsWith('/slow')
          ? new Promise<HttpResponse>((r) => {
              release = r;
            })
          : Promise.resolve({
              status: 200,
              headers: {},
              body: null,
              connection: { path: 'pooled', reused: true },
            }),
    };
    const http = new LoggingHttpClient(inner, log, () => 0);
    const slow = http.request({ method: 'GET', url: 'https://h.example.test/api/slow' });
    await http.request({ method: 'GET', url: 'https://h.example.test/api/fast?token=x' });
    release({ status: 200, headers: {}, body: null });
    await slow;
    const lines = log.entries().map((e) => e.message);
    expect(lines[0]).toBe(
      'GET https://h.example.test/api/fast → 200 (0 ms, pooled, reused connection, 1 other in flight)',
    );
    expect(lines[1]).toBe('GET https://h.example.test/api/slow → 200 (0 ms, 0 other in flight)');
  });
});

describe('describeNetwork', () => {
  it('reports online state, connection type when known, and the REST path', () => {
    expect(describeNetwork({ onLine: true }, 'native connection pool (keep-alive)')).toBe(
      'online; connection type not reported by this WebView; REST: native connection pool (keep-alive)',
    );
    expect(
      describeNetwork(
        { onLine: false, connection: { type: 'cellular', effectiveType: '4g', rtt: 150 } },
        'CapacitorHttp',
      ),
    ).toBe('offline; cellular/4g, rtt ~150 ms; REST: CapacitorHttp');
    expect(describeNetwork(undefined, 'fetch')).toBe(
      'online; connection type not reported by this WebView; REST: fetch',
    );
  });
});

describe('WebSocket close diagnostics', () => {
  it('describes a close without the URL', () => {
    expect(describeClose({ code: 1006, reason: '', wasClean: false }, 120, 30_120)).toBe(
      'WebSocket closed: code 1006, not clean, open 30 s',
    );
    expect(describeClose({ code: 1000, reason: '519\n', wasClean: true }, null, 50)).toBe(
      'WebSocket closed: code 1000, reason "519?", clean, never opened (50 ms)',
    );
  });

  it('wraps the WebSocket constructor once and logs open and close', () => {
    type Handler = (e: unknown) => void;
    class FakeSocket {
      static readonly OPEN = 1;
      readonly handlers = new Map<string, Handler[]>();
      readonly args: unknown[];
      constructor(...args: unknown[]) {
        this.args = args;
        sockets.push(this);
      }
      addEventListener(type: string, fn: Handler) {
        this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
      }
      fire(type: string, e: unknown) {
        for (const h of this.handlers.get(type) ?? []) h(e);
      }
    }
    const sockets: FakeSocket[] = [];
    const target: { WebSocket?: unknown } = { WebSocket: FakeSocket };
    const log = new Logger();
    let now = 0;
    instrumentWebSockets(target, log, () => now);
    const Wrapped = target.WebSocket as typeof FakeSocket;
    instrumentWebSockets(target, log, () => now);
    expect(target.WebSocket).toBe(Wrapped);
    expect(Wrapped.OPEN).toBe(1);
    const s = new Wrapped('wss://h.example.test/websocket-tunnel?token=secret', 'guacamole');
    expect(s).toBeInstanceOf(FakeSocket);
    expect(s.args).toEqual(['wss://h.example.test/websocket-tunnel?token=secret', 'guacamole']);
    now = 200;
    s.fire('open', {});
    now = 10_200;
    s.fire('close', { code: 1006, reason: '', wasClean: false });
    const text = log
      .entries()
      .map((e) => `${e.level} ${e.message}`)
      .join('\n');
    expect(text).toContain('debug WebSocket open after 200 ms');
    expect(text).toContain('warn WebSocket closed: code 1006, not clean, open 10 s');
    expect(text).not.toContain('secret');
  });
});

describe('native tunnel close diagnostics', () => {
  it('logs the code and the plugin error once instrumentation is installed', () => {
    const log = new Logger();
    instrumentWebSockets({}, log);
    logNativeSocketClose({ code: 1006, reason: '', error: 'UNREACHABLE' });
    logNativeSocketClose({ code: 1000, reason: '' });
    expect(log.entries().map((e) => `${e.level} ${e.message}`)).toEqual([
      'warn native WebSocket closed: code 1006, not clean, error UNREACHABLE',
      'info native WebSocket closed: code 1000, clean',
    ]);
  });
});
