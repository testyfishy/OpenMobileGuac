import {
  DefaultSystemBrowserOptions,
  DefaultWebViewOptions,
  InAppBrowser,
} from '@capacitor/inappbrowser';
import type { Logger } from '../../core/diagnostics/log.ts';
import {
  extractCallbackParam,
  extractSsoParam,
  newSsoState,
  withAppCallback,
  type SsoRedirect,
} from '../../core/sso/sso.ts';
import { isNative } from '../services/native.ts';
import type { SsoMode } from '../settings/settingsModel.ts';

/**
 * Completes an identity-provider sign-in (SRV-7, experimental) and returns the single-use
 * value the server expects (`id_token`, `ticket` or `state`). Exchanging it for a token is
 * the caller's job (`AuthService.loginWithParameters`).
 *
 * Two hand-offs, see docs/sso.md:
 * - `webview`: open the IdP page in an in-app web view and watch its navigations; when it
 *   comes back to the Guacamole URL with the parameter, close it at once and take the
 *   value. The server's own web page loads there too and may consume the value first.
 * - `app-callback` (OpenID only): send the IdP's redirect to `openmobileguac://sso-callback`
 *   in the system browser, so only the app sees the token. Needs that redirect URI to be
 *   allowed at the IdP.
 */

export type SsoOutcome =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: 'cancelled' | 'unavailable' | 'timeout' };

const TIMEOUT_MS = 10 * 60_000;
/** App-callback attempts expire sooner: the window in which a callback is accepted. */
const CALLBACK_TIMEOUT_MS = 5 * 60_000;

let callbackWaiter: ((url: string) => void) | null = null;

/** Called with `openmobileguac://sso-callback...` URLs from `appUrlOpen`. */
export function deliverSsoCallback(url: string): void {
  callbackWaiter?.(url);
}

export function ssoAvailable(): boolean {
  return isNative();
}

export async function runSso(
  redirect: SsoRedirect,
  baseUrl: string,
  mode: SsoMode,
  log?: Logger,
): Promise<SsoOutcome> {
  if (!ssoAvailable()) return { ok: false, reason: 'unavailable' };
  // One random `state` per attempt; a callback without it is ignored (AUDIT #13). The
  // id_token's nonce, checked by this server, binds it to the expected server as well.
  const state = newSsoState();
  const callbackUrl =
    mode === 'app-callback' && redirect.kind === 'openid'
      ? withAppCallback(redirect.redirectUrl, state)
      : undefined;
  log?.info(
    'sso',
    `starting ${redirect.kind} sign-in (${callbackUrl ? 'app callback' : 'web view'})`,
  );

  return new Promise<SsoOutcome>((resolve) => {
    let finished = false;
    const handles: { remove: () => Promise<void> }[] = [];
    const finish = (outcome: SsoOutcome) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      callbackWaiter = null;
      for (const h of handles) void h.remove().catch(() => undefined);
      void InAppBrowser.close().catch(() => undefined);
      log?.info('sso', outcome.ok ? 'received sign-in result' : `ended: ${outcome.reason}`);
      resolve(outcome);
    };
    const timer = setTimeout(
      () => finish({ ok: false, reason: 'timeout' }),
      callbackUrl ? CALLBACK_TIMEOUT_MS : TIMEOUT_MS,
    );
    const check = (url: string | undefined) => {
      if (!url) return;
      const value = extractSsoParam(url, baseUrl, redirect.paramName);
      if (value) finish({ ok: true, value });
    };

    void (async () => {
      try {
        handles.push(
          await InAppBrowser.addListener('browserClosed', () =>
            // Give a callback that arrives with the close a moment to win.
            setTimeout(() => finish({ ok: false, reason: 'cancelled' }), 400),
          ),
        );
        if (callbackUrl) {
          callbackWaiter = (url) => {
            const value = extractCallbackParam(url, redirect.paramName, state);
            if (value) finish({ ok: true, value });
            else log?.warn('sso', 'ignored an app callback that does not match this sign-in');
          };
          await InAppBrowser.openInSystemBrowser({
            url: callbackUrl,
            options: DefaultSystemBrowserOptions,
          });
        } else {
          handles.push(
            await InAppBrowser.addListener('browserPageNavigationCompleted', (e) => check(e.url)),
          );
          await InAppBrowser.openInWebView({
            url: redirect.redirectUrl,
            options: {
              ...DefaultWebViewOptions,
              showURL: true,
              clearCache: false,
              clearSessionCache: true,
            },
          });
        }
      } catch {
        finish({ ok: false, reason: 'unavailable' });
      }
    })();
  });
}
