/**
 * A minimal, read-only X.509 (DER) reader for showing a server certificate to the user
 * before they decide to trust it (SRV-8). It extracts only display fields: subject, issuer,
 * validity, subject alternative names and the serial number. It never decides trust: the
 * pin is the SHA-256 of the whole DER (`fingerprint.ts`), checked natively.
 *
 * Native code returns the leaf certificate's DER and nothing else, so this parsing is the
 * same on iOS and Android and is unit-tested here (iOS has no public API for the validity
 * dates or the issuer name of a `SecCertificate`).
 */

export interface NameAttribute {
  /** Short name (`CN`, `O`, …) or the dotted OID when unknown. */
  readonly type: string;
  readonly value: string;
}

export interface CertificateDetails {
  /** Attributes in certificate order. */
  readonly subject: readonly NameAttribute[];
  readonly issuer: readonly NameAttribute[];
  /** Epoch milliseconds. */
  readonly notBefore: number;
  readonly notAfter: number;
  /** `DNS:name`, `IP:address` or `email:address`, in certificate order. */
  readonly altNames: readonly string[];
  /** Upper-case hex, no separators. */
  readonly serial: string;
  /** Subject and issuer are byte-identical (typical for a self-signed certificate). */
  readonly selfIssued: boolean;
}

export class CertificateParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CertificateParseError';
  }
}

interface Tlv {
  readonly tag: number;
  /** Offset of the tag byte. */
  readonly start: number;
  /** Offset of the first content byte. */
  readonly body: number;
  /** Offset just past the content. */
  readonly end: number;
}

function readTlv(b: Uint8Array, pos: number, limit: number): Tlv {
  if (pos + 2 > limit) throw new CertificateParseError('truncated');
  const tag = b[pos] ?? 0;
  if ((tag & 0x1f) === 0x1f) throw new CertificateParseError('high tag numbers are not used');
  let len = b[pos + 1] ?? 0;
  let body = pos + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4) throw new CertificateParseError('unsupported length');
    if (body + n > limit) throw new CertificateParseError('truncated');
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + (b[body + i] ?? 0);
    body += n;
  }
  const end = body + len;
  if (end > limit) throw new CertificateParseError('truncated');
  return { tag, start: pos, body, end };
}

function children(b: Uint8Array, parent: Tlv): Tlv[] {
  const out: Tlv[] = [];
  let pos = parent.body;
  while (pos < parent.end) {
    const t = readTlv(b, pos, parent.end);
    out.push(t);
    pos = t.end;
  }
  return out;
}

function expectTag(t: Tlv | undefined, tag: number, what: string): Tlv {
  if (!t || t.tag !== tag) throw new CertificateParseError(`expected ${what}`);
  return t;
}

function decodeOid(b: Uint8Array, t: Tlv): string {
  const parts: number[] = [];
  let value = 0;
  for (let i = t.body; i < t.end; i++) {
    const byte = b[i] ?? 0;
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) {
      if (parts.length === 0) {
        const first = value < 80 ? Math.floor(value / 40) : 2;
        parts.push(first, value - first * 40);
      } else parts.push(value);
      value = 0;
    }
  }
  return parts.join('.');
}

const NAME_TYPES: Readonly<Record<string, string>> = {
  '2.5.4.3': 'CN',
  '2.5.4.5': 'serialNumber',
  '2.5.4.6': 'C',
  '2.5.4.7': 'L',
  '2.5.4.8': 'ST',
  '2.5.4.10': 'O',
  '2.5.4.11': 'OU',
  '1.2.840.113549.1.9.1': 'emailAddress',
  '0.9.2342.19200300.100.1.25': 'DC',
};

const utf8 = new TextDecoder('utf-8', { fatal: false });
const latin1 = new TextDecoder('latin1');

function decodeString(b: Uint8Array, t: Tlv): string {
  const bytes = b.subarray(t.body, t.end);
  switch (t.tag) {
    case 0x0c: // UTF8String
      return utf8.decode(bytes);
    case 0x12: // NumericString
    case 0x13: // PrintableString
    case 0x16: // IA5String
    case 0x14: // TeletexString (treated as Latin-1, as most tools do)
      return latin1.decode(bytes);
    case 0x1e: {
      // BMPString: UTF-16BE
      let s = '';
      for (let i = 0; i + 1 < bytes.length; i += 2) {
        s += String.fromCharCode(((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0));
      }
      return s;
    }
    default:
      return Array.from(bytes, (x) => x.toString(16).padStart(2, '0')).join('');
  }
}

function decodeName(b: Uint8Array, name: Tlv): NameAttribute[] {
  const out: NameAttribute[] = [];
  for (const rdn of children(b, expectTag(name, 0x30, 'Name'))) {
    expectTag(rdn, 0x31, 'RDN');
    for (const atv of children(b, rdn)) {
      const [oidT, valT] = children(b, expectTag(atv, 0x30, 'attribute'));
      const oid = decodeOid(b, expectTag(oidT, 0x06, 'attribute type'));
      if (!valT) throw new CertificateParseError('attribute without value');
      out.push({ type: NAME_TYPES[oid] ?? oid, value: decodeString(b, valT) });
    }
  }
  return out;
}

function digits(s: string, from: number, n: number): number {
  const part = s.slice(from, from + n);
  if (!/^\d+$/.test(part) || part.length !== n) throw new CertificateParseError('bad time');
  return Number(part);
}

function decodeTime(b: Uint8Array, t: Tlv): number {
  const s = latin1.decode(b.subarray(t.body, t.end));
  if (!s.endsWith('Z')) throw new CertificateParseError('time must be UTC');
  let year: number;
  let i: number;
  if (t.tag === 0x17) {
    // UTCTime YYMMDDHHMMSSZ (RFC 5280 4.1.2.5.1: YY < 50 is 20YY)
    const yy = digits(s, 0, 2);
    year = yy < 50 ? 2000 + yy : 1900 + yy;
    i = 2;
  } else if (t.tag === 0x18) {
    year = digits(s, 0, 4);
    i = 4;
  } else throw new CertificateParseError('expected a time');
  const month = digits(s, i, 2);
  const day = digits(s, i + 2, 2);
  const hour = digits(s, i + 4, 2);
  const minute = digits(s, i + 6, 2);
  const second = s.length - 1 > i + 8 ? digits(s, i + 8, 2) : 0;
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

function formatIp(bytes: Uint8Array): string {
  if (bytes.length === 4) return Array.from(bytes).join('.');
  if (bytes.length === 16) {
    const groups: string[] = [];
    for (let i = 0; i < 16; i += 2) {
      groups.push((((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0)).toString(16));
    }
    return groups.join(':');
  }
  return Array.from(bytes, (x) => x.toString(16).padStart(2, '0')).join('');
}

function decodeAltNames(b: Uint8Array, octets: Tlv): string[] {
  const out: string[] = [];
  const seq = readTlv(b, octets.body, octets.end);
  for (const gn of children(b, expectTag(seq, 0x30, 'GeneralNames'))) {
    const bytes = b.subarray(gn.body, gn.end);
    if (gn.tag === 0x82) out.push(`DNS:${latin1.decode(bytes)}`);
    else if (gn.tag === 0x87) out.push(`IP:${formatIp(bytes)}`);
    else if (gn.tag === 0x81) out.push(`email:${latin1.decode(bytes)}`);
  }
  return out;
}

function sameBytes(b: Uint8Array, x: Tlv, y: Tlv): boolean {
  if (x.end - x.start !== y.end - y.start) return false;
  for (let i = 0; i < x.end - x.start; i++) if (b[x.start + i] !== b[y.start + i]) return false;
  return true;
}

/** Parses the display fields of a DER certificate. Throws `CertificateParseError`. */
export function parseCertificate(der: Uint8Array): CertificateDetails {
  const cert = expectTag(readTlv(der, 0, der.length), 0x30, 'Certificate');
  const [tbs] = children(der, cert);
  const fields = children(der, expectTag(tbs, 0x30, 'TBSCertificate'));
  let k = 0;
  if (fields[0]?.tag === 0xa0) k = 1; // [0] version
  const serialT = expectTag(fields[k], 0x02, 'serial number');
  expectTag(fields[k + 1], 0x30, 'signature algorithm');
  const issuerT = expectTag(fields[k + 2], 0x30, 'issuer');
  const validity = children(der, expectTag(fields[k + 3], 0x30, 'validity'));
  const subjectT = expectTag(fields[k + 4], 0x30, 'subject');
  const [nb, na] = validity;
  if (!nb || !na) throw new CertificateParseError('validity needs two times');

  const altNames: string[] = [];
  for (const f of fields.slice(k + 6)) {
    if (f.tag !== 0xa3) continue; // [3] extensions
    const [exts] = children(der, f);
    for (const ext of children(der, expectTag(exts, 0x30, 'extensions'))) {
      const parts = children(der, expectTag(ext, 0x30, 'extension'));
      const oid = decodeOid(der, expectTag(parts[0], 0x06, 'extension id'));
      const value = parts[parts.length - 1];
      if (oid === '2.5.29.17' && value?.tag === 0x04) altNames.push(...decodeAltNames(der, value));
    }
  }

  let serial = '';
  for (let i = serialT.body; i < serialT.end; i++) {
    serial += (der[i] ?? 0).toString(16).padStart(2, '0');
  }
  serial = serial.replace(/^(00)+(?=..)/, '').toUpperCase();

  return {
    subject: decodeName(der, subjectT),
    issuer: decodeName(der, issuerT),
    notBefore: decodeTime(der, nb),
    notAfter: decodeTime(der, na),
    altNames,
    serial,
    selfIssued: sameBytes(der, subjectT, issuerT),
  };
}

/** `CN=…, O=…` in certificate order, or `''`. */
export function formatName(name: readonly NameAttribute[]): string {
  return name.map((a) => `${a.type}=${a.value}`).join(', ');
}

/** The most readable single label for a name: its CN, else O, else the whole name. */
export function nameLabel(name: readonly NameAttribute[]): string {
  const pick = (t: string) => name.findLast((a) => a.type === t)?.value;
  return pick('CN') ?? pick('O') ?? formatName(name);
}
