import { describe, expect, it } from 'vitest';
import { bytesToBase64, makeTestCertificate, tlv } from '../testing/testCertificate.ts';
import {
  base64ToBytes,
  formatFingerprint,
  isFingerprint,
  normalizeFingerprint,
  pinOrigin,
  sha256Hex,
} from './fingerprint.ts';
import { CertificateParseError, formatName, nameLabel, parseCertificate } from './x509.ts';

/** Node's own X.509 parser, as an independent cross-check (tests run on Node 22). */
interface NodeX509 {
  readonly subject: string;
  readonly issuer: string;
  readonly validFrom: string;
  readonly validTo: string;
  readonly fingerprint256: string;
  readonly subjectAltName: string | undefined;
  readonly serialNumber: string;
}
function nodeX509(der: Uint8Array): NodeX509 | undefined {
  const proc = (
    globalThis as unknown as {
      process?: { getBuiltinModule?: (id: string) => unknown };
    }
  ).process;
  const mod = proc?.getBuiltinModule?.('node:crypto') as
    { X509Certificate: new (der: Uint8Array) => NodeX509 } | undefined;
  return mod ? new mod.X509Certificate(der) : undefined;
}

describe('parseCertificate', () => {
  it('reads subject, issuer, validity, names and serial (self-signed)', async () => {
    const der = await makeTestCertificate({
      subject: [
        ['C', 'ES'],
        ['O', 'Servidor ñandú'],
        ['CN', 'guac.example.test'],
      ],
      dnsNames: ['guac.example.test', 'alt.example.test'],
      ipv4: [[192, 0, 2, 10]],
      notBefore: Date.UTC(2026, 1, 3, 4, 5, 6),
      notAfter: Date.UTC(2051, 6, 8, 9, 10, 11), // GeneralizedTime (2050 and later)
      serial: [0x0a, 0xbc, 0xde],
    });
    const d = parseCertificate(der);
    expect(formatName(d.subject)).toBe('C=ES, O=Servidor ñandú, CN=guac.example.test');
    expect(nameLabel(d.subject)).toBe('guac.example.test');
    expect(d.issuer).toEqual(d.subject);
    expect(d.selfIssued).toBe(true);
    expect(d.notBefore).toBe(Date.UTC(2026, 1, 3, 4, 5, 6));
    expect(d.notAfter).toBe(Date.UTC(2051, 6, 8, 9, 10, 11));
    expect(d.altNames).toEqual(['DNS:guac.example.test', 'DNS:alt.example.test', 'IP:192.0.2.10']);
    expect(d.serial).toBe('0ABCDE');

    const node = nodeX509(der);
    if (node) {
      expect(node.subject.split('\n')).toEqual(d.subject.map((a) => `${a.type}=${a.value}`));
      expect(new Date(node.validFrom).getTime()).toBe(d.notBefore);
      expect(new Date(node.validTo).getTime()).toBe(d.notAfter);
      expect(node.subjectAltName).toBe(
        'DNS:guac.example.test, DNS:alt.example.test, IP Address:192.0.2.10',
      );
      expect(node.serialNumber.replace(/^0+/, '')).toBe(d.serial.replace(/^0+/, ''));
    }
  });

  it('tells an issued certificate from a self-issued one', async () => {
    const der = await makeTestCertificate({
      subject: [['CN', 'guac.example.test']],
      issuer: [
        ['O', 'Home CA'],
        ['CN', 'Home Root'],
      ],
    });
    const d = parseCertificate(der);
    expect(d.selfIssued).toBe(false);
    expect(formatName(d.issuer)).toBe('O=Home CA, CN=Home Root');
    expect(nameLabel(d.issuer)).toBe('Home Root');
  });

  it('rejects garbage and truncated input with CertificateParseError', async () => {
    expect(() => parseCertificate(new Uint8Array([1, 2, 3]))).toThrow(CertificateParseError);
    const der = await makeTestCertificate();
    expect(() => parseCertificate(der.slice(0, der.length - 10))).toThrow(CertificateParseError);
    expect(() => parseCertificate(tlv(0x30, tlv(0x30)))).toThrow(CertificateParseError);
  });
});

describe('fingerprints', () => {
  it('is the SHA-256 of the DER, matching Node and openssl formatting', async () => {
    const der = await makeTestCertificate();
    const hex = await sha256Hex(der);
    expect(isFingerprint(hex)).toBe(true);
    const node = nodeX509(der);
    if (node) expect(formatFingerprint(hex)).toBe(node.fingerprint256);
    expect(normalizeFingerprint(formatFingerprint(hex))).toBe(hex);
    expect(normalizeFingerprint('ab cd')).toBeUndefined();
    expect(isFingerprint(hex.toUpperCase())).toBe(false);
  });

  it('round-trips base64', async () => {
    const der = await makeTestCertificate();
    expect(base64ToBytes(bytesToBase64(der))).toEqual(der);
  });
});

describe('pinOrigin', () => {
  it('binds https and wss to the same scheme/host/port with an explicit port', () => {
    expect(pinOrigin('https://Guac.Example.Test/guacamole')).toBe('https://guac.example.test:443');
    expect(pinOrigin('wss://guac.example.test/guacamole/websocket-tunnel')).toBe(
      'https://guac.example.test:443',
    );
    expect(pinOrigin('https://guac.example.test:8443/x?y')).toBe('https://guac.example.test:8443');
    expect(pinOrigin('https://[2001:db8::1]:8443/')).toBe('https://[2001:db8::1]:8443');
  });

  it('never applies to plain http/ws or junk', () => {
    expect(pinOrigin('http://guac.example.test')).toBeUndefined();
    expect(pinOrigin('ws://guac.example.test')).toBeUndefined();
    expect(pinOrigin('not a url')).toBeUndefined();
  });
});
