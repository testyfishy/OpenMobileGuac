import type { HttpClient } from '../http/HttpClient.ts';
import type { ServerProfile } from '../models/ServerProfile.ts';
import { base64ToBytes, pinOrigin, sha256Hex } from './fingerprint.ts';
import { PinRoutingHttpClient } from './PinnedHttpClient.ts';
import { nativeErrorCode, type PinnedTlsPlugin } from './plugin.ts';
import { pinForBaseUrl, type TlsPin } from './TlsPin.ts';
import { formatName, parseCertificate, type CertificateDetails } from './x509.ts';

/** Where pins are persisted: the server profiles (`ProfileStore`). */
export interface PinStore {
  list(): Promise<readonly ServerProfile[]>;
  setTlsPinForOrigin(origin: string, pin: TlsPin | undefined): Promise<readonly string[]>;
  /** `ProfileStore.systemTrustSeen`; absent in tests that do not care (then: not seen). */
  systemTrustSeen?(baseUrl: string): Promise<boolean>;
}

/** A certificate a server presented, as read by `inspect`. */
export interface PresentedCertificate {
  readonly origin: string;
  /** SHA-256 of the DER, 64 lower-case hex digits. */
  readonly sha256: string;
  /** `undefined` when the certificate could not be parsed (the fingerprint still is exact). */
  readonly details: CertificateDetails | undefined;
}

/** What the UI should offer after a certificate failure. */
export type CertificateVerdict =
  /**
   * No trusted certificate for this address yet: offer "Trust this certificate". With
   * `seenWithSystemTrust`, this address was signed in to before with a publicly trusted
   * certificate: a self-signed one now may be an interception, so the offer is a warning
   * with an extra confirmation (pre-release review R2).
   */
  | {
      readonly kind: 'first-use';
      readonly presented: PresentedCertificate;
      readonly seenWithSystemTrust: boolean;
    }
  /** A different certificate than the trusted one: block, show old vs new. */
  | { readonly kind: 'changed'; readonly presented: PresentedCertificate; readonly pinned: TlsPin }
  /** The presented certificate is the trusted one; the failure has another cause. */
  | { readonly kind: 'already-trusted'; readonly presented: PresentedCertificate };

export class TlsInspectError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TlsInspectError';
    this.code = code;
  }
}

export interface TlsTrustOptions {
  /** `undefined` on the web and when the native plugin is not registered: feature off. */
  readonly plugin: PinnedTlsPlugin | undefined;
  readonly store: PinStore;
  readonly now?: () => number;
  /** How long a certificate trusted for a server not yet saved stays usable. Default 15 min. */
  readonly pendingTtlMs?: number;
}

/**
 * Per-server trust of a self-signed or private-CA certificate (SPEC SRV-8, docs/tls.md).
 *
 * - Pins live on the server profiles; this service keeps an in-memory origin → pin cache so
 *   the tunnel factory can decide synchronously. Each REST lookup refreshes it.
 * - A pin applies only to its own `https://host:port`; `pinForBaseUrl` re-checks that at
 *   every read, so a pin next to another address is inert.
 * - A certificate trusted while adding a server (no profile yet) is kept in memory as
 *   "pending" for that origin, used by the probe, and saved by `adoptPending` with the
 *   profile.
 * - Without the native plugin everything here is a no-op and `wrapHttpClient` returns the
 *   system client unchanged.
 */
export class TlsTrustService {
  private readonly plugin: PinnedTlsPlugin | undefined;
  private readonly store: PinStore;
  private readonly now: () => number;
  private readonly pendingTtlMs: number;
  private cache = new Map<string, TlsPin>();
  private readonly pending = new Map<string, { pin: TlsPin; until: number }>();
  private readonly listeners = new Set<() => void>();

  constructor(options: TlsTrustOptions) {
    this.plugin = options.plugin;
    this.store = options.store;
    this.now = options.now ?? (() => Date.now());
    this.pendingTtlMs = options.pendingTtlMs ?? 15 * 60_000;
  }

  /** The native transport exists, so certificates can be inspected and pinned. */
  get available(): boolean {
    return this.plugin !== undefined;
  }

  /** The native plugin, only when available (used by the tunnel factory). */
  get nativePlugin(): PinnedTlsPlugin | undefined {
    return this.plugin;
  }

  /** Routes pinned origins through the native path; returns `system` when unavailable. */
  wrapHttpClient(system: HttpClient): HttpClient {
    if (!this.plugin) return system;
    return new PinRoutingHttpClient(system, this.plugin, this);
  }

  /** Re-reads the pins from the profiles. */
  async refresh(): Promise<void> {
    if (!this.plugin) return;
    // Fail closed: when the saved profiles at one address disagree (a pin vs another pin, or
    // a pin vs none), no pin applies there; the system path is used and the user is asked
    // again. `ProfileStore` keeps them in agreement, so this only catches a corrupt state.
    const seen = new Map<string, TlsPin | null>();
    const conflicted = new Set<string>();
    for (const p of await this.store.list()) {
      const origin = pinOrigin(p.baseUrl);
      if (origin === undefined) continue;
      const pin = pinForBaseUrl(p.tlsPin, p.baseUrl) ?? null;
      if (!seen.has(origin)) seen.set(origin, pin);
      else if ((seen.get(origin)?.sha256 ?? null) !== (pin?.sha256 ?? null)) conflicted.add(origin);
    }
    const next = new Map<string, TlsPin>();
    for (const [origin, pin] of seen) if (pin && !conflicted.has(origin)) next.set(origin, pin);
    this.cache = next;
  }

  /** Fingerprints trusted for `url`'s origin, from the cache (synchronous). */
  pinsForSync(url: string): readonly string[] {
    const pin = this.pinFor(url);
    return pin ? [pin.sha256] : [];
  }

  /** Fingerprints trusted for `url`'s origin, after refreshing from the profiles. */
  async pinsFor(url: string): Promise<readonly string[]> {
    if (!this.plugin || pinOrigin(url) === undefined) return [];
    // Requests that start together share one re-read of the profiles: a burst of REST calls
    // should not queue a profile read each behind the store's writes. A read that starts
    // after a change still sees it.
    this.refreshing ??= this.refresh().finally(() => {
      this.refreshing = undefined;
    });
    await this.refreshing;
    return this.pinsForSync(url);
  }

  private refreshing: Promise<void> | undefined;

  /** The trusted certificate for `url`'s origin (saved, or pending for a new server). */
  pinFor(url: string): TlsPin | undefined {
    if (!this.plugin) return undefined;
    const origin = pinOrigin(url);
    if (origin === undefined) return undefined;
    const saved = this.cache.get(origin);
    if (saved) return saved;
    const pending = this.pending.get(origin);
    if (pending && pending.until > this.now()) return pending.pin;
    if (pending) this.pending.delete(origin);
    return undefined;
  }

  /** Reads the certificate the server at `url` presents, without sending any request. */
  async inspect(url: string, timeoutMs = 10_000): Promise<PresentedCertificate> {
    const plugin = this.plugin;
    const origin = pinOrigin(url);
    if (!plugin || origin === undefined) throw new TlsInspectError('UNAVAILABLE', 'unavailable');
    let der: string;
    try {
      der = (await plugin.inspect({ url: origin, timeoutMs })).der;
    } catch (err) {
      const code = nativeErrorCode(err) ?? 'UNREACHABLE';
      throw new TlsInspectError(code, err instanceof Error ? err.message : String(err), {
        cause: err,
      });
    }
    return presentedFromDer(origin, der);
  }

  /** Compares what the server presents with what is trusted for that address. */
  async check(url: string): Promise<CertificateVerdict> {
    await this.refresh().catch(() => undefined);
    const presented = await this.inspect(url);
    const pinned = this.pinFor(url);
    if (!pinned) {
      const seen = (await this.store.systemTrustSeen?.(url).catch(() => true)) ?? false;
      return { kind: 'first-use', presented, seenWithSystemTrust: seen };
    }
    if (pinned.sha256 === presented.sha256) return { kind: 'already-trusted', presented };
    return { kind: 'changed', presented, pinned };
  }

  /**
   * Trusts `presented` for its own origin: saved on every profile at that address, or, when
   * none is saved yet, kept as pending until `adoptPending` (or the pending timeout).
   */
  async trust(presented: PresentedCertificate): Promise<TlsPin> {
    if (!this.plugin) throw new Error('Certificate trust is not available on this platform');
    const pin = pinFromPresented(presented, this.now());
    const changed = await this.store.setTlsPinForOrigin(pin.origin, pin);
    if (changed.length === 0) {
      this.pending.set(pin.origin, { pin, until: this.now() + this.pendingTtlMs });
    } else this.pending.delete(pin.origin);
    await this.refresh().catch(() => undefined);
    this.emit();
    return pin;
  }

  /** Saves a pending pin on a profile that was just created or moved to that address. */
  async adoptPending(profile: Pick<ServerProfile, 'baseUrl'>): Promise<void> {
    const origin = pinOrigin(profile.baseUrl);
    if (origin === undefined) return;
    const pending = this.pending.get(origin);
    if (!pending) return;
    this.pending.delete(origin);
    if (pending.until <= this.now()) return;
    await this.store.setTlsPinForOrigin(origin, pending.pin);
    await this.refresh().catch(() => undefined);
    this.emit();
  }

  /** Forgets the trusted certificate for `url`'s address (every profile there). */
  async forget(url: string): Promise<void> {
    const origin = pinOrigin(url);
    if (origin === undefined) return;
    this.pending.delete(origin);
    this.cache.delete(origin);
    await this.store.setTlsPinForOrigin(origin, undefined);
    await this.refresh().catch(() => undefined);
    this.emit();
  }

  /** Called after any trust change (for UI rows). Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }
}

export async function presentedFromDer(
  origin: string,
  derBase64: string,
): Promise<PresentedCertificate> {
  const der = base64ToBytes(derBase64);
  if (der.length === 0) throw new TlsInspectError('TLS', 'empty certificate');
  const sha256 = await sha256Hex(der);
  let details: CertificateDetails | undefined;
  try {
    details = parseCertificate(der);
  } catch {
    details = undefined;
  }
  return { origin, sha256, details };
}

export function pinFromPresented(presented: PresentedCertificate, now: number): TlsPin {
  const d = presented.details;
  return {
    origin: presented.origin,
    sha256: presented.sha256,
    subject: d ? formatName(d.subject) : '',
    issuer: d ? formatName(d.issuer) : '',
    notBefore: d?.notBefore ?? 0,
    notAfter: d?.notAfter ?? 0,
    pinnedAt: now,
  };
}
