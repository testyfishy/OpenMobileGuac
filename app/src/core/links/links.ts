import type { ConnectionRef } from '../storage/ProfileStore.ts';

/**
 * App links (SPEC CON-5) and Guacamole share links (CON-6). Pure.
 *
 * - `openmobileguac://connect?server=<profileId>&connection=<identifier>[&source=<ds>][&type=c|g]`
 *   opens a saved connection. The scheme must be registered natively (AndroidManifest
 *   intent filter, iOS CFBundleURLTypes) and arrives through `@capacitor/app` `appUrlOpen`.
 * - `openmobileguac://sso-callback...` carries an SSO result (see `sso/sso.ts`).
 * - A Guacamole share link is the web app URL with `?key=` or `#/?key=`; signing in with
 *   `{ key }` gives a session that contains the shared connection.
 */

export const APP_SCHEME = 'openmobileguac';

export type AppLink =
  | {
      readonly kind: 'connect';
      readonly serverId: string;
      readonly identifier: string;
      readonly dataSource: string | undefined;
      readonly type: ConnectionRef['type'];
    }
  | { readonly kind: 'sso-callback'; readonly url: string };

export function parseAppLink(raw: string): AppLink | undefined {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== `${APP_SCHEME}:`) return undefined;
  // `openmobileguac://connect?...` → host "connect" (or pathname "//connect" on some engines).
  const action = (
    url.host ||
    url.pathname.replace(/^\/+/, '').split(/[/?]/)[0] ||
    ''
  ).toLowerCase();
  if (action === 'sso-callback') return { kind: 'sso-callback', url: raw.trim() };
  if (action !== 'connect') return undefined;
  const serverId = url.searchParams.get('server')?.trim();
  const identifier = url.searchParams.get('connection')?.trim();
  if (!serverId || !identifier) return undefined;
  const type = url.searchParams.get('type') === 'g' ? 'g' : 'c';
  const source = url.searchParams.get('source')?.trim();
  return { kind: 'connect', serverId, identifier, dataSource: source || undefined, type };
}

export function buildConnectLink(serverId: string, ref: ConnectionRef): string {
  const q = new URLSearchParams({
    server: serverId,
    connection: ref.identifier,
    source: ref.dataSource,
  });
  if (ref.type === 'g') q.set('type', 'g');
  return `${APP_SCHEME}://connect?${q.toString()}`;
}

export interface ShareLink {
  /** The Guacamole web app URL without query or fragment, no trailing slash. */
  readonly baseUrl: string;
  readonly key: string;
}

/** Parses a Guacamole share link (`https://host/guacamole/#/?key=...`). */
export function parseShareLink(raw: string): ShareLink | undefined {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  let key = url.searchParams.get('key');
  if (!key && url.hash) {
    const h = url.hash.replace(/^#/, '');
    const q = h.includes('?') ? h.slice(h.indexOf('?') + 1) : h;
    key = new URLSearchParams(q).get('key');
  }
  if (!key) return undefined;
  const path = url.pathname.replace(/\/(index\.html)?$/, '').replace(/\/+$/, '');
  return { baseUrl: `${url.origin}${path}`, key };
}
