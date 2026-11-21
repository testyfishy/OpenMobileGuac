import type { FieldDescriptor } from '../models/ApiErrorBody.ts';

/**
 * Single sign-on and Duo helpers (SPEC SRV-7). Pure.
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
 * - SAML: `state`, in the query string, naming an identity the server stores after the IdP
 *   posts to its assertion consumer service (`api/ext/saml/callback`).
 *
 * The REDIRECT field is only sent when the SSO extension decides the request (it is first in
 * `extension-priority`, or the only one). With a database or LDAP back end ahead of it the
 * server lists only username/password, and the web client offers the provider through an
 * HTML patch (`GET api/patches`) linking to `api/ext/<provider>/login`, which redirects to
 * the IdP with a fresh nonce (`SSOResource.redirectToIdentityProvider`). `ssoProvidersFromPatches`
 * reads those links. Verified against a local 1.6.0 server with Keycloak (docs/sso.md).
 *
 * Duo (`guacamole-auth-duo` 1.6.0, `UserVerificationService`) is a second step after the
 * password: an `INSUFFICIENT_CREDENTIALS` error with a REDIRECT field named `duo_code`. Duo
 * returns to `duo-redirect-uri` with `duo_code` **and** `state`; both must be posted back.
 * `state` names the deferred first-factor credentials (`DuoAuthenticationProvider
 * .updateCredentials`). See docs/protocol-notes.md §1.6.
 *
 * Submitting the returned parameters to `POST api/tokens` yields a normal auth token.
 * See docs/sso.md for the flows the app offers and what an administrator must configure.
 */

export type SsoKind = 'openid' | 'cas' | 'saml' | 'duo' | 'unknown';

export interface SsoRedirect {
  /** Form parameter the server named in its REDIRECT field (`id_token`, `ticket`, `state`, `duo_code`). */
  readonly paramName: string;
  /** Where to send the user (the IdP or Duo page, or the server's `api/ext/<x>/login`). */
  readonly redirectUrl: string;
  readonly kind: SsoKind;
}

/** Custom-scheme callback for OpenID when the IdP allows it as a redirect URI. */
export const APP_SSO_CALLBACK = 'openmobileguac://sso-callback';

/** Field name of the Duo REDIRECT field (`UserVerificationService.DUO_CODE_PARAMETER_NAME`). */
export const DUO_CODE_PARAM = 'duo_code';
/** Duo's opaque session id (`UserVerificationService.DUO_STATE_PARAMETER_NAME`). */
export const DUO_STATE_PARAM = 'state';

export function ssoKindOf(paramName: string): SsoKind {
  switch (paramName) {
    case 'id_token':
      return 'openid';
    case 'ticket':
      return 'cas';
    case 'state':
      return 'saml';
    case DUO_CODE_PARAM:
      return 'duo';
    default:
      return 'unknown';
  }
}

/** Every parameter the return URL must carry for this kind; all are posted back. */
export function returnParamNames(redirect: Pick<SsoRedirect, 'kind' | 'paramName'>): string[] {
  return redirect.kind === 'duo' ? [DUO_CODE_PARAM, DUO_STATE_PARAM] : [redirect.paramName];
}

function httpUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? raw : undefined;
  } catch {
    return undefined;
  }
}

function redirectFields(expected: readonly FieldDescriptor[]): SsoRedirect[] {
  const out: SsoRedirect[] = [];
  for (const f of expected) {
    if (f.type !== 'REDIRECT') continue;
    const url = httpUrl(f.extra['redirectUrl']);
    if (url) out.push({ paramName: f.name, redirectUrl: url, kind: ssoKindOf(f.name) });
  }
  return out;
}

/** The first sign-in (SSO) REDIRECT field. Duo's second-step field is not SSO. */
export function findSsoRedirect(expected: readonly FieldDescriptor[]): SsoRedirect | undefined {
  return redirectFields(expected).find((r) => r.kind !== 'duo');
}

/** Duo's REDIRECT field (`duo_code`) after the password step, if the server sent one. */
export function findDuoRedirect(expected: readonly FieldDescriptor[]): SsoRedirect | undefined {
  return redirectFields(expected).find((r) => r.kind === 'duo');
}

/** Providers the web client lists under "Sign in with" (from `api/patches`). */
const PATCH_PROVIDERS: Readonly<Record<string, { kind: SsoKind; param: string }>> = {
  openid: { kind: 'openid', param: 'id_token' },
  saml: { kind: 'saml', param: 'state' },
  cas: { kind: 'cas', param: 'ticket' },
};

/**
 * SSO providers advertised by the server's HTML patches (`GET api/patches`, a JSON array of
 * strings). Each SSO extension adds `<a href="api/ext/<name>/login">`; the SSL/smart-card
 * provider is skipped (it needs a client certificate). Order is the server's.
 */
export function ssoProvidersFromPatches(patches: unknown, baseUrl: string): SsoRedirect[] {
  if (!Array.isArray(patches)) return [];
  const base = baseUrl.replace(/\/+$/, '');
  const seen = new Set<string>();
  const out: SsoRedirect[] = [];
  for (const p of patches) {
    if (typeof p !== 'string') continue;
    for (const m of p.matchAll(/href\s*=\s*["']api\/ext\/([a-z0-9-]+)\/login["']/gi)) {
      const name = (m[1] ?? '').toLowerCase();
      const known = PATCH_PROVIDERS[name];
      if (!known || seen.has(name)) continue;
      seen.add(name);
      out.push({
        paramName: known.param,
        redirectUrl: `${base}/api/ext/${name}/login`,
        kind: known.kind,
      });
    }
  }
  return out;
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

function isAtOrBelow(url: URL, target: string): boolean {
  let base: URL;
  try {
    base = new URL(target);
  } catch {
    return false;
  }
  if (url.origin !== base.origin) return false;
  const basePath = normalisePath(base.pathname);
  const path = normalisePath(url.pathname);
  return !basePath || path === basePath || path.startsWith(`${basePath}/`);
}

/** The payload of a JWT (no signature check: only used to read where Duo will return). */
function jwtPayload(jwt: string): Record<string, unknown> | undefined {
  const part = jwt.split('.')[1];
  if (!part) return undefined;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json: unknown = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
    return json !== null && typeof json === 'object'
      ? (json as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Where the browser will come back with the result: the server's base URL plus, when the
 * server-supplied redirect says so, its configured return address. That address is server
 * configuration (`openid-redirect-uri`, CAS `service`, `duo-redirect-uri`) and may differ
 * from the address the app uses (another host name, a proxy, a different path).
 * - OpenID: the `redirect_uri` query parameter of the IdP URL.
 * - CAS: the `service` query parameter.
 * - Duo: `redirect_uri`, as a query parameter or inside the `request` JWT
 *   (Duo Universal Prompt's signed request object).
 * - SAML, and `api/ext/<x>/login` links: the base URL only.
 */
export function expectedReturnTargets(redirect: SsoRedirect, baseUrl: string): string[] {
  const out = [baseUrl];
  let url: URL;
  try {
    url = new URL(redirect.redirectUrl);
  } catch {
    return out;
  }
  const add = (v: unknown) => {
    const ok = httpUrl(v);
    if (ok && !out.includes(ok)) out.push(ok);
  };
  if (redirect.kind === 'openid') add(url.searchParams.get('redirect_uri'));
  if (redirect.kind === 'cas') add(url.searchParams.get('service'));
  if (redirect.kind === 'duo') {
    add(url.searchParams.get('redirect_uri'));
    const req = url.searchParams.get('request');
    if (req) add(jwtPayload(req)?.['redirect_uri']);
  }
  return out;
}

/**
 * The result parameters from a URL the in-app browser reached, if that URL is at or below one
 * of `targets` (same origin, path at or below) and carries **every** name in `names`.
 */
export function extractReturnParams(
  rawUrl: string,
  targets: readonly string[],
  names: readonly string[],
): Record<string, string> | undefined {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  // The app callback is never accepted here: only `extractCallbackParam`, with the
  // attempt's `state`, takes values from it.
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  if (!targets.some((t) => isAtOrBelow(url, t))) return undefined;
  const sets = paramsOf(url);
  const out: Record<string, string> = {};
  for (const name of names) {
    const v = sets.map((p) => p.get(name)).find((x) => x);
    if (!v) return undefined;
    out[name] = v;
  }
  return out;
}

/**
 * One SSO parameter from a URL on the Guacamole web app at `baseUrl` (same origin, path at
 * or below the base path).
 */
export function extractSsoParam(
  rawUrl: string,
  baseUrl: string,
  paramName: string,
): string | undefined {
  return extractReturnParams(rawUrl, [baseUrl], [paramName])?.[paramName];
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
 * replayed or stale callback) is rejected. Keycloak 26 returns
 * `openmobileguac://sso-callback/#state=…&id_token=…` (note the `/`).
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
