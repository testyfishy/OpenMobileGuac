import { describe, expect, it, vi } from 'vitest';
import { HttpTransportError, type HttpClient, type HttpRequest } from '../http/HttpClient.ts';
import { MemoryKeyValueStore } from '../storage/KeyValueStore.ts';
import { ProfileStore } from '../storage/ProfileStore.ts';
import { bytesToBase64, makeTestCertificate } from '../testing/testCertificate.ts';
import { sha256Hex } from './fingerprint.ts';
import { CertificateMismatchError, PinRoutingHttpClient } from './PinnedHttpClient.ts';
import type { NativeTlsRequest, PinnedTlsPlugin } from './plugin.ts';
import { TlsTrustService } from './TlsTrustService.ts';

const HOST = 'https://guac.example.test:8443';

function rejection(code: string, data?: Record<string, unknown>) {
  return Object.assign(new Error(code.toLowerCase()), { code, ...(data ? { data } : {}) });
}

/** A fake native plugin: `inspect` returns whatever certificate the "server" presents. */
function fakePlugin(presented: { der: string }) {
  const requests: NativeTlsRequest[] = [];
  const plugin = {
    inspect: vi.fn(async () => ({ der: presented.der })),
    request: vi.fn(async (req: NativeTlsRequest) => {
      requests.push(req);
      if (!req.pins.length) throw rejection('BAD_REQUEST');
      if (
        !req.pins.includes(
          await sha256Hex(Uint8Array.from(atob(presented.der), (c) => c.charCodeAt(0))),
        )
      ) {
        throw rejection('PIN_MISMATCH', { der: presented.der });
      }
      return { status: 200, headers: { 'Content-Type': 'application/json' }, data: '{"ok":1}' };
    }),
    openSocket: vi.fn(async () => undefined),
    send: vi.fn(async () => undefined),
    ack: vi.fn(async () => undefined),
    closeSocket: vi.fn(async () => undefined),
    addListener: vi.fn(async () => ({ remove: async () => undefined })),
  } satisfies PinnedTlsPlugin;
  return { plugin, requests };
}

const systemClient = (): HttpClient & { calls: HttpRequest[] } => {
  const calls: HttpRequest[] = [];
  return {
    calls,
    async request(req) {
      calls.push(req);
      throw new HttpTransportError('tls', req.url, 'certificate not trusted');
    },
  };
};

async function setup() {
  const certA = await makeTestCertificate();
  const certB = await makeTestCertificate();
  const presented = { der: bytesToBase64(certA) };
  const { plugin, requests } = fakePlugin(presented);
  let now = 1_000_000;
  const store = new ProfileStore(new MemoryKeyValueStore(), { now: () => now });
  const tls = new TlsTrustService({ plugin, store, now: () => now });
  return {
    certA,
    certB,
    presented,
    plugin,
    requests,
    store,
    tls,
    advance: (ms: number) => (now += ms),
    shaA: await sha256Hex(certA),
    shaB: await sha256Hex(certB),
  };
}

describe('TlsTrustService', () => {
  it('without the native plugin is a no-op and leaves HTTP untouched', async () => {
    const store = new ProfileStore(new MemoryKeyValueStore());
    const tls = new TlsTrustService({ plugin: undefined, store });
    const system = systemClient();
    expect(tls.available).toBe(false);
    expect(tls.wrapHttpClient(system)).toBe(system);
    expect(await tls.pinsFor(`${HOST}/guacamole`)).toEqual([]);
    await expect(tls.inspect(`${HOST}/`)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });

  it('first use: inspect shows the certificate, trust saves it on that address only', async () => {
    const s = await setup();
    const p = await s.store.add({ name: 'A', baseUrl: `${HOST}/guacamole` });
    const other = await s.store.add({ name: 'B', baseUrl: 'https://other.example.test/guacamole' });

    const verdict = await s.tls.check(`${HOST}/guacamole/api/tokens`);
    expect(verdict.kind).toBe('first-use');
    // Inspection goes to the origin only, never the API path (nothing is sent anyway).
    expect(s.plugin.inspect).toHaveBeenCalledWith({ url: HOST, timeoutMs: 10_000 });
    expect(verdict.presented.sha256).toBe(s.shaA);
    expect(verdict.presented.details?.subject.at(-1)?.value).toBe('guac.example.test');

    const pin = await s.tls.trust(verdict.presented);
    expect(pin).toMatchObject({ origin: HOST, sha256: s.shaA, pinnedAt: 1_000_000 });
    expect((await s.store.get(p.id))?.tlsPin?.sha256).toBe(s.shaA);
    expect((await s.store.get(other.id))?.tlsPin).toBeUndefined();
    expect(s.tls.pinsForSync(`wss://guac.example.test:8443/guacamole/websocket-tunnel`)).toEqual([
      s.shaA,
    ]);
    // Same host, other port or plain http: not pinned.
    expect(s.tls.pinsForSync('https://guac.example.test/guacamole')).toEqual([]);
    expect(s.tls.pinsForSync('http://guac.example.test:8443/guacamole')).toEqual([]);
    expect((await s.tls.check(`${HOST}/`)).kind).toBe('already-trusted');
  });

  it('a changed certificate is reported with old and new, until re-trusted', async () => {
    const s = await setup();
    await s.store.add({ name: 'A', baseUrl: `${HOST}/guacamole` });
    await s.tls.trust((await s.tls.check(HOST)).presented);
    s.presented.der = bytesToBase64(s.certB);
    const verdict = await s.tls.check(HOST);
    expect(verdict.kind).toBe('changed');
    if (verdict.kind !== 'changed') return;
    expect(verdict.pinned.sha256).toBe(s.shaA);
    expect(verdict.presented.sha256).toBe(s.shaB);
    await s.tls.trust(verdict.presented);
    expect(s.tls.pinsForSync(HOST)).toEqual([s.shaB]);
  });

  it('a certificate trusted before the server is saved is pending, then adopted', async () => {
    const s = await setup();
    const verdict = await s.tls.check(`${HOST}/guacamole`);
    await s.tls.trust(verdict.presented);
    expect(s.tls.pinsForSync(HOST)).toEqual([s.shaA]); // usable by the probe
    const saved = await s.store.add({ name: 'A', baseUrl: `${HOST}/guacamole` });
    expect((await s.store.get(saved.id))?.tlsPin).toBeUndefined();
    await s.tls.adoptPending(saved);
    expect((await s.store.get(saved.id))?.tlsPin?.sha256).toBe(s.shaA);
  });

  it('a pending pin expires and is never adopted by another address', async () => {
    const s = await setup();
    await s.tls.trust((await s.tls.check(HOST)).presented);
    const elsewhere = await s.store.add({ name: 'X', baseUrl: 'https://guac.example.test/' });
    await s.tls.adoptPending(elsewhere);
    expect((await s.store.get(elsewhere.id))?.tlsPin).toBeUndefined();
    s.advance(16 * 60_000);
    expect(s.tls.pinsForSync(HOST)).toEqual([]);
    const late = await s.store.add({ name: 'A', baseUrl: HOST });
    await s.tls.adoptPending(late);
    expect((await s.store.get(late.id))?.tlsPin).toBeUndefined();
  });

  it('forget removes the pin from every profile at that address', async () => {
    const s = await setup();
    const a = await s.store.add({ name: 'A', baseUrl: `${HOST}/guacamole` });
    const b = await s.store.add({ name: 'B', baseUrl: `${HOST}/other` });
    await s.tls.trust((await s.tls.check(HOST)).presented);
    expect((await s.store.get(b.id))?.tlsPin?.sha256).toBe(s.shaA);
    const seen = vi.fn();
    s.tls.subscribe(seen);
    await s.tls.forget(`${HOST}/guacamole`);
    expect((await s.store.get(a.id))?.tlsPin).toBeUndefined();
    expect((await s.store.get(b.id))?.tlsPin).toBeUndefined();
    expect(s.tls.pinsForSync(HOST)).toEqual([]);
    expect(seen).toHaveBeenCalled();
  });

  it('fails closed when saved profiles at one address disagree about the pin', async () => {
    const s = await setup();
    const pinA = {
      origin: HOST,
      sha256: s.shaA,
      subject: '',
      issuer: '',
      notBefore: 0,
      notAfter: 0,
      pinnedAt: 0,
    };
    const pinB = { ...pinA, sha256: s.shaB };
    const list = vi.fn(async () => [
      {
        id: '1',
        name: '1',
        baseUrl: `${HOST}/a`,
        username: '',
        rememberPassword: false,
        createdAt: 0,
        tlsPin: pinA,
      },
      {
        id: '2',
        name: '2',
        baseUrl: `${HOST}/b`,
        username: '',
        rememberPassword: false,
        createdAt: 0,
        tlsPin: pinB,
      },
    ]);
    const tls = new TlsTrustService({
      plugin: s.plugin,
      store: { list, setTlsPinForOrigin: async () => [] },
    });
    expect(await tls.pinsFor(`${HOST}/a`)).toEqual([]);
    list.mockResolvedValueOnce([
      {
        id: '1',
        name: '1',
        baseUrl: `${HOST}/a`,
        username: '',
        rememberPassword: false,
        createdAt: 0,
        tlsPin: pinA,
      },
      {
        id: '2',
        name: '2',
        baseUrl: `${HOST}/b`,
        username: '',
        rememberPassword: false,
        createdAt: 0,
      } as never,
    ]);
    expect(await tls.pinsFor(`${HOST}/a`)).toEqual([]);
  });

  it('inspect failures carry the native code', async () => {
    const s = await setup();
    s.plugin.inspect.mockRejectedValueOnce(rejection('UNREACHABLE'));
    await expect(s.tls.inspect(HOST)).rejects.toMatchObject({ code: 'UNREACHABLE' });
    await expect(s.tls.inspect('http://guac.example.test/')).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
  });
});

describe('PinRoutingHttpClient', () => {
  it('uses the system client for unpinned servers, the native one for pinned', async () => {
    const s = await setup();
    const system = systemClient();
    const http = s.tls.wrapHttpClient(system);
    expect(http).toBeInstanceOf(PinRoutingHttpClient);

    const req: HttpRequest = { method: 'GET', url: `${HOST}/guacamole/api/languages` };
    await expect(http.request(req)).rejects.toMatchObject({ kind: 'tls' });
    expect(system.calls).toHaveLength(1);
    expect(s.requests).toHaveLength(0);

    await s.store.add({ name: 'A', baseUrl: `${HOST}/guacamole` });
    await s.tls.trust((await s.tls.check(HOST)).presented);
    const res = await http.request({
      method: 'POST',
      url: `${HOST}/guacamole/api/tokens`,
      query: { a: 'b c' },
      body: { kind: 'form', fields: { username: 'u' } },
      timeoutMs: 1234,
    });
    expect(res).toEqual({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { ok: 1 },
    });
    expect(system.calls).toHaveLength(1);
    expect(s.requests[0]).toEqual({
      url: `${HOST}/guacamole/api/tokens?a=b+c`,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: 'username=u',
      timeoutMs: 1234,
      pins: [s.shaA],
    });
  });

  it('turns a native pin mismatch into a tls CertificateMismatchError with the new cert', async () => {
    const s = await setup();
    await s.store.add({ name: 'A', baseUrl: HOST });
    await s.tls.trust((await s.tls.check(HOST)).presented);
    s.presented.der = bytesToBase64(s.certB);
    const http = s.tls.wrapHttpClient(systemClient());
    const err = await http.request({ method: 'GET', url: `${HOST}/api` }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CertificateMismatchError);
    expect(err).toMatchObject({ kind: 'tls', der: s.presented.der });
  });

  it('maps other native failures to transport error kinds', async () => {
    const s = await setup();
    await s.store.add({ name: 'A', baseUrl: HOST });
    await s.tls.trust((await s.tls.check(HOST)).presented);
    const http = s.tls.wrapHttpClient(systemClient());
    for (const [code, kind] of [
      ['TLS', 'tls'],
      ['TIMEOUT', 'timeout'],
      ['UNREACHABLE', 'unreachable'],
      ['SOMETHING', 'unreachable'],
    ] as const) {
      s.plugin.request.mockRejectedValueOnce(rejection(code));
      await expect(http.request({ method: 'GET', url: `${HOST}/x` })).rejects.toMatchObject({
        kind,
      });
    }
  });
});
