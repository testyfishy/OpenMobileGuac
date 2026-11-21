# Single sign-on (SRV-7) and Duo — experimental

Status: implemented from the Guacamole 1.6.0 source. OpenID Connect was checked on
2026-11-20 against a throwaway local stack (official `guacamole/guacamole:1.6.0` image with
the PostgreSQL and OpenID extensions, Keycloak 26 in dev mode): detection, the IdP round
trip, the return URL shapes and the token exchange. The in-app browser step itself was not
run (it needs the native app on a phone). SAML and CAS are from the source only. Duo is
from the source only (no Duo account). Treat all of it as experimental.

## How Guacamole SSO works (1.6.0)

The SSO extensions (`extensions/guacamole-auth-sso/*`) sign a user in from one
**single-use** parameter that the browser brings back after the identity-provider (IdP)
login:

| Extension | Parameter | Where it arrives | Single use because |
|---|---|---|---|
| OpenID Connect | `id_token` | URL fragment (`#…&id_token=…`, implicit flow) | the nonce is removed on validation (`NonceService.isValid`); a replay got `INVALID_CREDENTIALS` |
| CAS | `ticket` | query string | CAS tickets are single-use |
| SAML | `state` | query string, after the IdP posts to `api/ext/saml/callback` | the stored identity is consumed |

Posting `{ <name>: <value> }` to `api/tokens` returns a normal auth token.

How the app finds out that a server uses SSO (`core/sso/sso.ts`):

1. **REDIRECT field.** When the SSO extension decides the sign-in (it is first in
   `extension-priority`, or alone), `POST api/tokens` with no fields answers with an
   `expected` `REDIRECT` field `{ name, type: "REDIRECT", redirectUrl }`. The web client
   simply navigates there (`form/controllers/redirectFieldController.js`).
2. **Login-page links.** With a database or LDAP back end first (the default when the
   database extension is installed too), the answer lists only username and password. The
   web client then shows "Sign in with …" links from HTML patches. The app reads the same
   patches (`GET api/patches`, no token) and finds `api/ext/<openid|saml|cas>/login`. That
   address redirects to the IdP with a fresh nonce on every visit. On the test server this
   was the only sign of SSO; before this change the app did not offer SSO there at all.

Several providers are offered side by side. The smart-card provider (`ssl`) is skipped.

## The two hand-offs the app offers (Edit server › Single sign-on)

### 1. In-app browser (default; OpenID, SAML, CAS, Duo; no server changes)

The IdP page opens in an in-app web view (`@capacitor/inappbrowser` `openInWebView`). The
app watches `browserPageNavigationCompleted`. When a page is at the expected return address
and carries every parameter it needs, the app closes the web view first and then posts the
values itself.

The expected return address is the server's base URL plus, when the redirect names one,
the server's configured return address: `redirect_uri` for OpenID, `service` for CAS,
`redirect_uri` (query or the signed `request` JWT) for Duo. That address is server
configuration and may differ from the address the app uses (another host name, a reverse
proxy). For `api/ext/<x>/login` links the app cannot read the redirect target (HTTP
redirects are followed), so only the base URL is accepted there.

**Known limitation: the race.** The return page is the Guacamole web app, which also tries
to use the single-use value. Measured in desktop Chromium on localhost: the page finished
loading at 753 ms and sent its own `POST api/tokens` at 923 ms, about 170 ms later. The
app's check runs on "navigation completed", which the plugin fires at the end of the load,
so the app can win if the event reaches JavaScript and the web view closes within that
margin. On a phone the margin and the event latency were not measured. If the page wins,
the app's exchange gets `INVALID_CREDENTIALS` and shows "The server's own web page used the
one-time sign-in result before the app could". The web view and the server page now share
nothing the app could read (no script or storage access), so the app cannot take over the
page's session.

What would remove the race (native code, not done here): stop the web view from loading
the return URL, by intercepting the navigation before it starts (Android
`WebViewClient.shouldOverrideUrlLoading`, iOS `WKNavigationDelegate
decidePolicyForNavigationAction`) and handing the URL to JavaScript. `@capacitor/inappbrowser`
4.1 has no such hook; its Android-only `successUrlPatterns` closes on the finished page load,
which is no earlier than the event the app already uses, and it is not documented whether
the URL still reaches JavaScript, so the app does not use it.

### 2. App callback (OpenID only; no race; needs IdP configuration)

The app rewrites `redirect_uri` in the IdP URL to `openmobileguac://sso-callback` and opens
it in the system browser (SFSafariViewController / Custom Tabs, which also satisfies IdPs
that block embedded web views). The IdP redirects to the app scheme, the OS hands the URL
to the app (`appUrlOpen`), and only the app ever sees the token.

Checked on the test stack: with `openmobileguac://sso-callback` registered as a redirect URI
of the Keycloak client, Keycloak returned
`openmobileguac://sso-callback/#state=…&session_state=…&iss=…&id_token=…` and Guacamole
accepted that token. The server validates signature, issuer, audience and nonce, not the
redirect URI.

This hand-off needs the IdP URL with its `redirect_uri`, so it works only when the server
sends a REDIRECT field. For a provider found through the login-page links the app falls back
to the in-app browser.

What the **IdP administrator** must configure: add `openmobileguac://sso-callback` as an
allowed redirect URI for the client id Guacamole uses (`openid-client-id`). Nothing changes
on the Guacamole server. CAS validates the `service` URL server-side and SAML posts to the
server, so neither can use this route.

**Binding the callback to the attempt (AUDIT #13, 2026-11-21).** Each attempt adds a fresh
random `state` (128 bits) to the IdP URL; OpenID Connect requires the IdP to return it with
the token. The app accepts an `openmobileguac://sso-callback` link only while an attempt is
pending (at most 5 minutes) and only when its `state` matches; any other link is ignored and
logged. The token's nonce, checked by the Guacamole server that issued the sign-in, ties it
to that server. This stops **injection** (another app or a web page sending the app a
callback with someone else's token). It does not stop **interception**: another app that
registered the same custom scheme could still receive the real callback, since the implicit
flow has no PKCE. Use the in-app browser hand-off where that matters, or an IdP that
supports claimed https redirect links (not built).

## Duo (guacamole-auth-duo 1.6.0)

Duo is a second step after the password, not a sign-in provider. The server answers the
correct password with `INSUFFICIENT_CREDENTIALS` and a REDIRECT field `duo_code`; Duo
returns to `duo-redirect-uri` with `duo_code` **and** `state`, and both must be posted back.
`state` names the first-factor credentials the server put aside. The app shows "Continue
to Duo" on the extra step, opens the Duo page in the in-app browser, and posts `username`,
`password`, `duo_code` and `state` together. The full flow, with source references, is in
docs/protocol-notes.md §1.7.

- Duo always uses the in-app browser (Duo returns to the Guacamole address, which the app
  cannot change), so the race above applies.
- If the server's page wins, or `state` expired (`duo-auth-timeout`, default 5 minutes),
  the resent password makes the server start a fresh Duo check rather than refuse the
  sign-in, and the app says "Duo did not confirm the sign-in".
- Duo's own page may refuse an embedded web view in some tenants; not verified.

## Not verified

- The in-app browser on Android and iOS: when `browserPageNavigationCompleted` fires, how
  often the race is lost, and whether IdPs (and Duo) accept an embedded web view.
- SAML and CAS against a real IdP, including SAML `state` placement after the callback.
- Duo against a real Duo tenant.
- Other IdPs (Entra ID, Okta, Authentik) and whether they accept a custom-scheme redirect
  URI for an implicit-flow client.
