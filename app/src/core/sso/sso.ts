import type { FieldDescriptor } from '../models/ApiErrorBody.ts';

/**
 * Single sign-on helpers (SPEC SRV-7). Pure.
 *
 * Guacamole's SSO extensions (1.6.0 `guacamole-auth-sso-*`) answer `POST api/tokens` with an
 * error whose `expected` fields contain one `REDIRECT` field: `{ name, type: 'REDIRECT',
 * redirectUrl }`. The web client simply navigates to `redirectUrl`. After the identity
 * provider (IdP) login, the browser comes back to the Guacamole web app carrying one
 * single-use parameter named after the field:
 *
 * - OpenID Connect: `id_token`, in the URL fragment (`#id_token=...`; implicit flow). The
 *   server checks the token's nonce and removes it, so the token works once.
 * - CAS: `ticket`, in the query string. CAS tickets are single-use.
 * - SAML: `state`, in the query string or fragment, naming an identity the server stores
 *   after the IdP posts to its assertion consumer service.
 *
 * Submitting `{ [name]: value }` to `POST api/tokens` yields a normal auth token.
 * See docs/sso.md for the flows the app offers and what an administrator must configure.
 */

export type SsoKind = 'openid' | 'cas' | 'saml' | 'unknown';

export interface SsoRedirect {
  /** Form parameter the server expects back (`id_token`, `ticket`, `state`). */
  readonly paramName: string;
  /** Where to send the user (the IdP login page). */
  readonly redirectUrl: string;
  readonly kind: SsoKind;
}

/** Custom-scheme callback for OpenID when the IdP allows it as a redirect URI. */
export const APP_SSO_CALLBACK = 'openmobileguac://sso-callback';

export function ssoKindOf(paramName: string): SsoKind {
  switch (paramName) {
    case 'id_token':
      return 'openid';
    case 'ticket':
      return 'cas';
    case 'state':
      return 'saml';
    default:
      return 'unknown';
  }
}

export function findSsoRedirect(expected: readonly FieldDescriptor[]): SsoRedirect | undefined {
  for (const f of expected) {
    if (f.type !== 'REDIRECT') continue;
    const url = f.extra['redirectUrl'];
    if (typeof url !== 'string') continue;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') continue;
    } catch {
      continue;
    }
    return { paramName: f.name, redirectUrl: url, kind: ssoKindOf(f.name) };
  }
  return undefined;
}

/** Parameters from a query string or fragment, including Angular's `#/?a=b` form. */
function paramsOf(url: URL): URLSearchParams[] {
  const out = [url.searchParams];
  const hash = url.hash.replace(/^#/, '');
  if (hash) {
    const q = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : hash;
    out.push(new URLSearchParams(q));
  }
  return out;
}

function normalisePath(p: string): string {
  return p.replace(/\/+$/, '');
}

/**
 * The SSO parameter from a URL the in-app browser reached, if that URL is the Guacamole web
 * app at `baseUrl` (same origin, path at or below the base path).
 */
export function extractSsoParam(
  rawUrl: string,
  baseUrl: string,
  paramName: string,
): string | undefined {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  // The app callback is never accepted here: only `extractCallbackParam`, with the
  // attempt's `state`, takes values from it.
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return undefined;
  }
  if (url.origin !== base.origin) return undefined;
  const basePath = normalisePath(base.pathname);
  const path = normalisePath(url.pathname);
  if (basePath && path !== basePath && !path.startsWith(`${basePath}/`)) return undefined;
  for (const p of paramsOf(url)) {
    const v = p.get(paramName);
    if (v) return v;
  }
  return undefined;
}

/**
 * For OpenID: the IdP URL with `redirect_uri` replaced by the app callback, so the IdP
 * sends the token straight to the app instead of to the server's web page (which would use
 * the single-use token first). Works only if the IdP lists `APP_SSO_CALLBACK` as an allowed
 * redirect URI for Guacamole's client id. `undefined` if the URL has no `redirect_uri`.
 */
export function withAppCallback(
  redirectUrl: string,
  state: string,
  callback = APP_SSO_CALLBACK,
): string | undefined {
  let url: URL;
  try {
    url = new URL(redirectUrl);
  } catch {
    return undefined;
  }
  if (!url.searchParams.has('redirect_uri')) return undefined;
  url.searchParams.set('redirect_uri', callback);
  // OpenID Connect Core §3.2.2.5: the IdP returns `state` unchanged with the token, which
  // binds the callback to this attempt (AUDIT #13). Guacamole's own request has none.
  url.searchParams.set('state', state);
  return url.toString();
}

/** A fresh unguessable `state` for one app-callback attempt (128 bits, URL-safe). */
export function newSsoState(crypto: Crypto = globalThis.crypto): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The SSO value from an `openmobileguac://sso-callback` URL, only when it carries the
 * `state` of the pending attempt. Any other link (another app claiming the scheme, a
 * replayed or stale callback) is rejected.
 */
export function extractCallbackParam(
  rawUrl: string,
  paramName: string,
  expectedState: string,
): string | undefined {
  if (!rawUrl.toLowerCase().startsWith(APP_SSO_CALLBACK)) return undefined;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  const sets = paramsOf(url);
  const state = sets.map((p) => p.get('state')).find((v) => v);
  if (!expectedState || state !== expectedState) return undefined;
  for (const p of sets) {
    const v = p.get(paramName);
    if (v) return v;
  }
  return undefined;
}
