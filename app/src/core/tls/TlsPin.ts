import { isRecord } from '../models/json.ts';
import { isFingerprint, pinOrigin } from './fingerprint.ts';

/**
 * A certificate the user chose to trust for one server address (SRV-8, docs/tls.md).
 *
 * Stored with the server profile. Not a secret, but it carries its own `origin`, and every
 * reader checks that origin against the profile's address (`pinForBaseUrl`), so a pin that
 * ends up next to another address (an edited profile, a crafted backup) is ignored.
 */
export interface TlsPin {
  /** `https://<host>:<port>` (see `pinOrigin`). */
  readonly origin: string;
  /** SHA-256 of the leaf certificate's DER, 64 lower-case hex digits. */
  readonly sha256: string;
  /** For display only. */
  readonly subject: string;
  readonly issuer: string;
  /** Epoch milliseconds; 0 when unknown. For display only: an expired pinned leaf is accepted. */
  readonly notBefore: number;
  readonly notAfter: number;
  /** When the user trusted it, epoch milliseconds. */
  readonly pinnedAt: number;
}

/** Validates a stored pin. Returns `undefined` for anything malformed. */
export function parseTlsPin(raw: unknown): TlsPin | undefined {
  if (!isRecord(raw)) return undefined;
  const { origin, sha256, subject, issuer, notBefore, notAfter, pinnedAt } = raw;
  if (typeof origin !== 'string' || pinOrigin(origin) !== origin) return undefined;
  if (!isFingerprint(sha256)) return undefined;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    origin,
    sha256,
    subject: typeof subject === 'string' ? subject.slice(0, 1000) : '',
    issuer: typeof issuer === 'string' ? issuer.slice(0, 1000) : '',
    notBefore: num(notBefore),
    notAfter: num(notAfter),
    pinnedAt: num(pinnedAt),
  };
}

/** The pin if it is valid **and** bound to `baseUrl`'s scheme, host and port. */
export function pinForBaseUrl(raw: unknown, baseUrl: string): TlsPin | undefined {
  const pin = parseTlsPin(raw);
  if (!pin) return undefined;
  const origin = pinOrigin(baseUrl);
  return origin !== undefined && origin === pin.origin ? pin : undefined;
}
