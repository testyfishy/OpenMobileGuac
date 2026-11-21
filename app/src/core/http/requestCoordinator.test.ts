import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HttpTransportError,
  type HttpClient,
  type HttpRequest,
  type HttpResponse,
} from './HttpClient.ts';
import { PooledNativeHttpClient } from './PooledNativeHttpClient.ts';
import { RequestCoordinator, defaultCacheable } from './RequestCoordinator.ts';
import { createHttpClient } from '../platform.ts';
import { NativeHttpClient } from './NativeHttpClient.ts';
import type { NativeSystemRequest, NativeTlsResponse, PinnedTlsPlugin } from '../tls/plugin.ts';

const BASE = 'https://guac.example.test:8443/guacamole';
const ok = (body: unknown = { ok: 1 }): HttpResponse => ({ status: 200, headers: {}, body });

/** A client whose requests stay open until the test settles them. */
function manualClient() {
  const pending: {
    req: HttpRequest;
    resolve: (r: HttpResponse) => void;
    reject: (e: unknown) => void;
  }[] = [];
  const client: HttpClient = {
    request: (req) =>
      new Promise<HttpResponse>((resolve, reject) => {
        pending.push({ req, resolve, reject });
      }),
  };
  return { client, pending };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

afterEach(() => {
  vi.useRealTimers();
});

describe('RequestCoordinator', () => {
  it('shares one in-flight GET between identical requests (same token)', async () => {
    const m = manualClient();
    const c = new RequestCoordinator(m.client);
    const req: HttpRequest = {
      method: 'GET',
      url: `${BASE}/api/session/data/postgresql/activeConnections`,
      headers: { 'Guacamole-Token': 't1' },
    };
    const a = c.request(req);
    const b = c.request({ ...req });
    const other = c.request({ ...req, headers: { 'Guacamole-Token': 't2' } });
    expect(m.pending).toHaveLength(2);
    m.pending[0]?.resolve(ok('A'));
    m.pending[1]?.resolve(ok('B'));
    expect((await a).body).toBe('A');
    expect((await b).body).toBe('A');
    expect((await other).body).toBe('B');
    // Not cacheable: the next one goes to the network again.
    void c.request(req);
    expect(m.pending).toHaveLength(3);
  });

  it('never shares or caches writes', async () => {
    const m = manualClient();
    const c = new RequestCoordinator(m.client);
    const post: HttpRequest = {
      method: 'POST',
      url: `${BASE}/api/tokens`,
      body: { kind: 'form', fields: { token: 'x' } },
    };
    void c.request(post);
    void c.request(post);
    expect(m.pending).toHaveLength(2);
  });

  it('caches permission and connection lookups briefly; a write to the server drops them', async () => {
    let now = 1000;
    const calls: string[] = [];
    const inner: HttpClient = {
      request: async (req) => {
        calls.push(`${req.method} ${req.url}`);
        return ok(calls.length);
      },
    };
    const c = new RequestCoordinator(inner, { now: () => now, cacheMs: 4000 });
    const perms: HttpRequest = {
      method: 'GET',
      url: `${BASE}/api/session/data/postgresql/self/effectivePermissions`,
      headers: { 'Guacamole-Token': 't' },
    };
    expect((await c.request(perms)).body).toBe(1);
    now += 3000;
    expect((await c.request(perms)).body).toBe(1);
    now += 1500;
    expect((await c.request(perms)).body).toBe(2);
    await c.request({
      method: 'PATCH',
      url: `${BASE}/api/session/data/postgresql/activeConnections`,
    });
    expect((await c.request(perms)).body).toBe(4);
    expect(calls).toHaveLength(4);
  });

  it('does not cache failures', async () => {
    let n = 0;
    const inner: HttpClient = {
      request: async () => ({ status: n++ === 0 ? 500 : 200, headers: {}, body: null }),
    };
    const c = new RequestCoordinator(inner);
    const req: HttpRequest = { method: 'GET', url: `${BASE}/api/session/data/x/connections/1` };
    expect((await c.request(req)).status).toBe(500);
    expect((await c.request(req)).status).toBe(200);
  });

  it('knows which paths are cacheable', () => {
    expect(defaultCacheable('/guacamole/api/session/data/pg/self/effectivePermissions')).toBe(true);
    expect(defaultCacheable('/guacamole/api/session/data/pg/connections/12')).toBe(true);
    expect(defaultCacheable('/guacamole/api/session/data/pg/connections/12/parameters')).toBe(
      false,
    );
    expect(defaultCacheable('/guacamole/api/session/data/pg/connectionGroups/ROOT/tree')).toBe(
      false,
    );
  });

  it('limits background requests per server and sends waiting foreground ones first', async () => {
    const m = manualClient();
    const c = new RequestCoordinator(m.client, { maxPerOrigin: 3, maxBackgroundPerOrigin: 1 });
    const bg = (i: number): HttpRequest => ({
      method: 'GET',
      url: `${BASE}/api/session/data/pg/connections/${i}`,
      priority: 'background',
    });
    const fg = (i: number): HttpRequest => ({
      method: 'GET',
      url: `${BASE}/api/session/data/pg/connectionGroups/ROOT/tree?${i}`,
    });
    void c.request(bg(1));
    void c.request(bg(2));
    void c.request(bg(3));
    expect(m.pending.map((p) => p.req.url)).toEqual([bg(1).url]);
    void c.request(fg(1));
    void c.request(fg(2));
    expect(m.pending).toHaveLength(3);
    void c.request(fg(3));
    expect(m.pending).toHaveLength(3);
    expect(c.activeCount).toBe(3);
    // A slot frees up: the waiting foreground request goes before the waiting background ones.
    m.pending[1]?.resolve(ok());
    await flush();
    expect(m.pending[3]?.req.url).toBe(fg(3).url);
    // The background slot frees up: the next background request may go.
    m.pending[0]?.resolve(ok());
    await flush();
    expect(m.pending[4]?.req.url).toBe(bg(2).url);
    // Another server is not held up by this one.
    void c.request({
      method: 'GET',
      url: 'https://other.example.test/api/x',
      priority: 'background',
    });
    expect(m.pending[5]?.req.url).toBe('https://other.example.test/api/x');
  });

  it('moves a queued background GET up when a foreground caller joins it', async () => {
    const m = manualClient();
    const c = new RequestCoordinator(m.client, { maxPerOrigin: 2, maxBackgroundPerOrigin: 1 });
    const count: HttpRequest = {
      method: 'GET',
      url: `${BASE}/api/session/data/pg/connections/7`,
      headers: { 'Guacamole-Token': 't' },
    };
    void c.request({
      ...count,
      url: `${BASE}/api/session/data/pg/connections/1`,
      priority: 'background',
    });
    const badge = c.request({ ...count, priority: 'background' });
    expect(m.pending).toHaveLength(1);
    // The in-use check asks for the same thing in the foreground: it is sent now.
    const check = c.request(count);
    await flush();
    expect(m.pending.map((x) => x.req.url)).toEqual([
      `${BASE}/api/session/data/pg/connections/1`,
      count.url,
    ]);
    m.pending[1]?.resolve(ok(3));
    expect((await check).body).toBe(3);
    expect((await badge).body).toBe(3);
  });

  it('does not share or cache a read that overlapped a write to the same server', async () => {
    const m = manualClient();
    const c = new RequestCoordinator(m.client);
    const perms: HttpRequest = {
      method: 'GET',
      url: `${BASE}/api/session/data/pg/self/effectivePermissions`,
    };
    const before = c.request(perms);
    const write = c.request({ method: 'PUT', url: `${BASE}/api/session/data/pg/connections/1` });
    void c.request(perms);
    expect(m.pending).toHaveLength(3);
    m.pending[0]?.resolve(ok('old'));
    m.pending[1]?.resolve(ok());
    await before;
    await write;
    m.pending[2]?.resolve(ok('new'));
    await flush();
    // Both reads overlapped the write (the server may have answered either first): neither
    // is cached, so the next read asks again.
    void c.request(perms);
    expect(m.pending).toHaveLength(4);
  });

  it('gives up after the timeout plus a grace period with a timeout transport error', async () => {
    vi.useFakeTimers();
    const m = manualClient();
    const c = new RequestCoordinator(m.client, { deadlineGraceMs: 500 });
    const p = c.request({ method: 'POST', url: `${BASE}/api/tokens`, timeoutMs: 1000 });
    const caught = p.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1499);
    expect(c.activeCount).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    const err = await caught;
    expect(err).toBeInstanceOf(HttpTransportError);
    expect(err).toMatchObject({ kind: 'timeout' });
    expect(c.activeCount).toBe(0);
    // A late answer changes nothing.
    m.pending[0]?.resolve(ok());
  });
});

function fakePlugin(impl: (o: NativeSystemRequest) => Promise<NativeTlsResponse>) {
  const calls: NativeSystemRequest[] = [];
  const plugin: Pick<PinnedTlsPlugin, 'systemRequest'> = {
    systemRequest: (o) => {
      calls.push(o);
      return impl(o);
    },
  };
  return { plugin, calls };
}

function fallbackClient() {
  const calls: HttpRequest[] = [];
  const client: HttpClient = {
    request: async (req) => {
      calls.push(req);
      return { status: 200, headers: {}, body: 'fallback' };
    },
  };
  return { client, calls };
}

const rejection = (code: string) => Object.assign(new Error(code), { code });

describe('PooledNativeHttpClient', () => {
  it('sends through the native pool and reports connection reuse', async () => {
    const { plugin, calls } = fakePlugin(async () => ({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      data: '{"a":1}',
      reused: true,
      protocol: 'h2',
    }));
    const fb = fallbackClient();
    const res = await new PooledNativeHttpClient(plugin, fb.client).request({
      method: 'POST',
      url: `${BASE}/api/tokens`,
      query: { x: 'y' },
      headers: { 'Guacamole-Token': 't' },
      body: { kind: 'form', fields: { username: 'u' } },
      timeoutMs: 1234,
    });
    expect(calls[0]).toEqual({
      url: `${BASE}/api/tokens?x=y`,
      method: 'POST',
      headers: { 'Guacamole-Token': 't', 'Content-Type': 'application/x-www-form-urlencoded' },
      data: 'username=u',
      timeoutMs: 1234,
    });
    expect(res).toEqual({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { a: 1 },
      connection: { path: 'pooled', reused: true, protocol: 'h2' },
    });
    expect(fb.calls).toHaveLength(0);
  });

  it('falls back to CapacitorHttp for good when the native method is missing', async () => {
    const { plugin, calls } = fakePlugin(async () => {
      throw rejection('UNIMPLEMENTED');
    });
    const fb = fallbackClient();
    const why: string[] = [];
    const client = new PooledNativeHttpClient(plugin, fb.client, (w) => why.push(w));
    const req: HttpRequest = { method: 'GET', url: `${BASE}/api/languages` };
    expect((await client.request(req)).body).toBe('fallback');
    expect((await client.request(req)).body).toBe('fallback');
    expect(calls).toHaveLength(1);
    expect(fb.calls).toHaveLength(2);
    expect(why).toEqual(['UNIMPLEMENTED']);
    expect(client.pooled).toBe(false);
  });

  it('never re-sends a request that may have reached the server', async () => {
    for (const [code, kind] of [
      ['TIMEOUT', 'timeout'],
      ['TLS', 'tls'],
      ['UNREACHABLE', 'unreachable'],
      ['OTHER', 'unreachable'],
    ] as const) {
      const { plugin } = fakePlugin(async () => {
        throw rejection(code);
      });
      const fb = fallbackClient();
      const err = await new PooledNativeHttpClient(plugin, fb.client)
        .request({ method: 'POST', url: `${BASE}/api/tokens` })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpTransportError);
      expect(err).toMatchObject({ kind });
      expect(fb.calls).toHaveLength(0);
    }
  });
});

describe('PooledNativeHttpClient BAD_REQUEST', () => {
  it('falls back for that request only', async () => {
    let n = 0;
    const { plugin, calls } = fakePlugin(async () => {
      if (n++ === 0) throw rejection('BAD_REQUEST');
      return { status: 204, headers: {}, data: '' };
    });
    const fb = fallbackClient();
    const client = new PooledNativeHttpClient(plugin, fb.client);
    expect((await client.request({ method: 'GET', url: `${BASE}/a` })).body).toBe('fallback');
    expect((await client.request({ method: 'GET', url: `${BASE}/b` })).status).toBe(204);
    expect(calls).toHaveLength(2);
    expect(client.pooled).toBe(true);
  });
});

describe('createHttpClient on iOS', () => {
  const plugin = { systemRequest: async () => ({ status: 200, headers: {}, data: '' }) };
  it('uses the native pool on iOS only', () => {
    const p = plugin as unknown as PinnedTlsPlugin;
    expect(createHttpClient({ native: true, platform: 'ios' }, { plugin: p })).toBeInstanceOf(
      PooledNativeHttpClient,
    );
    expect(createHttpClient({ native: true, platform: 'android' }, { plugin: p })).toBeInstanceOf(
      NativeHttpClient,
    );
    expect(createHttpClient({ native: true, platform: 'ios' })).toBeInstanceOf(NativeHttpClient);
  });
});
