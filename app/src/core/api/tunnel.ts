import { joinUrl } from '../url/normalizeServerUrl.ts';

/**
 * Tunnel URLs and connect parameters, matching the 1.6.0 web client
 * (`ManagedClient.getConnectString`). See docs/protocol-notes.md §3.
 */

/** `GUAC_TYPE` values (`TunnelRequestType`). */
export type TunnelTargetType = 'c' | 'g' | 'a';

export const TunnelTargetTypes = {
  CONNECTION: 'c',
  CONNECTION_GROUP: 'g',
  ACTIVE_CONNECTION: 'a',
} as const satisfies Record<string, TunnelTargetType>;

export interface TunnelConnectParams {
  /** Auth token (sent as `token=`). */
  readonly token: string;
  /** `GUAC_DATA_SOURCE`. */
  readonly dataSource: string;
  /** `GUAC_ID`: connection, group or active-connection identifier. */
  readonly id: string;
  /** `GUAC_TYPE`. */
  readonly type: TunnelTargetType;
  /** `GUAC_WIDTH` in device pixels (floored). */
  readonly width: number;
  /** `GUAC_HEIGHT` in device pixels (floored). */
  readonly height: number;
  /** `GUAC_DPI` (floored). */
  readonly dpi: number;
  /** `GUAC_TIMEZONE`, IANA zone name. Omitted when undefined. */
  readonly timezone?: string;
  /** `GUAC_AUDIO`, one entry per supported mimetype. */
  readonly audioMimetypes?: readonly string[];
  /** `GUAC_VIDEO`. */
  readonly videoMimetypes?: readonly string[];
  /** `GUAC_IMAGE`. */
  readonly imageMimetypes?: readonly string[];
}

/**
 * Builds the string given to `Guacamole.Client.connect(data)`. The WebSocket tunnel appends
 * it after `?`, and the HTTP tunnel posts it as the body. Parameter order and encoding match
 * the web client.
 */
export function buildTunnelConnectString(p: TunnelConnectParams): string {
  let s =
    'token=' +
    encodeURIComponent(p.token) +
    '&GUAC_DATA_SOURCE=' +
    encodeURIComponent(p.dataSource) +
    '&GUAC_ID=' +
    encodeURIComponent(p.id) +
    '&GUAC_TYPE=' +
    encodeURIComponent(p.type) +
    '&GUAC_WIDTH=' +
    Math.floor(p.width) +
    '&GUAC_HEIGHT=' +
    Math.floor(p.height) +
    '&GUAC_DPI=' +
    Math.floor(p.dpi);
  if (p.timezone !== undefined) s += '&GUAC_TIMEZONE=' + encodeURIComponent(p.timezone);
  for (const m of p.audioMimetypes ?? []) s += '&GUAC_AUDIO=' + encodeURIComponent(m);
  for (const m of p.videoMimetypes ?? []) s += '&GUAC_VIDEO=' + encodeURIComponent(m);
  for (const m of p.imageMimetypes ?? []) s += '&GUAC_IMAGE=' + encodeURIComponent(m);
  return s;
}

/**
 * Optimal display size as the web client computes it: CSS size times `devicePixelRatio`,
 * with DPI `96 * devicePixelRatio`. All values are floored.
 */
export function optimalDisplaySize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio = 1,
): { width: number; height: number; dpi: number } {
  const ratio = devicePixelRatio > 0 ? devicePixelRatio : 1;
  return {
    width: Math.floor(cssWidth * ratio),
    height: Math.floor(cssHeight * ratio),
    dpi: Math.floor(96 * ratio),
  };
}

/**
 * Absolute tunnel endpoint URLs for a base URL.
 *
 * They must be absolute because `Guacamole.WebSocketTunnel` resolves relative URLs against
 * `window.location`, which inside Capacitor is the app's own origin.
 */
export function buildTunnelUrls(baseUrl: string): { websocket: string; http: string } {
  const http = joinUrl(baseUrl, 'tunnel');
  const ws = new URL(joinUrl(baseUrl, 'websocket-tunnel'));
  if (ws.protocol === 'https:') ws.protocol = 'wss:';
  else if (ws.protocol === 'http:') ws.protocol = 'ws:';
  else throw new Error(`Unsupported base URL scheme: ${ws.protocol}`);
  return { websocket: ws.toString(), http };
}
