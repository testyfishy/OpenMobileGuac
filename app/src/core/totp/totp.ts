/**
 * Time-based one-time passwords (RFC 6238 on top of RFC 4226 HOTP), for the optional stored
 * TOTP seed (SPEC SRV-9). Uses WebCrypto HMAC, so it runs in the WebView, in Node and in
 * tests without a dependency.
 *
 * The seed is a secret: callers keep it in `SecureStore` only (see `secretKeys.totpSeed`).
 */

export type TotpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512';

export interface TotpParams {
  /** Raw shared secret. */
  readonly secret: Uint8Array;
  readonly algorithm: TotpAlgorithm;
  /** 6 to 8. */
  readonly digits: number;
  /** Seconds per code, normally 30. */
  readonly period: number;
  readonly issuer?: string;
  readonly account?: string;
}

export class TotpParseError extends Error {
  readonly reason: 'empty' | 'base32' | 'uri' | 'algorithm' | 'digits' | 'period' | 'short';
  constructor(reason: TotpParseError['reason'], message: string) {
    super(message);
    this.name = 'TotpParseError';
    this.reason = reason;
  }
}

export const TOTP_DEFAULTS = { algorithm: 'SHA1', digits: 6, period: 30 } as const;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Decodes RFC 4648 Base32 leniently: case, spaces, dashes and `=` padding are ignored. */
export function decodeBase32(input: string): Uint8Array {
  const clean = input.replace(/[\s\-=]/g, '').toUpperCase();
  if (clean.length === 0) throw new TotpParseError('empty', 'Empty secret');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new TotpParseError('base32', 'Not a Base32 secret');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

export function encodeBase32(bytes: Uint8Array): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function parseAlgorithm(raw: string | null | undefined): TotpAlgorithm {
  if (raw === null || raw === undefined || raw === '') return TOTP_DEFAULTS.algorithm;
  const a = raw.toUpperCase().replace(/-/g, '');
  if (a === 'SHA1' || a === 'SHA256' || a === 'SHA512') return a;
  throw new TotpParseError('algorithm', `Unsupported algorithm ${raw}`);
}

function parseIntParam(
  raw: string | null | undefined,
  fallback: number,
  min: number,
  max: number,
  reason: 'digits' | 'period',
): number {
  if (raw === null || raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new TotpParseError(reason, `Unsupported ${reason} ${raw}`);
  }
  return n;
}

export interface TotpOverrides {
  readonly algorithm?: string;
  readonly digits?: number | string;
  readonly period?: number | string;
}

/**
 * Parses what the user pasted: a Base32 secret or an `otpauth://totp/...` URI. `overrides`
 * (for example the digits/period the Guacamole TOTP field reports) apply to a bare secret
 * only; a URI's own parameters win.
 */
export function parseTotpInput(input: string, overrides: TotpOverrides = {}): TotpParams {
  const text = input.trim();
  if (text.length === 0) throw new TotpParseError('empty', 'Empty secret');
  if (/^otpauth:/i.test(text)) return parseOtpauthUri(text);
  const secret = decodeBase32(text);
  if (secret.length < 10) throw new TotpParseError('short', 'Secret is too short');
  return {
    secret,
    algorithm: parseAlgorithm(overrides.algorithm),
    digits: parseIntParam(
      overrides.digits === undefined ? undefined : String(overrides.digits),
      TOTP_DEFAULTS.digits,
      6,
      8,
      'digits',
    ),
    period: parseIntParam(
      overrides.period === undefined ? undefined : String(overrides.period),
      TOTP_DEFAULTS.period,
      1,
      600,
      'period',
    ),
  };
}

function parseOtpauthUri(text: string): TotpParams {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new TotpParseError('uri', 'Not a valid otpauth URI');
  }
  // `new URL('otpauth://totp/Label?..')` puts "totp" in the host on most engines; accept
  // either placement.
  const kind = (url.host || url.pathname.replace(/^\/+/, '').split('/')[0] || '').toLowerCase();
  if (kind !== 'totp') throw new TotpParseError('uri', 'Only otpauth://totp URIs are supported');
  const secretRaw = url.searchParams.get('secret');
  if (!secretRaw) throw new TotpParseError('uri', 'The URI has no secret');
  const secret = decodeBase32(secretRaw);
  if (secret.length < 10) throw new TotpParseError('short', 'Secret is too short');
  const label = decodeURIComponent(url.pathname.replace(/^\/+/, '').replace(/^totp\/?/i, ''));
  const [labelIssuer, labelAccount] = label.includes(':')
    ? [label.slice(0, label.indexOf(':')), label.slice(label.indexOf(':') + 1)]
    : [undefined, label];
  const issuer = url.searchParams.get('issuer') ?? labelIssuer;
  const account = labelAccount?.trim() || undefined;
  return {
    secret,
    algorithm: parseAlgorithm(url.searchParams.get('algorithm')),
    digits: parseIntParam(url.searchParams.get('digits'), TOTP_DEFAULTS.digits, 6, 8, 'digits'),
    period: parseIntParam(url.searchParams.get('period'), TOTP_DEFAULTS.period, 1, 600, 'period'),
    ...(issuer ? { issuer: issuer.trim() } : {}),
    ...(account ? { account } : {}),
  };
}

/** The canonical stored form: an `otpauth://totp` URI (secret in Base32). */
export function serializeTotp(p: TotpParams): string {
  const q = new URLSearchParams({
    secret: encodeBase32(p.secret),
    algorithm: p.algorithm,
    digits: String(p.digits),
    period: String(p.period),
  });
  if (p.issuer) q.set('issuer', p.issuer);
  const label = encodeURIComponent(p.account ?? 'account');
  return `otpauth://totp/${label}?${q.toString()}`;
}

export function totpCounter(unixMs: number, period: number): number {
  return Math.floor(unixMs / 1000 / period);
}

/** Whole seconds until the current code expires (1..period). */
export function secondsRemaining(unixMs: number, period: number): number {
  const elapsed = Math.floor(unixMs / 1000) % period;
  return period - elapsed;
}

const HASH: Record<TotpAlgorithm, string> = {
  SHA1: 'SHA-1',
  SHA256: 'SHA-256',
  SHA512: 'SHA-512',
};

/** RFC 4226 HOTP for one counter value. */
export async function hotp(
  secret: Uint8Array,
  counter: number,
  digits: number,
  algorithm: TotpAlgorithm,
  subtle: SubtleCrypto = globalThis.crypto.subtle,
): Promise<string> {
  const msg = new Uint8Array(8);
  // 64-bit big-endian counter (counters here stay well below 2^53).
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const key = await subtle.importKey(
    'raw',
    secret as BufferSource,
    { name: 'HMAC', hash: HASH[algorithm] },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await subtle.sign('HMAC', key, msg));
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const bin =
    (((mac[offset] ?? 0) & 0x7f) << 24) |
    ((mac[offset + 1] ?? 0) << 16) |
    ((mac[offset + 2] ?? 0) << 8) |
    (mac[offset + 3] ?? 0);
  const mod = 10 ** digits;
  return String(bin % mod).padStart(digits, '0');
}

/** RFC 6238 TOTP at `unixMs`. */
export function totpAt(
  p: Pick<TotpParams, 'secret' | 'algorithm' | 'digits' | 'period'>,
  unixMs: number,
  subtle?: SubtleCrypto,
): Promise<string> {
  return hotp(p.secret, totpCounter(unixMs, p.period), p.digits, p.algorithm, subtle);
}

/**
 * The Guacamole TOTP extension refuses a code that was already used. When the last code
 * the app sent was for the current time step, return how long to wait for the next one
 * (milliseconds); otherwise 0.
 */
export function waitForFreshCode(
  lastUsedCounter: number | undefined,
  unixMs: number,
  period: number,
): number {
  if (lastUsedCounter === undefined) return 0;
  if (totpCounter(unixMs, period) > lastUsedCounter) return 0;
  return (lastUsedCounter + 1) * period * 1000 - unixMs;
}
