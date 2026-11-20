/**
 * Turns what a user typed into the candidate base URLs to probe, in order (SPEC SRV-2).
 *
 * Tolerates:
 * - a missing scheme: try `https://` first, then `http://`;
 * - a missing `/guacamole` context path: try `<path>/guacamole` first, then the path as
 *   typed, because the stock Tomcat and Docker deployments use `/guacamole` and reverse
 *   proxies often serve it at the root;
 * - a trailing slash, query, fragment (`/#/` from a copied web-client URL), or a trailing
 *   `index.html`.
 *
 * A base URL never ends in a slash, for example `https://guac.example/guacamole`.
 *
 * Probing order matters for safety. The caller probes candidates with an unauthenticated
 * request (`GuacApi.probe`) and sends credentials only to the candidate that answered as a
 * Guacamole server. A plain-http candidate is marked `secure: false` so the UI can warn.
 */

export interface ServerUrlCandidate {
  readonly baseUrl: string;
  /** `true` for https. */
  readonly secure: boolean;
}

export type NormalizeResult =
  | { readonly ok: true; readonly candidates: readonly ServerUrlCandidate[] }
  | { readonly ok: false; readonly reason: 'empty' | 'invalid' | 'unsupported-scheme' };

const CONTEXT_SEGMENT = 'guacamole';
const SCHEME_RE = /^([a-z][a-z0-9+.-]*):\/\//i;
/** `host:port` with no scheme would otherwise parse as scheme `host:`. */
const BARE_HOST_PORT_RE = /^[^/:?#]+:\d+(?:[/?#]|$)/;

/**
 * A bare IPv6 literal such as `fe80::1`, `::1` or `fe80::1%en0/guacamole` (host part only up
 * to the first `/`). Needs at least two colons and only hex digits, colons, dots (embedded
 * IPv4) and an optional zone. Returns the input with the host bracketed, or `undefined`.
 */
const BARE_IPV6_RE = /^([0-9a-f]*:[0-9a-f:.]*:[0-9a-f.]*)(%[\w.-]+)?(\/.*)?$/i;

export function bracketBareIpv6(text: string): string | undefined {
  const m = BARE_IPV6_RE.exec(text);
  if (!m) return undefined;
  const host = m[1] ?? '';
  // `URL` does not accept zone ids in brackets; drop it (link-local needs the OS default).
  return `[${host}]${m[3] ?? ''}`;
}

export function normalizeServerUrl(input: string): NormalizeResult {
  let trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'empty' };
  const bracketed = bracketBareIpv6(trimmed);
  if (bracketed !== undefined) trimmed = bracketed;

  let schemes: readonly ('https' | 'http')[];
  let rest: string;
  const schemeMatch = SCHEME_RE.exec(trimmed);
  if (schemeMatch) {
    const scheme = (schemeMatch[1] ?? '').toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') return { ok: false, reason: 'unsupported-scheme' };
    schemes = [scheme];
    rest = trimmed.slice(schemeMatch[0].length);
  } else {
    const hostPart = trimmed.split(/[/?#]/, 1)[0] ?? '';
    if (!hostPart.includes('[') && (hostPart.match(/:/g)?.length ?? 0) >= 2) {
      // Looks like an IPv6 address we could not read: say "invalid", not "wrong scheme".
      return { ok: false, reason: 'invalid' };
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !BARE_HOST_PORT_RE.test(trimmed)) {
      // Something like "ftp:foo" or "mailto:x": a scheme we do not support.
      return { ok: false, reason: 'unsupported-scheme' };
    }
    schemes = ['https', 'http'];
    rest = trimmed.replace(/^\/\//, '');
  }

  let parsed: URL;
  try {
    parsed = new URL(`https://${rest}`);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (!parsed.hostname || parsed.username || parsed.password)
    return { ok: false, reason: 'invalid' };

  const paths = candidatePaths(parsed.pathname);
  const candidates: ServerUrlCandidate[] = [];
  for (const scheme of schemes) {
    for (const path of paths) {
      const url = new URL(`${scheme}://${parsed.host}`);
      // `URL` drops the default port for the scheme, so `https://h:443` becomes `https://h`.
      candidates.push({ baseUrl: `${url.origin}${path}`, secure: scheme === 'https' });
    }
  }
  return { ok: true, candidates: dedupe(candidates) };
}

/** Context-path candidates, each either `''` or starting with `/` and with no trailing slash. */
function candidatePaths(pathname: string): string[] {
  const segments = pathname.split('/').filter((s) => s.length > 0);
  if (segments.length > 0 && /^index\.html?$/i.test(segments[segments.length - 1] ?? '')) {
    segments.pop();
  }
  const path = segments.length > 0 ? `/${segments.join('/')}` : '';
  const last = segments[segments.length - 1];
  if (last !== undefined && last.toLowerCase() === CONTEXT_SEGMENT) return [path];
  return [`${path}/${CONTEXT_SEGMENT}`, path];
}

function dedupe(candidates: ServerUrlCandidate[]): ServerUrlCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((c) => {
    if (seen.has(c.baseUrl)) return false;
    seen.add(c.baseUrl);
    return true;
  });
}

/**
 * The part of a base URL that decides where credentials go: scheme, host, port and context
 * path (lower-cased scheme and host, no trailing slash). Two profiles with the same endpoint
 * may share a token, password or TOTP seed; any change of endpoint must drop them.
 */
export function serverEndpoint(baseUrl: string): string {
  try {
    const u = new URL(baseUrl);
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return baseUrl.trim().replace(/\/+$/, '');
  }
}

export function sameServerEndpoint(a: string, b: string): boolean {
  return serverEndpoint(a) === serverEndpoint(b);
}

/** `host[:port]` of a base URL, for "old → new host" prompts. */
export function serverHostLabel(baseUrl: string): string {
  try {
    const u = new URL(baseUrl);
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return baseUrl;
  }
}

/** Joins a base URL (no trailing slash) and a relative API path such as `api/tokens`. */
export function joinUrl(baseUrl: string, relativePath: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${relativePath.replace(/^\/+/, '')}`;
}
