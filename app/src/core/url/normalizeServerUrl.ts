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

export function normalizeServerUrl(input: string): NormalizeResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'empty' };

  let schemes: readonly ('https' | 'http')[];
  let rest: string;
  const schemeMatch = SCHEME_RE.exec(trimmed);
  if (schemeMatch) {
    const scheme = (schemeMatch[1] ?? '').toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') return { ok: false, reason: 'unsupported-scheme' };
    schemes = [scheme];
    rest = trimmed.slice(schemeMatch[0].length);
  } else {
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

/** Joins a base URL (no trailing slash) and a relative API path such as `api/tokens`. */
export function joinUrl(baseUrl: string, relativePath: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${relativePath.replace(/^\/+/, '')}`;
}
