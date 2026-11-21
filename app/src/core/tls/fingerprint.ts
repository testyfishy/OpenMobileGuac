/**
 * Certificate fingerprints and the origin a pin is bound to (SRV-8, docs/tls.md).
 *
 * A pin is the SHA-256 of the leaf certificate's DER encoding: the value
 * `openssl x509 -noout -fingerprint -sha256` prints and browsers show as "SHA-256
 * fingerprint". It is stored as 64 lower-case hex digits.
 */

const HEX64 = /^[0-9a-f]{64}$/;

/** True for a stored-form fingerprint (64 lower-case hex digits). */
export function isFingerprint(value: unknown): value is string {
  return typeof value === 'string' && HEX64.test(value);
}

/**
 * Accepts `AB:CD:…`, `ab cd …` or plain hex and returns the stored form, or `undefined`
 * when it is not a SHA-256 fingerprint.
 */
export function normalizeFingerprint(value: string): string | undefined {
  const hex = value.replace(/[\s:]/g, '').toLowerCase();
  return HEX64.test(hex) ? hex : undefined;
}

/** `AB:CD:EF:…` (upper case, colon-separated), as shown to the user. */
export function formatFingerprint(sha256: string): string {
  return (sha256.toUpperCase().match(/../g) ?? []).join(':');
}

export async function sha256Hex(
  der: Uint8Array,
  subtle: SubtleCrypto = globalThis.crypto.subtle,
): Promise<string> {
  const digest = new Uint8Array(await subtle.digest('SHA-256', der as BufferSource));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function base64ToBytes(text: string): Uint8Array {
  const s = atob(text.replace(/\s/g, ''));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * The origin a pin applies to: `https://<host>:<port>` with the port always written, for an
 * `https:` or `wss:` URL (a `wss:` tunnel shares the pin of its `https:` server). `undefined`
 * for anything else (plain http/ws never use a pin).
 */
export function pinOrigin(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'wss:') return undefined;
  if (!parsed.hostname) return undefined;
  return `https://${parsed.hostname}:${parsed.port || '443'}`;
}
