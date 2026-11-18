import type { HttpOptions, HttpResponse as CapHttpResponse } from '@capacitor/core';
import { describe, expect, it } from 'vitest';
import { createHttpClient, createSecureStore } from '../platform.ts';
import { FetchHttpClient, type FetchLike } from './FetchHttpClient.ts';
import { HttpTransportError, encodeForm, withQuery } from './HttpClient.ts';
import { NativeHttpClient, classifyNativeError } from './NativeHttpClient.ts';
import { NativeSecureStore } from '../storage/NativeSecureStore.ts';

describe('form and query encoding', () => {
  it('encodes like jQuery $.param for flat data', () => {
    expect(encodeForm({ username: 'a b', password: 'p&=+?', multi: ['1', '2'] })).toBe(
      'username=a+b&password=p%26%3D%2B%3F&multi=1&multi=2',
    );
    expect(withQuery('https://guac.example/x', { permission: ['READ', 'UPDATE'] })).toBe(
      'https://guac.example/x?permission=READ&permission=UPDATE',
    );
    expect(withQuery('https://guac.example/x?a=1', { b: '2' })).toBe(
      'https://guac.example/x?a=1&b=2',
    );
    expect(withQuery('https://guac.example/x', {})).toBe('https://guac.example/x');
  });
});

describe('FetchHttpClient', () => {
  it('sends form bodies and parses JSON responses', async () => {
    const calls: [string, RequestInit][] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push([url, init]);
      return new Response(JSON.stringify({ authToken: 't' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    const res = await new FetchHttpClient(fetchImpl).request({
      method: 'POST',
      url: 'https://guac.example/guacamole/api/tokens',
      body: { kind: 'form', fields: { username: 'u' } },
    });
    expect(res).toEqual({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { authToken: 't' },
    });
    const [, init] = calls[0] ?? [];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('username=u');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
    expect(init?.credentials).toBe('omit');
  });

  it('resolves HTTP errors and returns text for non-JSON', async () => {
    const fetchImpl: FetchLike = async () =>
      new Response('<html>nope</html>', { status: 404, headers: { 'Content-Type': 'text/html' } });
    const res = await new FetchHttpClient(fetchImpl).request({
      method: 'GET',
      url: 'https://guac.example/',
    });
    expect(res.status).toBe(404);
    expect(res.body).toBe('<html>nope</html>');
  });

  it('returns null for empty bodies', async () => {
    const fetchImpl: FetchLike = async () => new Response(null, { status: 204 });
    const res = await new FetchHttpClient(fetchImpl).request({
      method: 'DELETE',
      url: 'https://guac.example/',
    });
    expect(res.body).toBeNull();
  });

  it('maps network failures and timeouts to HttpTransportError', async () => {
    const failing: FetchLike = async () => {
      throw new TypeError('Failed to fetch');
    };
    await expect(
      new FetchHttpClient(failing).request({ method: 'GET', url: 'https://guac.example/' }),
    ).rejects.toMatchObject({
      name: 'HttpTransportError',
      kind: 'unreachable',
    });

    const hanging: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    const err = await new FetchHttpClient(hanging)
      .request({ method: 'GET', url: 'https://guac.example/', timeoutMs: 5 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpTransportError);
    expect((err as HttpTransportError).kind).toBe('timeout');
  });
});

describe('NativeHttpClient', () => {
  function plugin(respond: (o: HttpOptions) => CapHttpResponse | Promise<CapHttpResponse>) {
    const calls: HttpOptions[] = [];
    return {
      calls,
      request: async (o: HttpOptions) => {
        calls.push(o);
        return respond(o);
      },
    };
  }

  it('sends a pre-encoded form string with an explicit content type', async () => {
    const p = plugin(() => ({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      data: { a: 1 },
      url: '',
    }));
    const res = await new NativeHttpClient(p).request({
      method: 'POST',
      url: 'https://guac.example/guacamole/api/tokens',
      query: { x: 'y' },
      headers: { 'Guacamole-Token': 't' },
      body: { kind: 'form', fields: { username: 'u', password: 'p w' } },
      timeoutMs: 1000,
    });
    expect(p.calls[0]).toMatchObject({
      url: 'https://guac.example/guacamole/api/tokens?x=y',
      method: 'POST',
      data: 'username=u&password=p+w',
      headers: { 'Guacamole-Token': 't', 'Content-Type': 'application/x-www-form-urlencoded' },
      connectTimeout: 1000,
      readTimeout: 1000,
    });
    expect(p.calls[0]?.params).toBeUndefined();
    expect(res).toEqual({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { a: 1 },
    });
  });

  it('parses JSON delivered as a string, keeps text, and maps empty to null', async () => {
    const json = plugin(() => ({
      status: 403,
      headers: { 'content-type': 'application/json' },
      data: '{"type":"X"}',
      url: '',
    }));
    expect(
      (await new NativeHttpClient(json).request({ method: 'GET', url: 'https://guac.example/' }))
        .body,
    ).toEqual({ type: 'X' });
    const html = plugin(() => ({
      status: 200,
      headers: { 'content-type': 'text/html' },
      data: '<html>',
      url: '',
    }));
    expect(
      (await new NativeHttpClient(html).request({ method: 'GET', url: 'https://guac.example/' }))
        .body,
    ).toBe('<html>');
    const empty = plugin(() => ({ status: 204, headers: {}, data: '', url: '' }));
    expect(
      (
        await new NativeHttpClient(empty).request({
          method: 'DELETE',
          url: 'https://guac.example/',
        })
      ).body,
    ).toBeNull();
  });

  it('classifies native failures', async () => {
    const p = plugin(() => {
      throw new Error(
        'javax.net.ssl.SSLHandshakeException: Trust anchor for certification path not found.',
      );
    });
    await expect(
      new NativeHttpClient(p).request({ method: 'GET', url: 'https://guac.example/' }),
    ).rejects.toMatchObject({
      kind: 'tls',
    });
    expect(classifyNativeError('The request timed out.')).toBe('timeout');
    expect(classifyNativeError('java.net.SocketTimeoutException: timeout')).toBe('timeout');
    expect(classifyNativeError('Unable to resolve host "guac.example"')).toBe('unreachable');
    expect(classifyNativeError('The certificate for this server is invalid.')).toBe('tls');
  });
});

describe('platform selection', () => {
  it('picks native HTTP on native platforms and fetch otherwise', () => {
    expect(createHttpClient({ native: true })).toBeInstanceOf(NativeHttpClient);
    expect(createHttpClient({ native: false })).toBeInstanceOf(FetchHttpClient);
    expect(createHttpClient()).toBeInstanceOf(FetchHttpClient); // Vitest runs on "web"
  });

  it('never uses the insecure store on native or in production web builds', () => {
    const native = createSecureStore({ native: true, dev: true });
    expect(native).toBeInstanceOf(NativeSecureStore);
    expect(native.protectedAtRest).toBe(true);
    expect(createSecureStore({ native: false, dev: false }).persistent).toBe(false);
    expect(createSecureStore({ native: false, dev: false }).protectedAtRest).toBe(false);
  });
});
