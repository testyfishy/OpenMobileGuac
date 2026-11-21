import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SsoRedirect } from '../../core/sso/sso.ts';

/**
 * The native hand-off with the in-app browser plugin replaced by a fake: what a device does
 * cannot run here, so these tests drive the plugin's events in the order the plugin
 * documents (`browserPageNavigationCompleted` per page, `browserClosed` at the end).
 */

type Listener = (data?: { url?: string }) => void;
const listeners = new Map<string, Listener>();
const calls: string[] = [];

vi.mock('@capacitor/inappbrowser', () => ({
  DefaultWebViewOptions: {},
  DefaultSystemBrowserOptions: {},
  InAppBrowser: {
    addListener: (name: string, fn: Listener) => {
      listeners.set(name, fn);
      return Promise.resolve({ remove: () => Promise.resolve() });
    },
    openInWebView: (o: { url: string }) => {
      calls.push(`webview ${o.url}`);
      return Promise.resolve();
    },
    openInSystemBrowser: (o: { url: string }) => {
      calls.push(`system ${o.url}`);
      return Promise.resolve();
    },
    close: () => {
      calls.push('close');
      return Promise.resolve();
    },
  },
}));
vi.mock('../services/native.ts', () => ({ isNative: () => true }));

const { runSso, deliverSsoCallback } = await import('./ssoFlow.ts');

const BASE = 'https://guac.example.test/guacamole';
const tick = () => new Promise((r) => setTimeout(r, 0));

function navigate(url: string): void {
  listeners.get('browserPageNavigationCompleted')?.({ url });
}

beforeEach(() => {
  listeners.clear();
  calls.length = 0;
});

describe('runSso: in-app web view', () => {
  it('Duo: waits for duo_code and state on the return page, closes, then resolves both', async () => {
    const duo: SsoRedirect = {
      paramName: 'duo_code',
      kind: 'duo',
      redirectUrl: `https://api-1.duo.example.test/oauth/v1/authorize?redirect_uri=${BASE}/&request=x`,
    };
    const p = runSso(duo, BASE, 'app-callback', undefined);
    await tick();
    expect(calls).toEqual([`webview ${duo.redirectUrl}`]); // Duo never uses the app callback
    navigate('https://api-1.duo.example.test/frame/prompt?sid=1'); // the Duo page
    navigate(`${BASE}/?duo_code=C1`); // incomplete
    navigate(`${BASE}/?duo_code=C1&state=S1`);
    await expect(p).resolves.toEqual({ ok: true, values: { duo_code: 'C1', state: 'S1' } });
    expect(calls.at(-1)).toBe('close');
  });

  it('OpenID through the server login link: token from the fragment on the base URL', async () => {
    const r: SsoRedirect = {
      paramName: 'id_token',
      kind: 'openid',
      redirectUrl: `${BASE}/api/ext/openid/login`,
    };
    const p = runSso(r, BASE, 'webview', undefined);
    await tick();
    navigate(`${BASE}/api/ext/openid/login`);
    navigate('https://idp.example.test/realms/lab/protocol/openid-connect/auth?x=1');
    navigate(`${BASE}/#session_state=s&id_token=T1`);
    await expect(p).resolves.toEqual({ ok: true, values: { id_token: 'T1' } });
  });

  it('reports a closed web view as cancelled', async () => {
    vi.useFakeTimers();
    try {
      const r: SsoRedirect = {
        paramName: 'ticket',
        kind: 'cas',
        redirectUrl: 'https://cas.example.test/login',
      };
      const p = runSso(r, BASE, 'webview', undefined);
      await vi.advanceTimersByTimeAsync(0);
      listeners.get('browserClosed')?.();
      await vi.advanceTimersByTimeAsync(500);
      await expect(p).resolves.toEqual({ ok: false, reason: 'cancelled' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('runSso: app callback (OpenID)', () => {
  it('accepts only the callback carrying this attempt’s state', async () => {
    const r: SsoRedirect = {
      paramName: 'id_token',
      kind: 'openid',
      redirectUrl:
        'https://idp.example.test/auth?response_type=id_token&client_id=guacamole' +
        `&redirect_uri=${encodeURIComponent(`${BASE}/`)}&nonce=n1`,
    };
    const p = runSso(r, BASE, 'app-callback', undefined);
    await tick();
    const opened = calls[0]?.replace(/^system /, '') ?? '';
    const state = new URL(opened).searchParams.get('state') ?? '';
    expect(new URL(opened).searchParams.get('redirect_uri')).toBe('openmobileguac://sso-callback');
    expect(state).toMatch(/^[0-9a-f]{32}$/);
    deliverSsoCallback('openmobileguac://sso-callback/#state=forged&id_token=EVIL');
    deliverSsoCallback(`openmobileguac://sso-callback/#state=${state}&session_state=s&id_token=T2`);
    await expect(p).resolves.toEqual({ ok: true, values: { id_token: 'T2' } });
  });
});
