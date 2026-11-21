/**
 * Content-Security-Policy for release builds (docs/AUDIT.md §7, R9).
 *
 * Pure string code with no DOM or Node types: `vite.config.ts` imports it to inject the
 * `<meta http-equiv="Content-Security-Policy">` into the production `index.html`, and the
 * unit tests check the result. The dev server gets no policy (Vite's HMR needs inline
 * scripts and eval).
 *
 * Why each source is there:
 * - `'self'` is the app origin: `https://localhost` on Android, `capacitor://localhost` on
 *   iOS. `capacitor://localhost` is also listed explicitly in case a WebKit version does
 *   not match `'self'` against the custom scheme; on Android nothing can load from it.
 * - connect-src: users connect to any Guacamole server they choose, over https or plain
 *   http on private networks, with the WebSocket tunnel over wss or ws. A host list is not
 *   possible, so the four schemes are listed (explicitly, not relying on `http:` implying
 *   `ws:`). This still blocks `data:`, `blob:` and other schemes.
 * - img-src `data:` / `blob:`: connection thumbnails and the TOTP QR code are data URLs;
 *   guacamole-common-js draws PNG/JPEG/WebP instructions from data URLs, falls back to blob
 *   URLs where `createImageBitmap` is missing, and sets the remote cursor as a
 *   `url(data:...)` CSS cursor.
 * - media-src only `'self'`: audio goes through Web Audio buffers (no URL), and the app
 *   has no `<audio>`/`<video>`. guacamole-common-js `Display.play()` (blob video URLs) is
 *   only called by `SessionRecording`, which the app does not use; live `video`
 *   instructions need a `VideoPlayer`, which the library does not ship.
 * - style-src `'self'` without `'unsafe-inline'`: React `style={...}` props and the
 *   vendored library's `element.style.x = ...` go through the CSSOM, which CSP does not
 *   restrict; the bundle sets no `style` attribute from markup.
 * - No `'unsafe-eval'`, no `'wasm-unsafe-eval'` (no WebAssembly), no workers, no frames
 *   (the SSO browser is native, not an iframe), no plugins, no `<base>`, no form posts
 *   (every form calls `preventDefault`).
 *
 * `frame-ancestors`, `report-uri` and `sandbox` are ignored in a meta policy and are not
 * set. A meta policy cannot be report-only.
 *
 * Capacitor on Android: with an old System WebView (no `DOCUMENT_START_SCRIPT`) Capacitor
 * inserts its bridge as an inline `<script>` right after the literal `<head>` of the HTML
 * it serves (JSInjector.getInjectedStream). A meta policy does not apply to content parsed
 * before the meta element, so that script still runs. This depends on `<head>` staying
 * bare and the meta coming after it; `injectCspMeta` and its test enforce both.
 */

/** iOS app origin (Capacitor's default `iosScheme`/hostname). */
export const IOS_APP_ORIGIN = 'capacitor://localhost';

const SELF = ["'self'", IOS_APP_ORIGIN] as const;

export type CspDirectives = Readonly<Record<string, readonly string[]>>;

/** The release policy, directive by directive. */
export const RELEASE_CSP: CspDirectives = {
  'default-src': SELF,
  'script-src': SELF,
  'style-src': SELF,
  'img-src': [...SELF, 'data:', 'blob:'],
  'media-src': SELF,
  'font-src': SELF,
  'connect-src': [...SELF, 'https:', 'wss:', 'http:', 'ws:'],
  'worker-src': ["'none'"],
  'frame-src': ["'none'"],
  'child-src': ["'none'"],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
  'manifest-src': SELF,
};

/** Serialises directives into a policy string (`a x y; b z`). */
export function serializeCsp(directives: CspDirectives = RELEASE_CSP): string {
  return Object.entries(directives)
    .map(([name, sources]) => [name, ...sources].join(' '))
    .join('; ');
}

/** The `<meta>` element carrying the policy. */
export function cspMetaTag(policy: string = serializeCsp()): string {
  // The policy contains no `"`, `<` or `&`; guard anyway so a future edit cannot break out.
  if (/["<>&]/.test(policy)) throw new Error('CSP contains characters not allowed here');
  return `<meta http-equiv="Content-Security-Policy" content="${policy}" />`;
}

/**
 * Inserts the policy meta right after `<meta charset>` (charset must stay first). Throws
 * when the document does not have the shape the Android inline-bridge fallback relies on:
 * a bare `<head>` that comes before the policy.
 */
export function injectCspMeta(html: string, policy: string = serializeCsp()): string {
  if (/http-equiv=["']?Content-Security-Policy/i.test(html)) {
    throw new Error('index.html already has a Content-Security-Policy meta');
  }
  const head = html.indexOf('<head>');
  if (head < 0) {
    // Capacitor's JSInjector would then insert its fallback bridge before </head>, i.e.
    // after the policy, where it would be blocked.
    throw new Error('index.html must contain a bare <head> (see Capacitor JSInjector)');
  }
  const charset = /<meta\s+charset=[^>]*>/i.exec(html);
  if (!charset || charset.index < head)
    throw new Error('index.html needs <meta charset> in <head>');
  const at = charset.index + charset[0].length;
  return `${html.slice(0, at)}\n    ${cspMetaTag(policy)}${html.slice(at)}`;
}
