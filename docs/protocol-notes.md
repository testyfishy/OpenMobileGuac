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

## 6. Not verified

These need checking against a live 1.6.0 server (PLAN T0.4):

- The exact JSON serialisation of `null` fields in `APIError` and of `Date` (`lastActive`).
- Whether reverse proxies in front of the owner's server reject the WebSocket `Origin`
  of the app.
- How Capacitor's native HTTP surfaces TLS failures. On iOS it has not been checked at
  all. On Android the message text is matched heuristically (see
  `app/src/core/http/NativeHttpClient.ts`).
- Browser `fetch` cannot tell a TLS failure from an unreachable host.
