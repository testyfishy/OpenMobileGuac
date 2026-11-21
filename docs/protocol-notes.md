# Guacamole 1.6.0 protocol notes

What the OpenMobileGuac client needs to know about the Guacamole server's REST API and
tunnel, read from the upstream source rather than assumed. The server interface is not a
documented public API, so every claim below cites the file it came from.

- Upstream repository: `apache/guacamole-client`, tag `1.6.0` (annotated tag object
  `bb2af05a8286fe64de66ed9e762f7e66ec1ab178`, pointing at commit
  `0537c89cd783681b986ff8f8c4e0b97ec6873371`).
- Path abbreviations used below:
  - `FE/` = `guacamole/src/main/frontend/src/app/` (the AngularJS web client)
  - `JAVA/` = `guacamole/src/main/java/org/apache/guacamole/` (the web application)
  - `EXT/` = `guacamole-ext/src/main/java/org/apache/guacamole/`
  - `COMMON/` = `guacamole-common/src/main/java/org/apache/guacamole/`
  - `JS/` = `guacamole-common-js/src/main/webapp/modules/` (the JavaScript client library)
- All URLs are relative to the server's base URL, which includes the web application's
  context path. Example: `https://guac.example/guacamole/`. The REST API is served under
  `api/*` (`JAVA/rest/RESTServiceModule.java`, `serve("/api/*")`).

Implemented in `app/src/core/` (see `api/GuacApi.ts`, `api/tunnel.ts`).

---

## 1. Authentication

### 1.1 Create a token (log in)

| | |
|---|---|
| Request | `POST api/tokens` |
| Content type | `application/x-www-form-urlencoded` |
| Body | Form fields. `username` and `password` for the default login, plus any extra fields the server asked for (§1.4). Every value the user has entered is sent again on each attempt. |
| Optional field | `token`: an existing token. The server re-authenticates against that session and normally returns the same token. |
| Success | `200` with JSON `{ authToken, username, dataSource, availableDataSources }` |

Sources:

- Request shape: `FE/auth/service/authenticationService.js`, `service.authenticate`. The
  web client posts `$.param(requestParams)` to `api/tokens` with
  `Content-Type: application/x-www-form-urlencoded`. `service.login` passes
  `{ username, password }`, and `service.updateCurrentToken` adds `token` when one is
  already known.
- Server side: `JAVA/rest/auth/TokenRESTService.java`, `createToken`. It is
  `@POST` on `@Path("/tokens")` and takes `@FormParam` `username`, `password` and `token`.
  The full `MultivaluedMap` of form parameters is passed to the auth providers as an
  `APIRequest`, so extension fields such as `guac-totp` arrive as ordinary form
  parameters.
- HTTP Basic fallback: if `username` and `password` are both absent, the server reads an
  `Authorization: Basic …` header (`TokenRESTService.getCredentials`). We do not use this.
- Response type: `JAVA/rest/auth/APIAuthenticationResult.java` has the fields `authToken`,
  `username`, `dataSource` (the identifier of the auth provider that authenticated the
  user) and `availableDataSources` (a list of the identifiers of every auth provider that
  gave the user a `UserContext`). The client-side mirror is
  `FE/auth/types/AuthenticationResult.js`. The anonymous username is the empty string
  (`AuthenticationResult.ANONYMOUS_USERNAME = ''`).
- Resubmitting extra fields: `FE/login/directives/login.js`, `$scope.login`. It merges URL
  parameters with every entered field value and calls `authenticationService.authenticate`
  again, so it is a fresh `POST api/tokens`. Fields the server did not ask for again
  (username, password) are still included.

### 1.2 Sending the token on later requests

- Preferred: the HTTP header `Guacamole-Token: <token>`. The web client adds it in
  `FE/auth/service/authenticationService.js`, `service.request`
  (`headers : { 'Guacamole-Token' : token }`).
- Fallback: the query parameter `?token=<token>`. The server checks the header first and
  then the query parameter (`JAVA/rest/auth/AuthenticationService.java`,
  `getAuthenticationToken`; the constants are `TOKEN_HEADER_NAME = "Guacamole-Token"` and
  `TOKEN_PARAMETER_NAME = "token"`). Session-scoped resources get the token through
  `@TokenParam` (`JAVA/rest/TokenParamProvider.java`).
- The web client still uses the query parameter for tunnel stream downloads and uploads
  (`FE/rest/services/tunnelService.js`, `'?token=' + …`), and the tunnel connect string
  carries it as `token=` (§3).
- We send the header for REST calls, which keeps the token out of URLs and logs.

### 1.3 Token validity and logout

- Check validity: `HEAD api/session` with the token header. Success means the token is
  usable. Sources: `FE/auth/service/authenticationService.js`, `service.getValidity`; and
  `JAVA/rest/session/SessionResource.java`, `@HEAD checkValidity`.
- Log out: `DELETE api/session` with the token header. This is what the web client does
  (`authenticationService.js`, `service.revokeToken` and `service.logout`). Server side:
  `SessionResource.java`, `@DELETE invalidate`. `JAVA/rest/session/SessionRESTService.java`
  resolves the session with `getGuacamoleSession` before `invalidate` runs, so a dead token
  gets the 403 `PERMISSION_DENIED` response described below. `invalidate`'s own
  "No such token." (`NOT_FOUND`) is only reachable in a race. Our `logout` treats 403 and 404
  as already logged out.
- Alternative: `DELETE api/tokens/{token}` also exists
  (`JAVA/rest/auth/TokenRESTService.java`, `invalidateToken`). The web client does not
  use it.
- An unknown or expired token on any `api/session/...` request makes
  `AuthenticationService.getGuacamoleSession` throw
  `GuacamoleUnauthorizedException("Permission Denied.")`
  (`JAVA/rest/auth/AuthenticationService.java`). `RESTExceptionMapper` then destroys any
  session for that token and returns the error JSON (§1.4).

### 1.4 Error responses

Every `GuacamoleException` thrown by a REST resource becomes a JSON body with the
exception's HTTP status (`JAVA/rest/RESTExceptionMapper.java`, `toResponse`). Any other
exception becomes `500` with type `INTERNAL_ERROR`.

The body is `JAVA/rest/APIError.java` (mirrored by `FE/rest/types/Error.js`):

```json
{
  "message": "A TOTP authentication code is required before login can continue",
  "translatableMessage": { "key": "TOTP.INFO_CODE_REQUIRED", "variables": null },
  "statusCode": null,
  "expected": [ { "name": "guac-totp", "type": "GUAC_TOTP_CODE" } ],
  "patches": null,
  "type": "INSUFFICIENT_CREDENTIALS"
}
```

This example was built from the source, not captured from a server. It assumes
Jackson's default null handling for `APIError`, which has no `@JsonInclude` annotation.

- `type` is one of `BAD_REQUEST`, `INVALID_CREDENTIALS`, `INSUFFICIENT_CREDENTIALS`,
  `INTERNAL_ERROR`, `NOT_FOUND`, `PERMISSION_DENIED`, `STREAM_ERROR`
  (`APIError.Type.fromGuacamoleException`). Insufficient credentials is tested first, then
  invalid credentials, then `GuacamoleSecurityException` (permission denied), then not
  found, then `GuacamoleClientException` (bad request).
- `expected` is only set for `GuacamoleCredentialsException` subclasses
  (`getCredentialsInfo().getFields()`). It is a list of form `Field` objects:
  - Every field has `name` and `type`, plus optional `options`
    (`EXT/form/Field.java`, `@JsonInclude(NON_NULL)`). The standard types are `TEXT`,
    `EMAIL`, `USERNAME`, `PASSWORD`, `NUMERIC`, `BOOLEAN`, `ENUM`, `MULTILINE`, `TIMEZONE`,
    `LANGUAGE`, `DATE`, `TIME`, `QUERY_PARAMETER`, `TERMINAL_COLOR_SCHEME` and `REDIRECT`.
  - Extensions add their own types and extra getters. The TOTP field
    (`extensions/guacamole-auth-totp/src/main/java/org/apache/guacamole/auth/totp/form/AuthenticationCodeField.java`)
    has name `guac-totp` and type `GUAC_TOTP_CODE`. During enrolment it also exposes the
    user's key details (getters `getUsername`, `getSecret`, `getIssuer`, `getDigits`,
    `getMode`, `getPeriod`, `getKeyUri` and `getQrCode`, so the JSON properties `username`,
    `secret`, `issuer`, `digits`, `mode`, `period`, `keyUri` and `qrCode`). These are null, and so omitted, when the user is already enrolled.
- `translatableMessage` is `{ key, variables }`
  (`EXT/language/TranslatableMessage.java`). For exceptions that are not translatable it is
  `{ key: "APP.TEXT_UNTRANSLATED", variables: { MESSAGE: <message> } }`
  (`APIError` constructor).
- `statusCode` is only set for `STREAM_ERROR`.

HTTP status codes come from `COMMON/protocol/GuacamoleStatus.java`. `CLIENT_UNAUTHORIZED`
and `CLIENT_FORBIDDEN` both map to `403`, so **clients must branch on `type`, not on the
HTTP status**:

| Situation | Exception (source) | HTTP | `type` |
|---|---|---|---|
| Wrong username/password (when every provider fails without its own error, the generic one has message "Permission Denied.", is untranslated, and expects `username`/`password`: `JAVA/rest/auth/GuacamoleAuthenticationProcessException.java`) | `GuacamoleInvalidCredentialsException` → `GuacamoleCredentialsException` → `GuacamoleUnauthorizedException` (`EXT/net/auth/credentials/`, `COMMON/GuacamoleUnauthorizedException.java`) | 403 | `INVALID_CREDENTIALS` |
| More credentials needed (TOTP, etc.) | `GuacamoleInsufficientCredentialsException` (`EXT/net/auth/credentials/`) | 403 | `INSUFFICIENT_CREDENTIALS`, with `expected` |
| TOTP enrolment needed | same, key `TOTP.INFO_ENROLL_REQUIRED`, field carries key details (`.../auth/totp/user/UserVerificationService.java`) | 403 | `INSUFFICIENT_CREDENTIALS` |
| TOTP code wrong | `TranslatableGuacamoleClientException`, key `TOTP.INFO_VERIFICATION_FAILED` (`UserVerificationService.java`) | 400 | `BAD_REQUEST` |
| Expired or unknown token | `GuacamoleUnauthorizedException("Permission Denied.")` (`AuthenticationService.getGuacamoleSession`) | 403 | `PERMISSION_DENIED` |
| Real permission denial | `GuacamoleSecurityException` | 403 | `PERMISSION_DENIED` |
| Missing object | `GuacamoleResourceNotFoundException` | 404 | `NOT_FOUND` |

**Ambiguity:** an expired token and a real permission denial produce the same body. Our
client treats `PERMISSION_DENIED` on a session-scoped request (`api/session/...`) as
"session expired", because the requests we make (tree, validity, logout) are ones any
logged-in user may make.

The web client's reaction to each type is in `FE/auth/service/authenticationService.js`
(the `catch` in `authenticate`) and `FE/login/directives/login.js` (`guacLoginFailed`):

- `INVALID_CREDENTIALS` shows `LOGIN.ERROR_INVALID_LOGIN`.
- `INSUFFICIENT_CREDENTIALS` renders the `expected` fields and keeps entered values.
- Any other type shows `translatableMessage`.
- Password-like fields are cleared on any failure other than insufficient credentials.

### 1.5 Is this a Guacamole server? (unauthenticated probe)

`GET api/languages` needs no token and returns a JSON object that maps language keys to
display names, for example `{ "en": "English", … }`. Sources:
`JAVA/rest/language/LanguageRESTService.java` (`@Path("/languages")`, `@GET getLanguages`
returns `Map<String, String>`), used by `FE/rest/services/languageService.js`
(`url: 'api/languages'`).

The client uses it to pick the right base URL from the candidates (SPEC SRV-2) without
sending credentials to any URL that has not been confirmed. This choice is ours; the web
client never needs to probe.

### 1.6 Single sign-on detection and return (OpenID, SAML, CAS)

Checked against the 1.6.0 source and, for OpenID, a local 1.6.0 server (official Docker
image, database + OpenID extensions) with Keycloak 26 on 2026-11-20. Details and the
hand-offs: `docs/sso.md`.

- **The REDIRECT field is not always sent.** With the database extension ahead of OpenID
  (the default order there), `POST api/tokens` with no fields answered
  `INVALID_CREDENTIALS` with `expected: [username, password]` only. The web client then
  offers SSO through HTML patches: `GET api/patches` (no token) returns a JSON array of
  HTML strings, and each SSO extension adds
  `<li class="sso-provider sso-provider-openid"><a href="api/ext/openid/login">…`
  (`extensions/guacamole-auth-sso/modules/*/src/main/resources/html/sso-provider-*.html`).
  `GET api/ext/<name>/login` answers `303` to the IdP with a fresh nonce
  (`guacamole-auth-sso-base` `SSOResource`). The app reads both sources
  (`core/sso/sso.ts` `findSsoRedirect`, `ssoProvidersFromPatches`).
- **Return shapes.** OpenID (`response_type=id_token`, implicit flow) came back as
  `<redirect_uri>#session_state=…&iss=…&id_token=…`. The OpenID extension's
  `transformToken.js` rewrites that fragment to `#/?…` before Angular routes, and the
  route's `updateCurrentToken($location.search())` posts every URL parameter to
  `api/tokens` (`FE/index/config/indexRouteConfig.js`; real query parameters are moved
  behind `#/` first by `relocateParameters.js`). SAML returns `?state=…` from
  `api/ext/saml/callback` (`AssertionConsumerServiceResource`), CAS `?ticket=…`.
- **Single use.** Replaying an `id_token` the server's own page had already posted gave
  `403 INVALID_CREDENTIALS` with `expected: [username, password]` (nonce removed by
  `NonceService.isValid`).
- **Timing of the server's page** (desktop Chromium, localhost): page load finished at
  753 ms, and the page's own `POST api/tokens` started at 923 ms. So a web view that closes
  on its "navigation completed" event can beat the page, but only by the margin of the
  plugin's event delivery. This was not measured on a phone.
- **Return address.** The return URL is server configuration (`openid-redirect-uri`, CAS
  `service`, `duo-redirect-uri`), not necessarily the address the app uses. The app accepts
  the base URL and, when the redirect names one, that address (`expectedReturnTargets`).
- **App callback check.** With `redirect_uri=openmobileguac://sso-callback` and an added
  `state`, Keycloak returned `openmobileguac://sso-callback/#state=…&session_state=…&iss=…&id_token=…`,
  and that token was accepted by `POST api/tokens` (the server does not check
  `redirect_uri`).

### 1.7 Duo (guacamole-auth-duo 1.6.0, Duo Universal Prompt)

From the source (`extensions/guacamole-auth-duo/src/main/java/org/apache/guacamole/auth/duo/`);
not run against Duo (no tenant).

1. The user signs in with username and password. After the primary back end accepts them,
   `DuoAuthenticationProvider.getUserContext` calls
   `UserVerificationService.verifyAuthenticatedUser`. Without `duo_code` and `state` in the
   request it stores the credentials under a fresh Duo `state`
   (`DuoAuthenticationSessionManager.defer`, expires after `duo-auth-timeout` minutes,
   default 5) and throws `TranslatableGuacamoleInsufficientCredentialsException`, key
   `LOGIN.INFO_DUO_AUTH_REQUIRED`, with one `RedirectField` `duo_code` whose `redirectUrl`
   is Duo's authorize URL (`?scope=openid&response_type=code&redirect_uri=<raw>&client_id=…&request=<JWT>`,
   duo-universal-sdk 1.3.1 `Client.createAuthUrl`; the JWT carries `redirect_uri`, `state`,
   `duo_uname`). HTTP 403, `type: INSUFFICIENT_CREDENTIALS`.
2. Duo returns the browser to `duo-redirect-uri` (the Guacamole address) with
   `?duo_code=…&state=…`.
3. The next `POST api/tokens` must carry **both** `duo_code` and `state`.
   `DuoAuthenticationProvider.updateCredentials` looks `state` up
   (`AuthenticationSessionManager.resume`, single use) and replaces the request's
   credentials with the deferred ones, so the username and password are not needed again;
   the web client sends only the URL parameters. If `state` is unknown or already used the
   request's own credentials are used unchanged.
4. `verifyAuthenticatedUser` exchanges `duo_code` with Duo
   (`exchangeAuthorizationCodeFor2FAResult`). `allow` → signed in. A denial, a missing
   result or a `DuoException` (stale or reused code) → a new deferral and a new `duo_code`
   REDIRECT field, i.e. step 1 again.

What the app does (`ui/connections/ConnectionsScreen.tsx` `startDuo`, `ui/auth/authFlow.ts`):
the Duo field is shown on the extra step (not as SSO); the in-app browser opens
`redirectUrl` and waits for a page at the return address carrying both values; the app
then posts `username`, `password`, `duo_code` and `state` together. Sending the password
again is harmless when `state` resumes (the deferred credentials replace it) and is what
keeps a stale or already-used `state` from ending in "invalid login": the server then
authenticates the password again and offers a fresh Duo step. A repeated Duo field is
shown as "Duo did not confirm the sign-in". The race with the server's own page (§1.6)
applies to Duo too, since `duo-redirect-uri` is the Guacamole web app.

### 1.8 Forced password change at sign-in (database extension)

Checked against a local 1.6.0 server (PostgreSQL extension, minimum length 10, digit
required, TOTP extension on) on 2026-11-20.

- An account with `expired` set (or past `*-user-password-max-age`) is answered, after a
  correct password, with `INSUFFICIENT_CREDENTIALS`, message "Password has expired", key
  `LOGIN.INFO_PASSWORD_EXPIRED`, and `expected: [username, password, new-password,
  confirm-new-password]` (`guacamole-auth-jdbc-base` `UserService.resetExpiredPassword`,
  called from `JDBCAuthenticationProviderService.getUserContext`).
- The next attempt sends `username`, the **old** `password`, `new-password` and
  `confirm-new-password`. Refusals are `400 BAD_REQUEST` with translatable keys:
  `LOGIN.ERROR_PASSWORD_SAME`, `LOGIN.ERROR_PASSWORD_MISMATCH`, `LOGIN.ERROR_PASSWORD_BLANK`,
  `PASSWORD_POLICY.ERROR_TOO_SHORT` `{ LENGTH: 10 }`, `PASSWORD_POLICY.ERROR_REQUIRES_DIGIT`, …
- **The new password is stored before later steps run.** With TOTP also installed, the
  reset request was answered with the TOTP enrolment step, and from then on the old
  password got `INVALID_CREDENTIALS` while the new one worked. TOTP checks in `decorate`,
  after the database extension's `getUserContext`. So after a reset request that returns a
  different extra step, the app uses `new-password` as the password and saves it if the
  password is remembered (`authFlow.ts`, `AuthService.login`).
- **With Duo as well** (from the source only): Duo verifies in its `getUserContext`, and
  `AuthenticationService.getUserContexts` calls providers in extension order, so Duo may
  run before or after the reset. If a Duo step follows the reset request the app keeps the
  old password and `new-password` (Duo defers that whole request and replays it after the
  check, so the reset then happens). If the database extension ran first, the reset is
  already stored and the replayed old password fails; upstream (web client included) then
  answers "invalid login", and the user must sign in with the new password. Not tested.
- The web client shows the step's `translatableMessage` above the fields and labels them
  `LOGIN.FIELD_HEADER_NEW_PASSWORD` / `…_CONFIRM_NEW_PASSWORD`. The app does the same from
  the server's `translations/<lang>.json` (§8.4), formatting `{VAR}` and
  `{VAR, plural, …}` itself (`ui/auth/serverText.ts`), and falls back to `message`.

### 1.9 Change own password

`PUT api/session/data/{dataSource}/users/{username}/password`, token header, JSON body
`{ "oldPassword": "…", "newPassword": "…" }` (`guacamole/src/main/java/org/apache/guacamole/rest/user/UserResource.java`
`updatePassword`, `APIUserPasswordUpdate`; web client `userService.updateUserPassword`).
`{dataSource}` is the session's `dataSource` (`authenticationService.getDataSource()`).
Results on a 1.6.0 server:

| Case | Answer |
|---|---|
| Success | `204`; the session token stays valid |
| Wrong old password | `403 PERMISSION_DENIED` "Permission denied." (credentials exceptions are turned into `GuacamoleSecurityException`) |
| No `UPDATE` on the own user | the same `403 PERMISSION_DENIED` "Permission denied." |
| Unknown token | `403 PERMISSION_DENIED` "Permission Denied." |
| Password policy | `400 BAD_REQUEST`, e.g. key `PASSWORD_POLICY.ERROR_TOO_SHORT` `{ LENGTH: 10 }` |

The web client offers the form only when `GET …/self/effectivePermissions` grants `UPDATE`
on the own user or system `ADMINISTER` (`guacSettingsPreferences.js` `canUpdateSelf`). A
new database user had only `READ` on itself, so on a default setup the administrator must
grant it. The app checks the same permission first, then tells a wrong old password from
an expired token with `HEAD api/session` (`GuacApi.changePassword`).

## 2. Connection tree

| | |
|---|---|
| Request | `GET api/session/data/{dataSource}/connectionGroups/{groupId}/tree` with the token header |
| Root group id | `ROOT` |
| Optional query | `permission=<ObjectPermission.Type>` (repeatable) to filter. The home screen does not use it. |
| Response | One `ConnectionGroup` object, with nested children |

Sources:

- `FE/rest/services/connectionGroupService.js`, `getConnectionGroupTree`. The URL is
  `'api/session/data/' + encodeURIComponent(dataSource) + '/connectionGroups/' + encodeURIComponent(connectionGroupID) + '/tree'`.
- `FE/rest/types/ConnectionGroup.js` has `ROOT_IDENTIFIER = "ROOT"` and the types
  `ORGANIZATIONAL` and `BALANCING`.
- `JAVA/rest/connectiongroup/ConnectionGroupResource.java`, `@GET @Path("tree")`, takes
  `@QueryParam("permission")`. `JAVA/rest/session/SessionResource.java` mounts
  `data/{dataSource}`.

Across data sources: the home screen calls
`dataSourceService.apply(connectionGroupService.getConnectionGroupTree, authenticationService.getAvailableDataSources(), ConnectionGroup.ROOT_IDENTIFIER)`
(`FE/home/controllers/homeController.js`). `FE/rest/services/dataSourceService.js`
`apply` calls the function once per data source. It treats a `NOT_FOUND` error for one
data source as "no result" and any other error as a failure. We do the same.

### 2.1 JSON shapes

`ConnectionGroup` (`JAVA/rest/connectiongroup/APIConnectionGroup.java`, which has
`@JsonInclude(NON_NULL)`, so absent means null; client mirror
`FE/rest/types/ConnectionGroup.js`):

| Field | Type | Notes |
|---|---|---|
| `identifier` | string | `ROOT` for the root |
| `parentIdentifier` | string | absent on root |
| `name` | string | |
| `type` | `"ORGANIZATIONAL"` \| `"BALANCING"` | |
| `activeConnections` | number | Java `int`, always present |
| `childConnectionGroups` | ConnectionGroup[] | may be absent (null is omitted); treat absent as empty |
| `childConnections` | Connection[] | may be absent (null is omitted); treat absent as empty |
| `attributes` | `{ [name]: string }` | |

`Connection` (`JAVA/rest/connection/APIConnection.java`, `@JsonInclude(NON_NULL)`; client
mirror `FE/rest/types/Connection.js`):

| Field | Type | Notes |
|---|---|---|
| `identifier` | string | |
| `parentIdentifier` | string | |
| `name` | string | |
| `protocol` | string | `rdp`, `vnc`, `ssh`, `telnet`, `kubernetes`, … |
| `activeConnections` | number | Java `int` |
| `attributes` | `{ [name]: string }` | |
| `sharingProfiles` | SharingProfile[] | in trees; fields `identifier`, `name`, `primaryConnectionIdentifier`, `parameters`, `attributes` (`JAVA/rest/sharingprofile/APISharingProfile.java`) |
| `lastActive` | Java `Date` | **Unverified:** the source does not show the Jackson date settings. Jackson's default is epoch milliseconds. The parser accepts a number or an ISO string. |
| `parameters` | map | not filled in tree responses |

## 3. Tunnel

### 3.1 Endpoints

- WebSocket: `websocket-tunnel`, relative to the base URL, so for example
  `wss://guac.example/guacamole/websocket-tunnel`. Subprotocol: `guacamole`.
  - The server registers it in `JAVA/tunnel/websocket/WebSocketTunnelModule.java`:
    `ServerEndpointConfig.Builder.create(RestrictedGuacamoleWebSocketTunnelEndpoint.class, "/websocket-tunnel")`.
  - On the client, `JS/Tunnel.js` `Guacamole.WebSocketTunnel` opens
    `new WebSocket(tunnelURL + "?" + data, "guacamole")`, so the connect parameters are
    the WebSocket query string.
  - A relative `tunnelURL` is resolved against `window.location`, mapping `http:` to
    `ws:` and `https:` to `wss:`. Inside Capacitor that location is the app's own origin,
    so **the app must pass an absolute `ws(s)://` URL**. A URL that already starts with
    `ws:` or `wss:` is used unchanged.
- HTTP: `tunnel`, for example `https://guac.example/guacamole/tunnel`.
  - The server serves it in `JAVA/tunnel/TunnelModule.java`
    (`serve("/tunnel").with(RestrictedGuacamoleHTTPTunnelServlet.class)`).
  - On the client, `JS/Tunnel.js` `Guacamole.HTTPTunnel` posts the connect parameters as
    the body of `POST tunnel?connect` (`application/x-www-form-urlencoded; charset=UTF-8`).
    The response body is the tunnel UUID and the `Guacamole-Tunnel-Token` response header
    carries a session token. It then reads with `GET tunnel?read:<uuid>:<n>` and writes
    with `POST tunnel?write:<uuid>`, both sending the `Guacamole-Tunnel-Token` header.
  - The HTTP tunnel needs CORS from a WebView origin, and the server sends no CORS
    headers, so it is only a fallback behind a proxy or native bridge.
- `FE/client/services/guacClientManager.js` only caches `ManagedClient` instances and
  disconnects them. It adds nothing to the tunnel URL or the connect parameters.
- The web client tries WebSocket first and falls back to HTTP:
  `new Guacamole.ChainedTunnel(new Guacamole.WebSocketTunnel('websocket-tunnel'), new Guacamole.HTTPTunnel('tunnel'))`
  (`FE/client/types/ManagedClient.js`, `ManagedClient.getInstance`).

### 3.2 Connect parameters

`FE/client/types/ManagedClient.js`, `getConnectString`, builds the string in this exact
order:

```
token=<encodeURIComponent(authToken)>
&GUAC_DATA_SOURCE=<encodeURIComponent(dataSource)>
&GUAC_ID=<encodeURIComponent(identifier)>
&GUAC_TYPE=<encodeURIComponent(type)>
&GUAC_WIDTH=<floor(cssWidth * devicePixelRatio)>
&GUAC_HEIGHT=<floor(cssHeight * devicePixelRatio)>
&GUAC_DPI=<floor(devicePixelRatio * 96)>
&GUAC_TIMEZONE=<encodeURIComponent(IANA zone)>
&GUAC_AUDIO=<mimetype>   (repeated, one per supported audio type)
&GUAC_VIDEO=<mimetype>   (repeated)
&GUAC_IMAGE=<mimetype>   (repeated)
```

The `Client.connect(connectString)` call passes this string to `tunnel.connect(data)`
(`JS/Client.js`, `this.connect`).

- Server-side parameter names: `JAVA/tunnel/TunnelRequest.java` has the constants
  `token`, `GUAC_DATA_SOURCE`, `GUAC_TYPE`, `GUAC_ID`, `GUAC_WIDTH`, `GUAC_HEIGHT`,
  `GUAC_DPI`, `GUAC_AUDIO`, `GUAC_VIDEO`, `GUAC_IMAGE` and `GUAC_TIMEZONE`.
  - Required: `GUAC_DATA_SOURCE`, `GUAC_TYPE` and `GUAC_ID` (`getRequiredParameter`).
  - `token` is read with `getParameter` and then used to look up the session
    (`JAVA/tunnel/TunnelRequestService.java`). Without a valid token the tunnel fails.
  - Width, height and DPI are optional integers. The media types are multi-valued. The
    timezone is optional.
- `GUAC_TYPE` values come from `JAVA/tunnel/TunnelRequestType.java`: `c` for a connection,
  `g` for a connection group (balancing) and `a` for an active connection (joining or
  sharing). The client mirror is `FE/navigation/types/ClientIdentifier.js` (`Types`).
- The supported media types come from the library:
  - Audio is `Guacamole.AudioPlayer.getSupportedTypes()`
    (`FE/client/services/guacAudio.js`).
  - Video is `Guacamole.VideoPlayer.getSupportedTypes()`
    (`FE/client/services/guacVideo.js`).
  - Images are `image/jpeg`, `image/png` and `image/webp`, each kept only if the browser
    decodes a test image (`FE/client/services/guacImage.js`).
- The default timezone is `jstz.determine().name()`
  (`FE/settings/services/preferenceService.js`). We use
  `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- The web client's URL id for a connection is
  `base64url(id + "\0" + type + "\0" + dataSource)` (`ClientIdentifier.toString`). The
  tunnel does not use it.

### 3.3 Tunnel object shape (`JS/Tunnel.js`, `Guacamole.Tunnel`)

- Methods: `connect(data)`, `disconnect()`, `sendMessage(...elements)` (variadic),
  `setState(state)`, `setUUID(uuid)` and `isConnected()`. `isConnected()` is true when the
  state is `OPEN` or `UNSTABLE`.
- Properties: `state`, which starts as `CLOSED`; `uuid`, which starts as `null`;
  `receiveTimeout`, default `15000`; and `unstableThreshold`, default `1500`.
- Events: `onuuid(uuid)`, `onerror(status)` (a `Guacamole.Status`), `onstatechange(state)`
  and `oninstruction(opcode, args)`.
- `Guacamole.Tunnel.State` values: `CONNECTING: 0`, `OPEN: 1`, `CLOSED: 2`, `UNSTABLE: 3`.
- `Guacamole.Tunnel.INTERNAL_DATA_OPCODE = ''`.
  - The WebSocket tunnel takes the first instruction (`""` with one argument) as the UUID,
    then moves to `OPEN`.
  - `oninstruction` is not called for internal-opcode instructions.
  - `sendMessage` drops messages while not connected.
- `Guacamole.Client` itself only uses `tunnel.connect`, `tunnel.disconnect`,
  `tunnel.sendMessage` and `tunnel.oninstruction` (`JS/Client.js`). `ManagedClient` also
  uses `onerror`, `onstatechange` and `onuuid`.

### 3.4 Remote size, DPI and quality

Sources: guacamole-server 1.6.0 `src/libguac/user-handlers.c` 632-655 (handshake `size`),
`src/protocols/rdp/resolution.c` 25-56 (`guac_rdp_suggest_resolution`),
`src/protocols/rdp/settings.c` 850-889, `src/protocols/rdp/input.c` 102-114 and
`src/protocols/rdp/channels/disp.c` 163-235; guacamole-client `ManagedClient.js` 281-300.
Implemented in `app/src/session/viewport/remoteSize.ts` (tests in `remoteSize.test.ts`).

**The rule guacd applies to RDP** when the administrator has not set `width`, `height` or
`dpi`:

- The handshake `size` gives the client's optimal width W, height H and DPI D (D defaults
  to 96 when absent). The tunnel fills it from `GUAC_WIDTH`, `GUAC_HEIGHT` and `GUAC_DPI`.
- `reasonable(r)` is true when `D == r` or `(W·r/D) · (H·r/D) ≥ 800·600`, with C integer
  division.
- The resolution is 96 if `reasonable(96)`, else 120 if `reasonable(120)`, else D.
- Desktop width = `(W·res/D) & ~3` (rounded down to a multiple of 4); height = `H·res/D`
  (not rounded). Zero or negative falls back to 1024 × 768.
- **The DPI is never sent to the RDP server.** It only converts pixels (`input.c`); no
  DesktopScaleFactor is set at connect, and display-update sends 0. Windows therefore uses
  its own scaling (normally 100 %) whatever DPI the client asks for. (AUDIT §4.3 said
  "Windows 200 %"; that was wrong.)
- A later `size` (resize) carries width and height only. guacd converts it with the DPI
  chosen at connect, limits it to 8192, clamps it to at least 200, makes the width even,
  sends at most one request per 500 ms and skips unchanged sizes.

**VNC** sends SetDesktopSize with W × H only (if libvncclient supports it, the user is the
owner and `disable-display-resize` is off); many servers ignore it. **SSH, telnet and
Kubernetes** size the terminal from W × H and draw the font at `font-size · D / 96` pixels.

**What each Quality level sends** on an iPhone-class phone (390 × 844 CSS px, DPR 3) and on
a DPR-2 phone (375 × 812 CSS px), and what guacd then gives an RDP server:

| Quality | Sent at DPR 3            | RDP desktop at DPR 3 | Sent at DPR 2            | RDP desktop at DPR 2 |
| ------- | ------------------------ | -------------------- | ------------------------ | -------------------- |
| Auto    | 1170 × 2532 @ 288        | 484 × 1055 @ 120     | 750 × 1624 @ 192         | 748 × 1624 @ 192     |
| Best    | 1170 × 2532 @ 298        | 1168 × 2532 @ 298    | 750 × 1624 @ 192         | 748 × 1624 @ 192     |
| Low     | 390 × 844 @ 96, no audio | 388 × 844 @ 96       | 375 × 812 @ 96, no audio | 372 × 812 @ 96       |

(The sizes are the whole screen; the app sends the area left after docked toolbars.)

- **Auto** is the upstream web client: device pixels at `96·dpr`.
- **Best** sends device pixels at the lowest DPI that guacd keeps (`nativeDpi`). For
  1170 × 2532 every DPI from 97 to 297 is reduced to 96 or 120; 298 and above keep it. For
  terminal protocols Best keeps the Auto DPI, since guacd scales the font by DPI.
- **Low** sends CSS pixels at 96 DPI (guacd keeps it because the DPI equals its own), and
  advertises no `GUAC_AUDIO` types, so guacd encodes and sends no audio
  (`libguac/audio.c` 75-107, 206-212). It keeps `image/webp` and waits 1.5 s instead of
  0.4 s before a mid-session resize.
- **Remote resolution** other than Auto (Match device, 1280 × 720 to 2560 × 1440, Custom) is
  sent at 96 DPI, which guacd always keeps. A fixed size never follows device rotation.
- **Scale** above 100 % divides the requested size (200 % → 585 × 1266 at DPR 3), so the
  desktop is drawn larger. It is the only client-side way to get larger text, since no
  DPI reaches Windows.
- **Audio off** (separate from a local mute) advertises no audio types. A local mute still
  receives the stream (about 1.4 Mbit/s for 44.1 kHz stereo PCM).
- Only `GUAC_*` values reach guacd (`TunnelRequest.java`). JPEG/WebP quality, frame rate,
  colour depth, `force-lossless`, wallpaper and VNC encodings are connection parameters
  that only an administrator can change (connection editor › Performance presets, §8.6).
- Session info shows "Asked for" (the request) next to "Remote resolution" (what the
  server gave), the bytes received, and a kbit/s estimate from tunnel traffic over the last
  5 s. Changing Quality, size, Scale or Audio off mid-session offers "Reconnect to apply".

### 3.5 No HTTP tunnel fallback

The web client uses `ChainedTunnel(WebSocketTunnel, HTTPTunnel)`. The app does not, because
the HTTP tunnel cannot work reliably from the app's WebView:

- The app's origin is `capacitor://localhost` (iOS) or `https://localhost` (Android). The
  HTTP tunnel's `read` and `write` requests carry the `Guacamole-Tunnel-Token` header, which
  forces a CORS preflight that Guacamole does not answer. Reading the tunnel token and
  `Guacamole-Status-Code` response headers would also need `Access-Control-Expose-Headers`
  (`Tunnel.js` 466, 497-499, 663, 697-703). The `?connect` POST may still reach the server
  as a simple request and open a connection whose answer cannot be read.
- Capacitor's native HTTP patch (`plugins.CapacitorHttp.enabled`, off in this app) avoids
  CORS but buffers the whole response: the patched XMLHttpRequest goes from readyState 2
  straight to 4 (`native-bridge.js` on both platforms). The tunnel servlet ends a read
  response only when the next read arrives (`GuacamoleHTTPTunnelServlet.java` 422-447), so
  the progressive readyState-3 reads that `HTTPTunnel` relies on never happen.
- `ChainedTunnel` would also replace the app's `sendMessage` wrapper (traffic counter) on
  `attach`, and it never falls back on `UPSTREAM_TIMEOUT`.

Instead, a WebSocket that closes before the tunnel ever opened (close 1006, reported as
0x0207 `UPSTREAM_NOT_FOUND`) shows "The WebSocket connection to the server failed … a proxy
or firewall that blocks WebSockets also causes this. The app cannot fall back to the HTTP
tunnel." (`status.ts`, test in `status.test.ts`). A real fallback needs a native transport
(`core/transport/SessionTransport.ts`, `native-bridge`).

### 3.6 Close codes and reconnect

- `WebSocketTunnel` (vendored 1.6.0, `Tunnel.js` 926-1011): a close with a numeric reason
  uses that Guacamole status; otherwise 1000 → SUCCESS, 1006/1015 → UPSTREAM_NOT_FOUND and
  1001/1012-1014 → UPSTREAM_UNAVAILABLE. `onerror` fires only for a non-success status, and
  before `CLOSED`.
- An administrator's **Kill** (`ActiveConnectionService.deleteObject` → `tunnel.close()`)
  closes the WebSocket with code 1000 and reason `"0"` (SUCCESS). guacd sends nothing, so
  the client sees no `error`, no `disconnect` and no `onerror`, only `CLOSED`.
- A clean RDP log-off (ERRINFO 0xB/0xC) ends with SUCCESS and a `disconnect` instruction.
  "Forcibly disconnected." and "Logged off." send `error` 0x020B; idle sends 0x020A;
  another user sends 0x0209 (`rdp/error.c` 200-340).
- The upstream web client never retries a clean close (it shows "Disconnected" with a
  Reconnect button). It auto-retries only 0x0200, 0x0202, 0x0203, 0x0207, 0x0208, 0x0301
  and 0x0308 (`guacClientNotification.js` 73-94, 147-151, 217-283).
- The app now does the same for clean closes: **a close with no error is "ended by the
  server" and is never auto-reconnected.** A network drop always reports an error first
  (1006 → 0x0207, receive timeout → 0x0202) and is retried. While hidden, and within 10 s
  of returning to the app, the first retry is immediate and the overlay is replaced by a
  small "Reconnecting…" pill. 2 s after a return, a session whose tunnel is closed or
  unstable is reconnected at once (`backgroundPolicy.ts` `resumeNeedsReconnect`).
- Keep-alives: `Client.js` sends a `nop` 5 s after the last received instruction, and
  `WebSocketTunnel` pings every 500 ms (the web application echoes it). Nothing in the app
  suppresses either while a session is hidden: `setActive(false)` only stops input, loops
  and audio. They stop only when the OS pauses the WebView; guacd then drops the user after
  `GUACD_TIMEOUT` (15 s, `src/guacd/proc.h`) with 0x0308.

## 4. Clipboard

- **Remote to local:** `client.onclipboard = function (stream, mimetype)`
  (`FE/client/types/ManagedClient.js`, `getInstance`).
  - For `text/*` the web client reads with `new Guacamole.StringReader(stream)`, joins the
    `ontext` chunks, and on `onend` stores
    `new ClipboardData({ source, type: mimetype, data })`.
  - Other types use `Guacamole.BlobReader(stream, mimetype)` and `getBlob()` on end.
  - On the wire this is the server's `clipboard` instruction (`stream index`, `mimetype`)
    followed by `blob` and `end` (`JS/Client.js` instruction handlers `"clipboard"` and
    `"blob"`).
- **Local to remote:** `ManagedClient.setClipboard(managedClient, data)`.
  - It ignores data whose `source` is this client, which prevents echo loops.
  - It then calls `client.createClipboardStream(data.type)`, which sends
    `clipboard,<index>,<mimetype>` (`JS/Client.js`, `createClipboardStream`).
  - For strings it writes `new Guacamole.StringWriter(stream)`, then `sendText(data)`,
    then `sendEnd()`. For blobs it uses `Guacamole.BlobWriter` and `sendBlob`, then
    `sendEnd` on `oncomplete`.
  - `StringWriter` UTF-8-encodes text into a growing buffer (initially 8192 bytes) and hands
    it to an internal `ArrayBufferWriter` (`JS/StringWriter.js`). That writer splits data into
    `blob` instructions of at most `DEFAULT_BLOB_LENGTH = 6048` bytes, sent base64-encoded
    (`JS/ArrayBufferWriter.js`). `sendEnd` sends `end,<index>` (`JS/OutputStream.js`,
    `JS/Client.js`).
- **Astral characters (1.6.0 bug, worked around here).** `StringWriter` encodes each UTF-16
  code unit separately (`charCodeAt`), so an emoji becomes two 3-byte surrogate encodings
  (CESU-8, invalid UTF-8). `StringReader`'s `UTF8Parser` decodes 4-byte sequences but emits
  them with `String.fromCharCode`, which truncates code points above U+FFFF. OpenMobileGuac
  therefore moves clipboard text as raw bytes: `ArrayBufferReader` chunks joined and decoded
  once at `end` with `TextDecoder`, and `TextEncoder` bytes sent with `ArrayBufferWriter`
  (`app/src/ui/session/clipboardText.ts`). The wire format is unchanged.
- `ClipboardData` is `{ source, type (default 'text/plain'), data (default '') }`
  (`FE/clipboard/types/ClipboardData.js`).
- `FE/clipboard/services/clipboardService.js` bridges to the local clipboard with
  `navigator.clipboard.readText` and `writeText` for `text/plain`. `setClipboard`
  broadcasts `guacClipboard`, which the client directive forwards to
  `ManagedClient.setClipboard` (`FE/client/directives/guacClient.js`).

## 5. Display size, mouse and keyboard

- **Resize:** `client.sendSize(width, height)` sends `size,<width>,<height>`
  (`JS/Client.js`, `sendSize`; it does nothing unless connected).
  - The web client sends device pixels: `main.offsetWidth * devicePixelRatio` and
    `main.offsetHeight * devicePixelRatio`. It only does so when they differ from
    `display.getWidth()` and `display.getHeight()`
    (`FE/client/directives/guacClient.js`, `mainElementResized`).
  - The initial size goes in the connect string (§3.2) instead.
- **Mouse:** `client.sendMouseState(mouseState, applyDisplayScale)` (`JS/Client.js`).
  - When `applyDisplayScale` is true, x and y are divided by `display.getScale()`.
  - It then sends `mouse,<floor(x)>,<floor(y)>,<buttonMask>`, where the mask is
    left `1` | middle `2` | right `4` | wheel up `8` | wheel down `16`.
  - The web client forwards `Guacamole.Mouse` and the touch emulations
    (`Mouse.Touchscreen`, `Mouse.Touchpad`) with `client.sendMouseState(event.state, true)`
    (`guacClient.js`, `handleMouseEvent` and `handleEmulatedMouseEvent`).
- **Keyboard:** `client.sendKeyEvent(pressed, keysym)` sends `key,<keysym>,<pressed>`,
  where `pressed` is `1` or `0` (`JS/Client.js`).
  - The web client calls `client.sendKeyEvent(1, keysym)` and `(0, keysym)` from the
    `guacKeydown`/`guacKeyup` and `guacSyntheticKeydown`/`guacSyntheticKeyup` events, and
    only while the client is focused (`guacClient.js`).

### 5.1 Keys, Shift and guacd

Sources: guacamole-server 1.6.0 `src/protocols/rdp/keyboard.c` 263-352, 476-497, 530-538,
560-588, 607-625 and 692-718; `src/protocols/rdp/keymaps/en_us_qwerty.keymap` 24-42 and
`base.keymap` 23-91; `src/protocols/vnc/input.c` 50-65; `src/terminal/terminal.c`
1417-1530; and the vendored `Keyboard.js`. Implemented in `app/src/session/keys/KeyModel.ts`
(`chordCharKeysym`, `comboEvents`), with table-driven tests in `KeyModel.test.ts`.

- The RDP keymap gives every printable keysym a required Shift state: `t` is `-shift`, `T`
  is `+shift`, `1` is `-shift` and `!` is `+shift`. Before sending the scancode, guacd
  presses or releases Shift to match. Only Shift and AltGr are tracked (Ctrl, Alt and Win
  are left alone), and Shift is not restored afterwards. Tab, Esc, Enter, arrows and F-keys
  have no Shift constraint. A keysym with no keymap entry becomes an RDP Unicode event (no
  press or release, so no shortcut); ISO_Left_Tab (0xFE20) is dropped.
- So Shift held + `t` reaches Windows as a plain `t` (Ctrl+Shift+`t` → Ctrl+T), and `T`
  without Shift gets a synthetic Shift (Ctrl+`T` → Ctrl+Shift+T).
- VNC passes the keysym through unchanged. The SSH terminal ignores Shift for printable
  keys and maps Ctrl+`T` and Ctrl+`t` both to 0x14.
- **Rule:** send what a US keyboard types with the Shift state actually sent, as
  `Guacamole.Keyboard` does for a physical keyboard (browser `key` "T" with Shift → 0x54):
  - with Shift: uppercase letters and shifted symbols (`T`, `!`);
  - without Shift: lowercase letters and unshifted symbols (`t`, `1`);
  - a shifted symbol written without Shift (`Ctrl+!`) gets Shift added, as on a keyboard;
  - named keys are always their base keysym; modifiers are pressed first and the key last,
    and releases come in reverse.

| Chord                           | Events                              |
| ------------------------------- | ----------------------------------- |
| Ctrl+Shift+T                    | FFE3↓ FFE1↓ 54↓ 54↑ FFE1↑ FFE3↑     |
| Ctrl+T                          | FFE3↓ 74↓ 74↑ FFE3↑                 |
| Key bar: sticky Shift, then "1" | FFE1↓ 21↓ 21↑ FFE1↑                 |
| Ctrl+Shift+1 (or Ctrl+!)        | FFE3↓ FFE1↓ 21↓ 21↑ FFE1↑ FFE3↑     |
| Alt+Shift+Tab                   | FFE9↓ FFE1↓ FF09↓ FF09↑ FFE1↑ FFE9↑ |
| Ctrl+Shift+Esc                  | FFE3↓ FFE1↓ FF1B↓ FF1B↑ FFE1↑ FFE3↑ |
| Super+Shift+S                   | FFEB↓ FFE1↓ 53↓ 53↑ FFE1↑ FFEB↑     |
| Shift+A                         | FFE1↓ 41↓ 41↑ FFE1↑                 |

Known edge case: with Caps Lock on at the remote, guacd's cheapest keymap match for Shift +
`T` is `+caps -shift`, which drops the Shift. Keep the remote Caps Lock off for Shift
chords.

The setting "Command key (⌘) on a hardware keyboard" can send Control instead of Super for
⌘ on iPad and Mac keyboards (`mapCommandKey`), so ⌘C and ⌘V copy and paste on Windows.

## 6. Session streams: required/argv, files, audio, statistics

Implemented in `app/src/ui/session/` (`SessionController.ts`, `argv.ts`, `transfers.ts`,
`audio.ts`, `fileSave.ts`) with the pure parts in `app/src/session/` (`credentials/`,
`transfer/`, `clipboard/`). Server-side facts cite guacamole-server at tag `1.6.0`
(abbreviated `SRV/` = `src/`); nothing below has been checked against a running guacd yet.

### 6.1 Credential prompt (`required`) and argument values (`argv`)

- guacd asks for missing connection parameters with `required,<name>,...`. The library
  calls `client.onrequired(names)` (`JS/Client.js`, handler `"required"`). It arrives while
  the client is still `WAITING` (before the first `sync`), so the prompt must work before
  the session counts as connected; the library accepts streams in `WAITING`
  (`isConnected()` is `CONNECTED || WAITING`).
- RDP asks for `username` and `password` when they are unset, and `domain` only when both
  username and domain are unset (`SRV/protocols/rdp/rdp.c`, the FreeRDP authenticate
  callback: `guac_argv_register`, `guac_client_owner_send_required`, `guac_argv_await`).
  VNC asks for `password`, and `username` where the server's auth type needs one
  (`SRV/protocols/vnc/auth.c`). SSH does not use `required` in 1.6.0: it prompts inside the
  terminal (`SRV/protocols/ssh/ssh.c`, `guac_terminal_prompt`). guacd sends `required` only
  if the connection owner supports it (`guac_client_owner_supports_required`).
- The web client keeps an empty string per requested name and answers each with
  `client.createArgumentValueStream('text/plain', name)` (sends `argv,<stream>,text/plain,<name>`),
  a `StringWriter` with the value, then `sendEnd` (`FE/client/types/ManagedClient.js`,
  `sendArguments`; prompt and Cancel in `FE/client/directives/guacClientNotification.js`:
  Cancel calls `client.disconnect()`). We write the value as `TextEncoder` UTF-8 bytes with
  `ArrayBufferWriter` (same wire format; §4 explains the StringWriter bug).
- guacd acks each `argv` stream with "Ready for updated parameter." / SUCCESS, or "Not
  allowed." / CLIENT_FORBIDDEN (`SRV/libguac/argv.c`, `guac_argv_handler`).
- `client.onargv(stream, mimetype, name)` carries current parameter values the server
  sends, e.g. SSH's `color-scheme`, `font-name` and `font-size`
  (`SRV/protocols/ssh/argv.c`, `guac_ssh_send_current_argv`), and values echoed after a
  change for parameters registered with `GUAC_ARGV_OPTION_ECHO` (`SRV/libguac/argv.c`). The web client reads only `text/plain`, then opens an argument stream for that
  name at once and treats the parameter as changeable only if that stream is acked with
  success; a later change writes the new value to that stream and ends it
  (`FE/client/types/ManagedArgument.js`). Without an `onargv` handler the library refuses
  the stream with "Receiving argument values unsupported" / UNSUPPORTED.

### 6.2 File transfer

- Server-pushed files: `file,<stream>,<mimetype>,<filename>` → `client.onfile(stream,
  mimetype, filename)`; without a handler the library acks "File transfer unsupported" /
  UNSUPPORTED (`JS/Client.js`).
- Filesystems: `filesystem,<object>,<name>` → `client.onfilesystem(object, name)` with a
  `Guacamole.Object` (`JS/Object.js`); `undefine,<object>` → `object.onundefine`. The root
  stream is `/` (`Guacamole.Object.ROOT_STREAM`); folder streams have the mimetype
  `application/vnd.glyptodon.guacamole.stream-index+json`
  (`Guacamole.Object.STREAM_INDEX_MIMETYPE`).
- Listing a folder: `object.requestInputStream(name, cb)` sends `get,<object>,<name>`; the
  server answers `body,<object>,<stream>,<mimetype>,<name>`. The web client refuses a wrong
  mimetype with `ack "Unexpected mimetype" UNSUPPORTED`, else sends `ack "Ready" SUCCESS`,
  reads the JSON and acks every blob with `"Received" SUCCESS`
  (`FE/client/types/ManagedFilesystem.js`, `refresh`). The JSON maps each child's full
  stream name to its mimetype; only names under `<folder>/` are used. guacd writes the next
  part of the JSON on each ack (`SRV/protocols/rdp/ls.c`).
- Downloads are ack-driven: guacd sends each blob (up to 4 KB for RDP) only after a SUCCESS
  ack, and a non-success ack ends the stream (`SRV/protocols/rdp/download.c`,
  `guac_rdp_download_ack_handler`). The web client does not read file data in band: it
  fetches it over REST, `api/session/tunnels/<uuid>/streams/<index>/<filename>`
  (`FE/rest/services/tunnelService.js`, `downloadStream`), and the web application then
  intercepts the stream and sends the first ack itself (`JAVA/tunnel/OutputStreamInterceptingFilter.java`,
  `handleInterceptedStream`). In band, the client must send that first `ack OK SUCCESS`;
  `Guacamole.BlobReader` then acks every blob with "OK" / SUCCESS (`JS/BlobReader.js`).
  In band costs one round trip per 4 KB blob.
- **What the app does (2026-11).** On native, received files use the same stream endpoint,
  requested through native HTTP (`@capacitor/filesystem` `downloadFile`: no CORS, body
  written straight to disk) with the token in the `Guacamole-Token` header (§1.2), not in
  the URL. Facts that shape it (guacamole-client 1.6.0):
  - `OutputStreamInterceptingFilter.handleBlob` acks guacd itself, except for the first blob
    after each `sync`, which it forwards to the client with empty data and leaves the ack to
    the client (so the display keeps up); `end` is passed through.
  - `StreamInterceptingFilter.interceptStream` returns at once (an empty 200) when the tunnel
    is not open, and every intercepted stream is closed normally when the tunnel closes
    (`StreamInterceptingTunnel.close`). So a 200 does not mean complete: the app counts a
    file as complete only when the in-band `end` arrived too, else it deletes it.
  - An error ack from the client makes guacd free the stream without `end`
    (`rdp/download.c`), while the server keeps the intercepted stream (and its blocked
    request) under an index guacd may reuse. Cancel therefore stops acking the forced
    blobs: guacd stalls at the next `sync` (with a still remote screen that may not come, and
    the file may finish first); the native request ends after 60 s without data, the part
    file is deleted either way, and acks then resume so the server's next write fails and it
    closes the stream itself. Unverified against a real server.
  - `Filesystem.downloadFile` uses the platform HTTP stack (Android: the bridge's SSL socket
    factory; iOS: `URLSession`), not the pinned-TLS plugin (`docs/tls.md`), so a server
    trusted by fingerprint gets the in-band fallback.
  - The native plugin cannot abort a request; Android counts progress in a 32-bit `Int`
    (wraps past 2 GiB; the app unwraps it).
  The in-band path remains for the web build, the Demo and a request that fails before any
  data (the stream was then never intercepted).
- A file under a filesystem is downloaded by requesting its stream name
  (`ManagedFilesystem.downloadFile`); a disabled download sends no `body` at all
  (`SRV/protocols/rdp/download.c` only logs), so the client needs a timeout.
- Uploads: with a filesystem, `object.createOutputStream(mimetype, <folder> + '/' + <name>)`
  (sends `put,<object>,<stream>,<mimetype>,<name>`); without one,
  `client.createFileStream(mimetype, name)` (sends `file,...`) (`ManagedClient.uploadFile`,
  `FE/client/types/ManagedFileUpload.js`). The web client waits for the first ack before
  sending data. guacd acks the stream with "OK (STREAM BEGIN)", each blob with
  "OK (DATA RECEIVED)" and the end with "OK (STREAM END)"; refusals are CLIENT_FORBIDDEN
  "FAIL (UPLOAD DISABLED)" or "FAIL (CANNOT OPEN)", or SERVER_ERROR "FAIL (NO FS)"
  (`SRV/protocols/rdp/upload.c`); SFTP uses "SFTP: Upload disabled" / CLIENT_FORBIDDEN
  (`SRV/common-ssh/sftp.c`). In band, `Guacamole.BlobWriter` sends 6048-byte blobs, one per
  ack (`JS/BlobWriter.js`, `JS/ArrayBufferWriter.js`); it has no abort, so Cancel detaches
  it from the stream's acks and ends the stream (the remote keeps the partial file).
- Error texts for upload status codes follow upstream `translations/en.json`
  (`CLIENT.ERROR_UPLOAD_*`).
- RDP printing arrives as an ordinary `file` stream with mimetype `application/pdf` and a
  name from the document title plus `.pdf` (default `guacamole-print.pdf`,
  `SRV/protocols/rdp/print-job.h`); it also waits for acks, and any non-success ack aborts
  the job (`SRV/protocols/rdp/print-job.c`).
- Terminal paste: guacd's terminal pastes its own clipboard buffer on Ctrl+Shift+V (keysym
  `V` with Ctrl held) or a right/middle click (`SRV/terminal/terminal.c`). With
  `disable-paste` the SSH clipboard handler is not installed (`SRV/protocols/ssh/user.c`),
  so the buffer keeps the last terminal selection. The app therefore does not press
  Ctrl+Shift+V automatically after sending the clipboard.

### 6.3 Audio

- `audio,<stream>,<mimetype>` → `client.onaudio(stream, mimetype)`; a falsy return falls back
  to `Guacamole.AudioPlayer.getInstance`; a player gets `ack OK SUCCESS`, none
  `ack "BAD TYPE" CLIENT_BAD_TYPE` (`JS/Client.js`). The web client does not set `onaudio`;
  it only advertises `AudioPlayer.getSupportedTypes()` (`FE/client/services/guacAudio.js`).
- `RawAudioPlayer` handles `audio/L8` and `audio/L16` with `rate` and `channels` parameters,
  connects every buffer straight to the destination of one shared AudioContext
  (`JS/AudioPlayer.js`, `JS/RawAudioFormat.js`, `JS/AudioContextFactory.js` singleton).
  Mobile browsers create that context suspended until a user gesture. A per-session mute
  therefore drops that session's audio blobs instead of suspending the shared context.

### 6.4 Display statistics

- `Guacamole.Display` computes frame statistics from `sync` timing when `statisticWindow`
  is set: `processingLag`, `desktopFps`, `serverFps`, `clientFps`, `dropRate`
  (`JS/Display.js`, `notifyFlushed`, `Guacamole.Display.Statistics`). Server `sync`
  timestamps are in the server's clock, so they give no network latency. The WebSocket
  tunnel's internal ping (`""`, `ping`, timestamp, echoed by the server) is handled inside
  `JS/Tunnel.js` and not exposed, so round-trip time is not available to the app.

### 6.5 Why a session ended

RDP maps the remote disconnect reason to a status (`SRV/protocols/rdp/error.c`,
`guac_rdp_client_abort`): forced disconnect / logged off / active-time limit →
SESSION_CLOSED ("Forcibly disconnected.", "Logged off.", "Active session time limit
exceeded."); idle limit → SESSION_TIMEOUT; another connection → SESSION_CONFLICT; a log off
or disconnect by the remote user sends no error (the session just ends). Upstream's
notification dialog auto-reconnects only for 0x0200, 0x0202, 0x0203, 0x0207, 0x0208, 0x0301
(client) and 0x0308 (`guacClientNotification.js`, `CLIENT_AUTO_RECONNECT` /
`TUNNEL_AUTO_RECONNECT`); the app is stricter for 0x0301 (a rejected sign-in would fail
again).

### 6.6 Terminal parameters (font size, colour scheme)

SSH, telnet and Kubernetes register `color-scheme`, `font-name` and `font-size` as argv
parameters with `GUAC_ARGV_OPTION_ECHO` and without ONCE (`ssh/client.c` 82-84,
`telnet/client.c` 87-89, `kubernetes/client.c` 134-136), for users who are not read-only.

- The client opens `argv,<stream>,text/plain,<name>`, waits for the ack ("Ready for updated
  parameter."), then sends the value as `blob`s and `end` (`libguac/argv.c` 221-347).
- `font-size` is an integer in points (≤ 0 is ignored).
- `color-scheme` is a preset (`gray-black`, `black-white`, `green-black`, `white-black`) or a
  custom list `foreground: …; background: …; colorN: …`.
- The More sheet's Terminal group offers − / + (one point per step, 6 to 48) and a cycle
  through the colour presets. The option "Pinch to change the terminal font size" turns a
  pinch into a `font-size` change (`app/src/session/terminalFont.ts`).

### 6.7 Session sharing

Verified in guacamole-client 1.6.0:

- Profiles: `GET api/session/tunnels/{tunnelUUID}/activeConnection/connection/sharingProfiles`
  (`TunnelResource` 111, `ActiveConnectionResource`, `tunnelService.js` 126-127) returns a
  map of identifier → sharing profile.
- Key: `GET api/session/tunnels/{tunnelUUID}/activeConnection/sharingCredentials/{profileId}`
  (`ActiveConnectionResource.java` 128-136, `tunnelService.js` 151-158) returns
  `{"expected":[{"name":"key","type":"QUERY_PARAMETER"}],"values":{"key":"…"}}`. The user
  needs READ on that profile, which must belong to the connection.
- Link: `<origin><path>#/?key=<urlencoded key>` (`UserCredentials.getLink`,
  `ManagedShareLink.js` 92-99). The tunnel UUID is the first internal instruction
  (`Tunnel.uuid`).
- The app's "Share this session" (More sheet) lists the profiles, creates the link and hands
  it to the share sheet or the clipboard (`GuacApi.getTunnelSharingProfiles`,
  `GuacApi.createShareLink`, `ui/session/ShareSheet.tsx`). It is not offered in the Demo or
  in a session opened from a share link. Not yet tried against a real server.

### 6.8 TOTP enrolment field

`AuthenticationCodeField` (`extensions/guacamole-auth-totp`, name `guac-totp`, type
`GUAC_TOTP_CODE`) exposes, during enrolment only: `secret` (Base32), `digits` (number),
`period` (number), `mode` (`"SHA1"`, `"SHA256"` or `"SHA512"`: the `TOTPGenerator.Mode` enum
name, upper case), `issuer`, `username`, `keyUri`
(`otpauth://totp/{issuer}:{user}?secret=&issuer=&algorithm=&digits=&period=`) and `qrCode`
(a PNG data URL). The app stores the key from `keyUri` when it parses, else from `secret`
with `digits`, `period` and `mode` (`core/totp/totp.ts` `totpFromEnrolmentField`).

## 7. Not verified

These need checking against a live 1.6.0 server (PLAN T0.4):

- The exact JSON serialisation of `null` fields in `APIError` and of `Date` (`lastActive`).
- Whether reverse proxies in front of the owner's server reject the WebSocket `Origin`
  of the app.
- How Capacitor's native HTTP surfaces TLS failures. On iOS it has not been checked at
  all. On Android the message text is matched heuristically (see
  `app/src/core/http/NativeHttpClient.ts`).
- Browser `fetch` cannot tell a TLS failure from an unreachable host.
- Everything in §6 on a real guacd: the `required` prompt, in-band file transfer and its
  speed, print jobs, audio, and the end-reason mapping.
- Everything in §8 (connection management): no request in §8 has been sent to a real
  server. The dev harness's fake server encodes this document's reading of the source, so it
  checks the app's wiring, not protocol correctness. Also unverified: the identifier in the
  create response (§8.1) and the permission sets of read-only extensions (§8.3). In particular the exact JSON for `null` attribute values, `Date` fields in history
  and active connections, and the error bodies of a failed `PATCH`.

## 8. Connection management (create, edit, clone, move, delete)

Implemented in `app/src/core/api/GuacAdminApi.ts` (models in `app/src/core/models/Admin.ts`)
and `app/src/ui/admin/`. Extra path abbreviations:

- `JDBC/` = `extensions/guacamole-auth-jdbc/modules/guacamole-auth-jdbc-base/src/main/java/org/apache/guacamole/auth/jdbc/`
  (the database extension; it is the writable connection store this section was checked
  against. Other extensions were not reviewed.)
- `PROTO/` = `guacamole-ext/src/main/resources/org/apache/guacamole/protocols/`
- `GUACD/` = `apache/guacamole-server` at `1.6.0`, `src/protocols/`

All URLs below are under `api/session/data/{dataSource}/` (`JAVA/rest/session/UserContextResource.java`
mounts `self`, `activeConnections`, `connections`, `connectionGroups`, `history` and `schema`),
take the `Guacamole-Token` header, and send and receive `application/json`
(`@Consumes`/`@Produces` on the resources).

### 8.1 Connections

| Operation | Request | Response | Source |
|---|---|---|---|
| Get | `GET connections/{id}` | `APIConnection` (no `parameters`) | `FE/rest/services/connectionService.js` `getConnection`; `JAVA/rest/directory/DirectoryObjectResource.java` `@GET getObject` |
| Get parameters | `GET connections/{id}/parameters` | `{ [name]: value }` | `connectionService.getConnectionParameters`; `JAVA/rest/connection/ConnectionResource.java` `getConnectionParameters` |
| Create | `POST connections` with an `APIConnection` without `identifier` | the posted object with `identifier` filled in (inferred; see below) | `connectionService.saveConnection` (no identifier → POST, then `connection.identifier = newConnection.identifier`); `JAVA/rest/directory/DirectoryResource.java` `@POST createObject` returns `object`, whose identifier the directory set through `APIConnectionWrapper.setIdentifier` |
| Update | `PUT connections/{id}` with the full `APIConnection` | `204` no body | `saveConnection` (identifier → PUT); `DirectoryObjectResource` `@PUT updateObject` (`void`) |
| Delete | `DELETE connections/{id}` | `204` | `connectionService.deleteConnection`; `DirectoryObjectResource` `@DELETE deleteObject` |
| History | `GET connections/{id}/history` | `APIConnectionRecord[]`, newest first, at most 1000 | `connectionService.getConnectionHistory`; `ConnectionResource.getConnectionHistory` sorts by `START_DATE` descending; `JAVA/rest/history/ActivityRecordSetResource.java` (`MAXIMUM_HISTORY_SIZE = 1000`) |
| Batch | `PATCH connections` with `[{op, path, value}]` | `{ patches: [...] }` | `connectionService.patchConnections`; `DirectoryResource.patchObjects`. Not used by the app. |

The identifier in the create response is inferred: the web client reads
`newConnection.identifier`, and `createObject` returns the posted object, which shares state with
the `APIConnectionWrapper` the directory receives (its `setIdentifier` writes through). That the
database extension calls `setIdentifier` on the added object was not read. The app treats a
response without an identifier as an invalid response, and the change may still have been made.

The body (`JAVA/rest/connection/APIConnection.java`, `@JsonIgnoreProperties(ignoreUnknown = true)`):

```json
{
  "parentIdentifier": "ROOT",
  "name": "Office PC",
  "protocol": "rdp",
  "parameters": { "hostname": "host.example", "port": "3389", "color-depth": "16" },
  "attributes": { "max-connections": "", "guacd-hostname": "" }
}
```

What the server does with it, and what that means for the client:

- **Update is a full replace.** `ConnectionObjectTranslator.applyExternalChanges` builds a new
  configuration from `object.getProtocol()` and `object.getParameters()` and also sets
  `parentIdentifier`, `name` and `attributes` from the body. Tree nodes carry no parameters
  (§2.1), so **every update, including a move, first loads `GET connections/{id}` and
  `…/parameters`, changes what it needs, and sends all five fields.** The app never PUTs an
  object built from the tree.
- **Always send `attributes`.** `DirectoryObjectTranslator.filterAttributes` calls
  `attributes.get(...)` on the posted map without a null check, and keeps only names that the
  data source's connection-attribute schema (§8.4) defines.
- **Empty means unset.** The database stores no row for a parameter whose value is null or
  empty (`JDBC/connection/ConnectionService.java`, `getParameterModels`), so `""` and an
  absent key are equivalent. Values longer than 4096 characters are refused with
  `BAD_REQUEST`, key `CONNECTION_PARAMETERS.DATABASE_PARAMETER_VALUE_TOO_LONG`
  (`CONNECTION_PARAMETER_VALUE_LIMIT`).
- **Validation errors are `BAD_REQUEST`** (`GuacamoleClientException`): blank name
  ("Connection names must not be blank."), and a name already used in the same parent
  ("The connection "…" already exists."), in `JDBC/connection/ConnectionService.java`
  `beforeCreate` / `beforeUpdate`. There is no separate conflict type; the app shows the
  server's message.
- **Reading parameters needs UPDATE.** `ConnectionResource.getConnectionParameters` throws
  `GuacamoleSecurityException` unless the user has system `ADMINISTER` or `UPDATE` on that
  connection. The database extension also returns an empty map without `UPDATE`
  (`ConnectionService.retrieveParameters`, used by `ModeledGuacamoleConfiguration.getParameters`).

**Passwords.** With `UPDATE`, the database extension returns every stored parameter as
stored, passwords included (`retrieveParameters` copies each `ConnectionParameterModel`
value; nothing is masked). The web client relies on that: its edit screen binds the returned
map to the form, shows `PASSWORD` fields as `type=password` inputs with a show/hide toggle
(`FE/form/templates/passwordField.html`, `FE/form/controllers/passwordFieldController.js`),
and saves the whole map back (`manageConnectionController.saveConnection`). So upstream
does **not** hide existing passwords from an editor. The task assumption that "existing
passwords are not returned as-is" does not hold for the database extension. Another
extension could implement `getParameters` differently. A PUT always replaces the map, so if
such an extension omitted passwords, saving would clear them. The app's editor shows password
fields masked with a show/hide toggle, saves the map exactly as shown, and its clone screen
says which password fields were copied and that any others must be entered again.

**Clone** (`FE/manage/controllers/manageConnectionController.js`, `loadClonedConnection` and
`cloneConnection`): the web client navigates to `#/manage/{ds}/connections/?clone={id}`,
loads the source connection **and its parameters**, deletes `identifier`, starts with an
empty history, and saves the result as a new connection with `POST`, so the copy carries
whatever the parameters endpoint returned (passwords included, see above). It does not
rename the copy; the app pre-fills "Copy of …" because names must be unique per parent.
Only `canCloneObject = exists && (isAdmin || canCreate)` gates it upstream
(`FE/manage/types/ManagementPermissions.js`). Loading parameters also needs `UPDATE` (above),
so the app requires both.

**New connection** (`loadSkeletonConnection`): `{ protocol: 'vnc', parentIdentifier: <?parent> }`
with empty parameters. The app starts with no protocol picked instead.

### 8.2 Connection groups (folders)

| Operation | Request | Source |
|---|---|---|
| Get | `GET connectionGroups/{id}` | `FE/rest/services/connectionGroupService.js` `getConnectionGroup` |
| Create | `POST connectionGroups` (no `identifier`; response carries it) | `saveConnectionGroup` |
| Update | `PUT connectionGroups/{id}` | `saveConnectionGroup` |
| Delete | `DELETE connectionGroups/{id}` | `deleteConnectionGroup` |

Body (`JAVA/rest/connectiongroup/APIConnectionGroup.java`, `ignoreUnknown`, `NON_NULL`):
`{ parentIdentifier, name, type: "ORGANIZATIONAL" | "BALANCING", attributes }`.
`ConnectionGroupObjectTranslator.applyExternalChanges` sets exactly `name`,
`parentIdentifier`, `type` and `attributes` (filtered by the group-attribute schema), so an
update also has to send all of them.

- Validation (`JDBC/connectiongroup/ConnectionGroupService.java`): blank name and duplicate
  name in the same parent are `BAD_REQUEST`. Moving a group into itself **or any descendant**
  is refused: `beforeUpdate` walks up from the new parent and throws
  `GuacamoleUnsupportedException("A connection group may not contain itself.")`. The app's
  folder picker never offers those targets.
- **Deleting a folder deletes everything in it.** The database schema declares
  `parent_id … REFERENCES guacamole_connection_group … ON DELETE CASCADE` for both groups and
  connections (`extensions/guacamole-auth-jdbc/modules/guacamole-auth-jdbc-mysql/schema/001-create-schema.sql`).
  The delete confirmation says so and counts what the app can see.
- `ROOT` is the root group's identifier in the tree (§2) and in `parentIdentifier`.

### 8.3 Permissions

| | |
|---|---|
| Request | `GET self/effectivePermissions` |
| Response | `APIPermissionSet`: `{ connectionPermissions, connectionGroupPermissions, sharingProfilePermissions, activeConnectionPermissions, userPermissions, userGroupPermissions: { [id]: Type[] }, systemPermissions: Type[] }` |
| Object types | `READ`, `UPDATE`, `DELETE`, `ADMINISTER` |
| System types | `ADMINISTER`, `AUDIT`, `CREATE_USER`, `CREATE_USER_GROUP`, `CREATE_CONNECTION`, `CREATE_CONNECTION_GROUP`, `CREATE_SHARING_PROFILE` |

Sources: `FE/rest/services/permissionService.js` (`getEffectivePermissionsResourceURL` uses
`self/effectivePermissions` for the current user because the user may not exist as an object
in that data source); `JAVA/rest/user/UserResource.java` `@Path("effectivePermissions")`;
`JAVA/rest/permission/APIPermissionSet.java`; `FE/rest/types/PermissionSet.js`
(`ObjectPermissionType`, `SystemPermissionType`).

Permissions are **per data source**: the web client fetches one set per entry of
`availableDataSources` (`FE/navigation/services/userPageService.js`,
`generateSettingsPages`). The app offers management in a data source only if that set
grants something below. A source that grants no create, update, delete or administer
permission gets no management UI. **Unverified:** that the read-only upstream extensions
(LDAP, JSON, header) grant none; their permission sets were not read. A failure or `NOT_FOUND` for one source hides
management there and nothing else.

How the web client decides (mirrored in `app/src/ui/admin/permissions.ts`):

- It ignores `UPDATE` on `ROOT` before deciding anything
  (`PermissionSet.removeConnectionGroupPermission(…, UPDATE, ROOT)` in
  `userPageService.js` and `FE/settings/directives/guacSettingsConnections.js`).
- Manage connections at all: `ADMINISTER`, `CREATE_CONNECTION` or `CREATE_CONNECTION_GROUP`,
  or any `UPDATE`/`DELETE`/`ADMINISTER` on a connection or group (`userPageService.js`).
- New connection: `ADMINISTER` or `CREATE_CONNECTION`. New group: `ADMINISTER` or
  `CREATE_CONNECTION_GROUP` (`guacSettingsConnections.js`, `canCreateConnections`,
  `canCreateConnectionGroups`).
- Per object (`FE/manage/types/ManagementPermissions.js`, `fromPermissionSet`): save =
  `isAdmin || (!exists && canCreate) || UPDATE`; delete = `exists && (isAdmin || DELETE)`;
  clone = `exists && (isAdmin || canCreate)`.
- The server additionally checks the parent folders. Creating, moving or deleting an
  object needs `UPDATE` on every parent group it changes, unless the user is privileged
  (`JDBC/base/ModeledChildDirectoryObjectService.java`, `canUpdateModifiedParents`). The
  database models the root as a null parent, so the root is never checked. The app's folder
  picker therefore offers the top level, plus groups where the user is an administrator or
  has `UPDATE`. The web client filters its location chooser by `ADMINISTER` instead
  (`manageConnectionController`, `getConnectionGroupTree(…, [ADMINISTER])`).
- A `403` is still possible (permissions changed after loading). Admin calls follow a
  `PERMISSION_DENIED` with `HEAD api/session` (§1.3): if the session is still valid the
  error is `permission-denied` and the app hides management for that data source; if not, it
  is `session-expired` as before.

### 8.4 Schema: protocols, forms and fields

| Request | Response | Source |
|---|---|---|
| `GET schema/protocols` | `{ [name]: ProtocolInfo }` | `FE/rest/services/schemaService.js` `getProtocols`; `JAVA/rest/schema/SchemaResource.java` `getProtocols` returns `LocalEnvironment.getProtocols()` |
| `GET schema/connectionAttributes` | `Form[]` | `getConnectionAttributes` |
| `GET schema/connectionGroupAttributes` | `Form[]` | `getConnectionGroupAttributes` |

- `ProtocolInfo` = `{ name, connectionForms: Form[], sharingProfileForms: Form[] }`
  (`FE/rest/types/Protocol.js`; the built-in definitions are `PROTO/rdp.json`, `vnc.json`,
  `ssh.json`, `telnet.json`, `kubernetes.json`; guacd extensions can add more).
- `Form` = `{ name, fields: Field[] }`; `Field` = `{ name, type, options? }`
  (`FE/rest/types/Form.js`, `Field.js`; `EXT/form/Field.java`). The web client's field
  templates (`FE/form/services/formService.js`, `fieldTypes`) cover `TEXT`, `EMAIL`,
  `NUMERIC`, `BOOLEAN`, `USERNAME`, `PASSWORD`, `ENUM`, `MULTILINE`, `TIMEZONE`, `LANGUAGE`,
  `DATE`, `TIME`, `REDIRECT` and `TERMINAL_COLOR_SCHEME`.
- Value semantics from the field controllers (`FE/form/controllers/`):
  - `BOOLEAN` is on when the value equals `options[0]` (`"true"` in every built-in
    protocol), and off is `""`, not `"false"` (`checkboxFieldController.js`).
  - `NUMERIC` is a string holding a number, with `""` for unset (`numberFieldController.js`).
  - `ENUM` offers exactly `options`. `""` (the first option in the built-in protocols) means
    "server default" (`selectFieldController.js`).
  - `PASSWORD` is a masked text input with a show/hide toggle.
  - `TERMINAL_COLOR_SCHEME` lists named schemes as options but also accepts a custom scheme
    string. The app treats it as an `ENUM` plus free text.
- Attribute forms in the database extension:
  - Connections (`JDBC/connection/ModeledConnection.java`, `ATTRIBUTES`):
    - `concurrency`: `max-connections` and `max-connections-per-user`, both NUMERIC.
    - `load-balancing`: `weight` (NUMERIC) and `failover-only` (BOOLEAN `"true"`).
    - `guacd`: `guacd-hostname` (TEXT), `guacd-port` (NUMERIC) and `guacd-encryption` (ENUM
      `""`/`none`/`ssl`).
  - Groups (`JDBC/connectiongroup/ModeledConnectionGroup.java`): `concurrency`, with
    `max-connections`, `max-connections-per-user` and `enable-session-affinity` (BOOLEAN
    `"true"`).
  - `getAttributes` puts every one of these names in the map, with `null` for unset ones.
    The parser drops nulls (§2.1).
- The web client shows, for an existing object, only attributes present in its map
  (`manageConnection.html`, `model-only="!managementPermissions.canChangeAllAttributes"`;
  `FE/form/directives/form.js`, `isVisible`). The database extension always includes every
  attribute, so the app shows the whole attribute schema.
- **Labels.** The web client translates, it does not hard-code labels:
  - Field header: `<NS>.FIELD_HEADER_<NAME>` (`FE/form/directives/formField.js`,
    `getFieldHeader`).
  - Option: `<NS>.FIELD_OPTION_<NAME>_<VALUE or EMPTY>`.
  - Section: `<NS>.SECTION_HEADER_<FORM>` (`FE/form/directives/form.js`).
  - `<NS>` is `PROTOCOL_<PROTOCOL>` for parameters (`Protocol.getNamespace`), and
    `CONNECTION_ATTRIBUTES` or `CONNECTION_GROUP_ATTRIBUTES` for attributes
    (`manageConnection.html`, `manageConnectionGroup.html`).
  - Canonicalising replaces every run of non-alphanumerics with `_` and upper-cases
    (`FE/locale/services/translationStringService.js`, `canonicalize`), so `color-depth`
    becomes `COLOR_DEPTH`.
  - English values end in a colon ("Color depth:") and may be links of the form
    `@:NAMESPACE.KEY` (angular-translate). See `guacamole/src/main/frontend/src/translations/en.json`.
- **Server translations at runtime.** `GET translations/{languageKey}.json`, relative to the
  base URL and without a token, returns the server's merged table, including extension
  strings such as `CONNECTION_ATTRIBUTES`. Sources: `FE/locale/services/translationLoader.js`
  (`url: 'translations/' + key + '.json'`) and `JAVA/extension/ExtensionModule.java`
  (`serve("/translations/" + languageKey + ".json")`); the available keys come from
  `GET api/languages` (§1.5). The app loads the table for its UI language (falling back to
  `en`), strips the trailing colon and resolves `@:` links. When a key is missing or the
  fetch fails, it derives a label from the name (`enable-wallpaper` → "Enable wallpaper").
  No upstream translation text is copied into this repository.

### 8.5 Active connections and history

| Operation | Request | Source |
|---|---|---|
| List | `GET activeConnections` → `{ [activeId]: APIActiveConnection }` (optional `permission=` filter) | `FE/rest/services/activeConnectionService.js` `getActiveConnections`; `DirectoryResource.getObjects` |
| Disconnect | `PATCH activeConnections` with `[{ "op": "remove", "path": "/<activeId>" }]` | `activeConnectionService.deleteActiveConnections`; `DirectoryResource.patchObjects`. On failure the server answers with an error body that carries `patches` outcomes. |

- `APIActiveConnection` (`JAVA/rest/activeconnection/APIActiveConnection.java`) has
  `identifier`, `connectionIdentifier`, `startDate`, `remoteHost`, `username` and
  `connectable`. The app filters the list by `connectionIdentifier` to show one
  connection's sessions.
- Who may disconnect, in the database extension: a privileged user or one with `DELETE` on
  that active connection (`JDBC/activeconnection/ActiveConnectionService.java`,
  `deleteObject` / `hasObjectPermissions`), which otherwise throws "Permission denied.". The
  web client's session list does not check this itself; it offers Delete for any selected
  session (`FE/settings/directives/guacSettingsSessions.js`, `canDeleteSessions`). The app
  shows Disconnect for system `ADMINISTER` or `DELETE` in `activeConnectionPermissions`.
- `PATCH` needs an atomic directory (`DirectoryResource.patchObjects` refuses otherwise). The
  database extension's directories are atomic: `JDBC/base/JDBCDirectory.java`,
  `tryAtomically`, runs the operation in a transaction with `atomic = true`.
- `APIConnectionRecord` (`JAVA/rest/history/APIActivityRecord.java`,
  `APIConnectionRecord.java`) has `startDate`, `endDate`, `remoteHost`, `username`,
  `active`, `identifier`, `uuid`, `attributes`, `logs`, `connectionIdentifier`,
  `connectionName`, `sharingProfileIdentifier` and `sharingProfileName`.
- **Unverified:** the date fields use Jackson's default `Date` serialisation (epoch
  milliseconds), as for `lastActive` in §2.1. The parser accepts a number or an ISO string.

### 8.6 Bandwidth-relevant parameters (presets)

The "Performance & quality" presets set only parameters that exist in the 1.6.0 protocol
definitions:

- RDP, form `display` (`PROTO/rdp.json`): `color-depth` (`8`/`16`/`24`/`32`),
  `force-lossless` and `resize-method` (`reconnect`/`display-update`).
- RDP, form `performance`: `enable-wallpaper`, `enable-theming`, `enable-font-smoothing`,
  `enable-full-window-drag`, `enable-desktop-composition`, `enable-menu-animations`,
  `disable-bitmap-caching`, `disable-offscreen-caching`, `disable-glyph-caching` and
  `disable-gfx`.
- RDP, form `device-redirection`: `disable-audio`. **RDP has no `enable-audio` in 1.6.0.**
- VNC (`PROTO/vnc.json`): `color-depth`, `force-lossless`, `cursor` (`local`/`remote`),
  `compress-level` and `quality-level` (`0`–`9`), `encodings` (all in `display`), and
  `enable-audio` (in `audio`).
- guacd: with the RDP graphics pipeline (GFX) enabled, which is the default, guacd uses
  32 bpp whatever `color-depth` says (`GUACD/rdp/settings.c`, `RDP_GFX_REQUIRED_DEPTH = 32`;
  without GFX the default depth is `RDP_DEFAULT_DEPTH = 16`). A lower colour depth therefore
  only applies with `disable-gfx` set, so the low-bandwidth preset sets both.
- guacd: VNC `compress-level` and `quality-level` default to -1, which means the VNC
  library's own default (`GUACD/vnc/settings.c`).
