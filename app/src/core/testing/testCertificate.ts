/**
 * Test-only: builds throwaway X.509 certificates in memory (WebCrypto ECDSA P-256 keys that
 * are never exported or written anywhere), so TLS tests need no committed key material.
 * Names use the reserved `example.test` domain and the 192.0.2.0/24 documentation range.
 */

function len(n: number): number[] {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n = Math.floor(n / 256);
  }
  return [0x80 | bytes.length, ...bytes];
}

export function tlv(tag: number, ...content: (Uint8Array | number[])[]): Uint8Array {
  const body = content.flatMap((c) => Array.from(c));
  return Uint8Array.from([tag, ...len(body.length), ...body]);
}

const seq = (...c: Uint8Array[]) => tlv(0x30, ...c);
const set = (...c: Uint8Array[]) => tlv(0x31, ...c);

function oid(dotted: string): Uint8Array {
  const [a = 0, b = 0, ...rest] = dotted.split('.').map(Number);
  const out = [a * 40 + b];
  for (const v of rest) {
    const chunk = [v & 0x7f];
    let x = Math.floor(v / 128);
    while (x > 0) {
      chunk.unshift((x & 0x7f) | 0x80);
      x = Math.floor(x / 128);
    }
    out.push(...chunk);
  }
  return tlv(0x06, out);
}

function integer(bytes: number[]): Uint8Array {
  let b = [...bytes];
  while (b.length > 1 && b[0] === 0 && ((b[1] ?? 0) & 0x80) === 0) b = b.slice(1);
  if (((b[0] ?? 0) & 0x80) !== 0) b = [0, ...b];
  return tlv(0x02, b);
}

const utf8 = (s: string) => tlv(0x0c, Array.from(new TextEncoder().encode(s)));
const printable = (s: string) =>
  tlv(
    0x13,
    Array.from(s, (c) => c.charCodeAt(0)),
  );

const NAME_OIDS: Record<string, string> = { CN: '2.5.4.3', O: '2.5.4.10', C: '2.5.4.6' };

function name(attrs: readonly (readonly [string, string])[]): Uint8Array {
  return seq(
    ...attrs.map(([type, value]) =>
      set(seq(oid(NAME_OIDS[type] ?? type), type === 'C' ? printable(value) : utf8(value))),
    ),
  );
}

function utcTime(ms: number): Uint8Array {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  const s = `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(
    d.getUTCHours(),
  )}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  return tlv(
    0x17,
    Array.from(s, (c) => c.charCodeAt(0)),
  );
}

function generalizedTime(ms: number): Uint8Array {
  const s = new Date(ms)
    .toISOString()
    .replace(/[-:T]/g, '')
    .replace(/\.\d+Z$/, 'Z');
  return tlv(
    0x18,
    Array.from(s, (c) => c.charCodeAt(0)),
  );
}

/** Converts WebCrypto's raw r||s ECDSA signature to DER. */
function ecdsaDer(raw: Uint8Array): Uint8Array {
  const half = raw.length / 2;
  return seq(integer(Array.from(raw.slice(0, half))), integer(Array.from(raw.slice(half))));
}

export interface TestCertificateOptions {
  readonly subject?: readonly (readonly [string, string])[];
  /** Defaults to the subject (self-signed). */
  readonly issuer?: readonly (readonly [string, string])[];
  readonly notBefore?: number;
  readonly notAfter?: number;
  readonly dnsNames?: readonly string[];
  readonly ipv4?: readonly (readonly [number, number, number, number])[];
  readonly serial?: number[];
}

/** A signed DER certificate (self-signed by default). */
export async function makeTestCertificate(
  options: TestCertificateOptions = {},
): Promise<Uint8Array> {
  const subtle = globalThis.crypto.subtle;
  const keys = (await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const spki = new Uint8Array(await subtle.exportKey('spki', keys.publicKey));
  const subject = options.subject ?? [
    ['O', 'OpenMobileGuac tests'],
    ['CN', 'guac.example.test'],
  ];
  const notBefore = options.notBefore ?? Date.UTC(2026, 0, 1);
  const notAfter = options.notAfter ?? Date.UTC(2027, 0, 1);
  const altNames = [
    ...(options.dnsNames ?? ['guac.example.test']).map((d) =>
      tlv(
        0x82,
        Array.from(d, (c) => c.charCodeAt(0)),
      ),
    ),
    ...(options.ipv4 ?? []).map((ip) => tlv(0x87, [...ip])),
  ];
  const sigAlg = seq(oid('1.2.840.10045.4.3.2'));
  const time = (ms: number) =>
    new Date(ms).getUTCFullYear() >= 2050 ? generalizedTime(ms) : utcTime(ms);
  const tbs = seq(
    tlv(0xa0, integer([2])),
    integer(options.serial ?? [0x01, 0x23, 0x45]),
    sigAlg,
    name(options.issuer ?? subject),
    seq(time(notBefore), time(notAfter)),
    name(subject),
    spki,
    tlv(0xa3, seq(seq(oid('2.5.29.17'), tlv(0x04, seq(...altNames))))),
  );
  const sig = new Uint8Array(
    await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, tbs as BufferSource),
  );
  return seq(tbs, sigAlg, tlv(0x03, [0, ...ecdsaDer(sig)]));
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
