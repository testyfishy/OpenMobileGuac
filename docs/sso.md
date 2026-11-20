# Single sign-on (SRV-7) — experimental

Status: implemented from the Guacamole 1.6.0 source; **not verified against a live identity
provider** (none was available). Treat it as experimental.

## How Guacamole SSO works (1.6.0)

The SSO extensions (`extensions/guacamole-auth-sso/*`) answer `POST api/tokens` without the
right parameter with an error whose `expected` fields contain a `REDIRECT` field
(`{ name, type: "REDIRECT", redirectUrl }`). The web client just navigates to `redirectUrl`
(`form/controllers/redirectFieldController.js`). After the identity-provider (IdP) login the
browser comes back to the Guacamole web app with one **single-use** parameter:

| Extension | Parameter | Where it arrives | Single use because |
|---|---|---|---|
| OpenID Connect | `id_token` | URL fragment (`#id_token=…`, implicit flow) | the nonce is removed on validation (`NonceService.isValid`) |
| CAS | `ticket` | query string | CAS tickets are single-use |
| SAML | `state` | query/fragment, after the IdP posts to `api/ext/saml/callback` | the stored identity is consumed |

Posting `{ <name>: <value> }` to `api/tokens` returns a normal auth token.

The app detects SSO the way the web client does: on the sign-in screen it posts empty
credentials and looks for a `REDIRECT` field (the web client does this on every page load,
so it does not count as a failed login). It then shows "Continue to sign-in page".

## The two hand-offs the app offers (Edit server › Single sign-on)

### 1. In-app browser (default; OpenID, SAML, CAS; no server changes)

The IdP page opens in an in-app web view (`@capacitor/inappbrowser` `openInWebView`). The app
watches `browserPageNavigationCompleted`; when the URL is back on the server's base URL with the
parameter, it closes the web view at once and exchanges the value itself.

**Known limitation (a race):** that last page is the Guacamole web app, which also tries to use
the single-use value. If it wins, the app's exchange fails and the user sees "The server's own
web page used the one-time sign-in result before the app could". The plugin reports the URL
only when navigation completes and gives no script or storage access, so the app cannot stop
the page or read the page's own token. How often this happens could not be measured.

### 2. App callback (OpenID only; reliable; needs IdP configuration)

The app rewrites `redirect_uri` in the IdP URL to `openmobileguac://sso-callback` and opens it
in the system browser (SFSafariViewController / Custom Tabs, which also satisfies IdPs that
block embedded web views). The IdP redirects to the app scheme, the OS hands the URL to the
app (`appUrlOpen`), and only the app ever sees the token.

What the **IdP administrator** must configure: add `openmobileguac://sso-callback` as an
allowed redirect URI for the client id Guacamole uses (`openid-client-id`). Nothing changes on
the Guacamole server: it validates the token's signature, issuer, audience and nonce, not the
redirect URI. CAS validates the `service` URL server-side and SAML posts to the server, so
neither can use this route.

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

## Not verified

- Behaviour with real IdPs (Keycloak, Entra ID, Okta, Authentik), including whether they
  accept a custom-scheme redirect URI for an implicit-flow client.
- When exactly `browserPageNavigationCompleted` fires on each platform, and so how often the
  race in hand-off 1 is lost.
- SAML `state` placement after the callback redirect.
