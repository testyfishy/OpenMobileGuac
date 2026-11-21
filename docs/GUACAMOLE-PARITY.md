# Guacamole 1.6.0 feature parity

What an Apache Guacamole 1.6.0 server offers a client, compared with what this app implements.
Compiled 2026-11-20 by reading the vendored `guacamole-common-js` 1.6.0 modules, the app's
code, the Guacamole manual and selected `apache/guacamole-client` 1.6.0 sources.

## How to read this

- **App = Yes** means the code is in the tree and unit-tested. As with every row in
  `docs/FEATURES.md`, **nothing has run on a phone or against a real Guacamole server yet**.
  "Yes" is never "verified in the field".
- **Partial**: some of it is built; the note says what is missing.
- **No**: not implemented.
- **Server-side**: guacd or the web application does the work, so any client gets it once the
  connection is configured. The app's only part is letting an admin set the parameter (see
  "Admin").
- **Importance**: Baseline (a normal web-client user would notice it missing), Useful, Niche.
- **Effort**: S = days, M = 1–2 weeks, L = more. Only given for gaps.
- **(unconfirmed)** marks a statement that could not be checked against a primary source in
  this pass.

Paths are relative to `app/src/`. Upstream references:

- `vendor/…/modules/X.js` is the vendored library.
- "Manual" is https://guacamole.apache.org/doc/gug/ (using-guacamole, administration,
  configuring-guacamole).
- "Web client" means `guacamole-client` 1.6.0: `ManagedClient.js`, `guacClient.js`,
  `tunnelService.js` and the Duo extension's `UserVerificationService.java`.

## 1. Connecting and authentication

| Feature | Guacamole web client | This app | Importance | Effort / blocker |
| --- | --- | --- | --- | --- |
| Username/password sign-in (`POST api/tokens`), works for the database, LDAP and RADIUS back ends | Yes | Yes: `core/api/GuacApi.ts`, `ui/auth/authFlow.ts` | Baseline | — |
| Token reuse, re-validation, sign-out (`DELETE api/session`) | Yes | Yes: `GuacApi.ts` (`isSessionValid`, `logout`); silent re-login with a saved password in `authFlow.ts` | Baseline | — |
| Several data sources (e.g. database plus LDAP) | Yes | Yes: tree loaded per data source (`GuacApi.getConnectionTree`, `ui/connections/`) | Baseline | — |
| Generic "additional credentials" form for `INSUFFICIENT_CREDENTIALS` fields (TEXT, PASSWORD, NUMERIC, EMAIL, ENUM, BOOLEAN…) | Yes | Yes: `ui/auth/LoginForm.tsx`; unknown field types fall back to a text field | Baseline | — |
| TOTP code entry and enrolment (QR code, key) | Yes | Yes: `LoginForm.tsx` (`GUAC_TOTP_CODE`), optional stored seed `core/totp/` | Baseline | — |
| Server's explanatory text on the extra step (e.g. "password expired", "Duo required", auth-restrict "outside allowed hours") | Yes (translated `translatableMessage`) | Partial: the `message` text is used for errors (`ui/errors/errorMessages.ts`); `translatableMessage` keys are parsed but not translated, and the extra step shows fields without the server's prompt text | Useful | S |
| Forced password change at login (database extension: password expired / reset) | Yes | Partial (unconfirmed): the new-password and confirm fields arrive as ordinary PASSWORD fields, so the generic form should render them. Not tested, and no explanatory text (row above) | Baseline | S to verify |
| Duo (1.6.0 uses Duo Universal Prompt: a `REDIRECT` field named `duo_code`; Duo returns `duo_code` **and** `state`) | Yes | **No** (from reading the code; not tested). After the password step, `noteExpected` (`ui/connections/ConnectionsScreen.tsx`) records the `duo_code` redirect, and the extra step hides `REDIRECT` fields (`ui/auth/authFlow.ts` `visibleExtraFields`). `startSso` falls back to that redirect, but the exchange posts only `{ duo_code }` (`{ [paramName]: value }`). Without `state` the server cannot resume the deferred username/password, so sign-in should fail. Duo returns to `duo-redirect-uri`, which the manual says must be the Guacamole web address, so the in-app-browser hand-off would also race the web page, as with SAML | Baseline where Duo is used | M: capture both `duo_code` and `state` from the return URL and post both; test against a real Duo tenant |
| SSO: OpenID Connect, SAML, CAS (`REDIRECT` field) | Yes | Partial / experimental: in-app browser or system-browser callback (`core/sso/sso.ts`, `ui/auth/ssoFlow.ts`, `docs/sso.md`). Not tested against any identity provider; there is a known race with the server's own page | Baseline where SSO is used | M to harden (needs real IdPs) |
| Several SSO providers offered at once (1.6.0 lists each once) | Yes | Partial: `findSsoRedirect` takes the first `REDIRECT` field only | Niche | S |
| HTTP header auth (`guacamole-auth-header`, behind an authenticating reverse proxy) | Yes (the browser carries the proxy's cookies) | No (unconfirmed): requests go through native HTTP with no proxy session cookie. Works only if the proxy can authenticate a non-browser client | Useful for proxy setups | L: needs a web-view login that shares cookies with native HTTP and the WebSocket |
| Client-certificate / smart-card sign-in (1.6.0 `guacamole-auth-ssl`) | Yes | No | Niche | L: needs native TLS client-certificate support |
| Encrypted JSON auth (`data=` parameter) | Yes | No: `loginWithParameters` exists (`GuacApi.ts`), but no link format feeds `data` to it | Niche | S |
| Quick Connect extension (type a URI such as `rdp://user@host:port/?params`; its REST path was not confirmed) | Yes when installed | No. `ui/servers/QuickConnect.tsx` is a different feature (a recents strip) | Useful | S |
| Share link join (`#/?key=…`) | Yes | Yes: `ui/servers/ShareLinkDialog.tsx` posts `{ key }`; memory-only session, `ui/services/shareSessions.ts` | Baseline | — |
| Private-CA or self-signed HTTPS | Browser decides | Partial: device-installed CAs only; per-server fingerprint trust is planned (`docs/tls.md`) | Baseline for home servers | M–L: native tunnel bridge |
| Auth rate limiting, IP/time restrictions (1.6.0) | Server-side | Server-side; errors shown with the server's message text | — | — |

## 2. Connection list and groups

| Feature | Guacamole web client | This app | Importance | Effort / blocker |
| --- | --- | --- | --- | --- |
| Connection tree with nested organisational groups | Yes | Yes: `ui/connections/treeView.ts`, `ConnectionBrowser.tsx` | Baseline | — |
| Launch a balancing group (`GUAC_TYPE=g`) | Yes | Yes: `ui/launch/SessionHost.tsx` maps `type 'g'` to `CONNECTION_GROUP` | Baseline | — |
| Filter / search | Yes | Yes: `ui/connections/SearchBox.tsx` | Baseline | — |
| Recent connections with live thumbnails | Yes | Yes: recents and thumbnails (`ui/servers/QuickConnect.tsx`, `SessionController.captureThumbnail`) | Baseline | — |
| "In use by n" | Yes (active counts) | Yes: `ui/connections/ConnectionBrowser.tsx` (`activeConnections`) | Useful | — |
| Open directly when the user has only one connection | Yes | No (unconfirmed) | Niche | S |
| Deep link to a connection | Yes (`#/client/…`) | Yes: `openmobileguac://connect` (`core/links/links.ts`) | Useful | — |

## 3. Display

| Feature | Guacamole web client | This app | Importance | Effort / blocker |
| --- | --- | --- | --- | --- |
| Render all drawing instructions (layers, PNG/JPEG/WebP, cursor) | Yes (library) | Yes: same vendored `Client.js`/`Display.js`; the image types advertised as upstream does (`ui/launch/mediaSupport.ts`, `imageSupport.ts`) | Baseline | — |
| Connect string: `GUAC_WIDTH/HEIGHT/DPI/AUDIO/VIDEO/IMAGE/TIMEZONE` | Yes | Yes: `core/api/tunnel.ts`, `ui/launch/connectData.ts` | Baseline | — |
| Send a new size when the view changes (RDP `resize-method`, VNC `disable-display-resize` off, SSH/telnet/k8s) | Yes, always (`guacClient.js` `mainElementResized` → `sendSize`) | Partial: built, but opt-in ("Match device size", `matchDeviceSize: false` in `ui/session/settings.ts`): `SessionController.scheduleMatchSize` | Baseline | S: decide the default |
| Fit to window, zoom (pinch, +/−) | Yes | Yes: fit modes, pinch, pan (`session/viewport/Viewport.ts`) | Baseline | — |
| Window title from the server (`name` instruction) | Yes (`onname` → title) | No: `onname` unused; the app shows the connection's own name | Niche | S |
| Video streams (`video` instruction) | Library only; `VideoPlayer.getSupportedTypes()` returns `[]` in 1.6.0 | Same: advertises what the library reports (none) | Niche | — (no guacd protocol sends video today) |
| Frame statistics (`sync` timing) | Yes (library) | Yes: `display.onstatistics` in `SessionController.ts`, shown in the Info sheet | Useful | — |
| Network round-trip time | Not shown | No: planned; the tunnel does not expose ping replies (`docs/protocol-notes.md`) | Useful | S |
| Fullscreen and keyboard lock (1.6.0) | Yes (browser APIs) | Partial: optional immersive mode (`ui/session/MoreSheet.tsx`). No keyboard lock: whether OS shortcuts (e.g. iPad Cmd+Tab) reach the session was not checked | Useful | S to check |
| Multiple monitors | No | No | — | Not in Guacamole |

## 4. Input

| Feature | Guacamole web client | This app | Importance | Effort / blocker |
| --- | --- | --- | --- | --- |
| Hardware keyboard key events (`key` instruction) | Yes (`Guacamole.Keyboard`) | Yes: own handler `session/keys/HardwareKeyboard.ts` (does not use `Guacamole.Keyboard`). Fidelity for dead keys, AltGr and non-US layouts is unverified | Baseline | S to verify on devices |
| Text input / IME mode | Yes ("Text input") | Yes: hidden-field bridge `session/keys/TextInputDiff.ts`; IME and swipe typing unverified | Baseline | — |
| On-screen keyboard (`Guacamole.OnScreenKeyboard` with layouts: en-us, de, fr, …) | Yes | Partial by design: the OS soft keyboard plus an editable key bar, combos and key sets (`session/keys/`, `ui/session/KeyBar.tsx`). `OnScreenKeyboard.js` is not used | Baseline (the special keys are covered) | — |
| Ctrl+Alt+Del and other combos | Yes (on-screen keyboard) | Yes: `ui/session/combos.ts`, `ComboMenu.tsx` | Baseline | — |
| Mouse: absolute (touchscreen) and relative (touchpad) emulation | Yes | Yes: `session/pointer/PointerModel.ts`, `session/gesture/GestureRecognizer.ts` | Baseline | — |
| Physical mouse, wheel | Yes | Yes: `PointerModel.ts`; pointer lock where the OS allows | Baseline | — |
| Multi-touch pass-through (RDP `enable-touch`, `onmultitouch` → `sendTouchState`) | Yes | Yes: `session/pointer/TouchPassthrough.ts`, `SessionController.ts` (`onmultitouch`, `sendTouchState`) | Useful | — |
| Horizontal scroll | No (protocol has wheel up/down only) | Emulated as Shift + wheel | Niche | — |
| Read-only (view only) | Server param `read-only` | Server param works; the app also has its own View-only toggle | Useful | — |
| Send keystrokes to several sessions at once (tiled multi-focus) | Yes | No | Niche | M |

## 5. Clipboard

| Feature | Guacamole web client | This app | Importance | Effort / blocker |
| --- | --- | --- | --- | --- |
| Remote → local text (`clipboard` stream) | Yes | Yes: `SessionController.ts` `onclipboard`, UTF-8 decoded once | Baseline | — |
| Local → remote text (`createClipboardStream`) | Yes; also pushed automatically on connect | Yes: Paste button, optional auto-send on open (`SessionController.ts`, `ui/session/ClipboardSheet.tsx`) | Baseline | — |
| Clipboard hidden until revealed (1.6.0) | Yes | Different: an explicit sheet with this session's history | — | — |
| Image clipboard | Web client handles non-text data as a Blob; RDP/VNC/SSH in guacd carry text only (unconfirmed for every protocol) | No: only `text/*` accepted | Niche | — (server side limits) |
| Server limits (`disable-copy`, `disable-paste`, `normalize-clipboard`) | Server-side | Server-side | — | — |

## 6. Files

| Feature | Guacamole web client | This app | Importance | Effort / blocker |
| --- | --- | --- | --- | --- |
| Filesystem objects (`filesystem`, RDP drive, SFTP): browse, upload, download, folders | Yes | Yes: `ui/session/transfers.ts` (`onfilesystem`, `requestInputStream`, `createOutputStream`), `ui/session/FilesSheet.tsx` | Baseline | — |
| Upload without a filesystem (`createFileStream`, e.g. SSH upload directory set by `guacctl`) | Yes | Yes: `transfers.ts` falls back to `client.createFileStream` | Useful | — |
| Server-initiated download (`file` instruction: `guacget`, RDP "Download" folder) | Yes | Yes: `transfers.ts` `onfile`, `ui/session/incomingFiles.ts`, accept/decline policy | Baseline | — |
| Large files | Downloads go over REST (`GET api/session/tunnels/{uuid}/streams/{index}/{name}`) straight to disk; uploads are POSTed in 4 MiB chunks | Partial: everything goes in-band over the WebSocket; downloads are held in memory before the share sheet (`ui/session/downloadCache.ts`, `fileSave.ts`) | Baseline for big files | M: either stream blobs to a native file, or use the REST stream endpoint through native HTTP (CORS does not apply to it) |
| Drag and drop / share-sheet "Open in" to upload | Yes (drag and drop) | No share-sheet target (proposed FIL-3); upload is from a file picker | Useful | M: native share extension / intent |
| Server switches `disable-download`, `disable-upload`, `sftp-*` | Server-side | Server-side | — | — |

## 7. Audio and other streams

| Feature | Guacamole web client | This app | Importance | Effort / blocker |
| --- | --- | --- | --- | --- |
| Audio output (`audio` stream, `AudioPlayer`) | Yes | Yes: `ui/session/audio.ts`, per-session mute; no audio focus or iOS silent-switch handling | Baseline | S for audio focus |
| Audio input (RDP `enable-audio-input`): on connect the web client calls `createAudioStream('audio/L16;rate=44100,channels=2')` with `Guacamole.AudioRecorder`, and re-opens it when it closes | Yes | **No**: `AudioRecorder` unused (planned AUD-2) | Useful (calls, dictation) | M: microphone permission in both native shells (`RECORD_AUDIO` / `NSMicrophoneUsageDescription`) and `getUserMedia` in the WebView; an in-session mic toggle |
| Named pipes (`pipe` instruction, RDP `static-channels`) | Not handled by the web client | Not handled | Niche | — |
| Argument values (`argv`): SSH/telnet font, colour scheme | Yes | Yes: `ui/session/argv.ts` | Useful | — |
| `required` prompt (server asks for username/password/domain) | Yes | Yes: `session/credentials/requiredParams.ts`, `ui/session/CredentialSheet.tsx` | Baseline | — |
| "User joined / left" notices and user count on shared sessions (`msg`, `onjoin`, `onleave`, 1.5.0+) | Yes | **No**: handlers unused | Useful (privacy: you should know someone is watching) | S |

## 8. Printing

| Feature | Guacamole web client | This app | Importance | Effort / blocker |
| --- | --- | --- | --- | --- |
| RDP printer (`enable-printing`): the job arrives as a PDF `file` stream | Yes (downloads the PDF) | Yes: same `onfile` path as downloads (`transfers.ts`, `incomingFiles.ts`), then the share sheet | Useful | — |

## 9. Session management and sharing

| Feature | Guacamole web client | This app | Importance | Effort / blocker |
| --- | --- | --- | --- | --- |
| Several connections open at once, switcher | Yes | Yes: `ui/sessions/SessionsProvider.tsx`, `SessionLayer.tsx` | Baseline | — |
| Tiled view of several connections | Yes | No | Niche on a phone | M |
| Reconnect after a drop | Yes (button, auto for some errors) | Yes: exponential backoff (`ui/session/status.ts`), retried at once on network return or app resume (`SessionController.ts`) | Baseline | — |
| Tunnel "unstable" state (no data for 1.5 s) | Yes (warning) | Yes: logged and checked on resume (`SessionController.ts`, `TunnelState.UNSTABLE`); whether a visible warning is shown was not checked | Useful | — |
| Error codes and texts (all 21 `Guacamole.Status.Code` values) | Yes | Yes: every code in `vendor/…/Status.js` is mapped in `ui/session/status.ts` | Baseline | — |
| Create a share link from a sharing profile | Yes | Yes: `GuacApi.ts` (`sharingProfiles`, `sharingCredentials`), `ui/session/ShareSheet.tsx` | Useful | — |
| WebSocket tunnel | Yes | Yes: `SessionHost.tsx` (`Guacamole.WebSocketTunnel`) | Baseline | — |
| HTTP tunnel fallback (`ChainedTunnel(WebSocket, HTTP)`) | Yes | No. Blocked: the HTTP tunnel needs CORS, which Guacamole does not send, and the native-HTTP XHR buffers responses (`docs/protocol-notes.md` §3.5) | Useful (proxies that block WebSocket) | L: native tunnel bridge |
| Admin: view all active sessions, filter, kill | Yes (Settings › Active Sessions) | Partial: per connection only, with Disconnect (`ui/admin/ActivitySheet.tsx`, `GuacAdminApi.getActiveConnections` / `killActiveConnections`). No global list | Useful | S |
| Admin: join or watch an active session (`GUAC_TYPE=a`) | Yes (1.5.0 release notes) | No: `core/api/tunnel.ts` defines type `'a'`, but nothing launches it | Useful | S |

## 10. Admin

| Feature | Guacamole web client | This app | Importance | Effort / blocker |
| --- | --- | --- | --- | --- |
| Connections: create, edit, clone, delete; every protocol parameter from `schema/protocols` | Yes | Yes: `ui/admin/ConnectionEditor.tsx`, `SchemaSections.tsx`, `core/api/GuacAdminApi.ts`. Tested only against the in-app fake server | Useful | — |
| Connection groups (organisational and balancing) with attributes | Yes | Yes: `ui/admin/GroupEditor.tsx`, `MoveSheet.tsx` | Useful | — |
| Sharing profiles: create, edit, delete | Yes | No | Niche | S–M |
| Users, user groups, permissions, user attributes (disabled, expiry, valid-from/until, time zone) | Yes | No (deliberate: `docs/FEATURES.md` §4) | Niche on a phone | L |
| Batch import of connections (CSV/JSON/YAML, 1.6.0) | Yes | No | Niche on a phone | M |
| Audit log (1.6.0 `AUDIT` permission) | Yes | No | Niche | M |

## 11. Recordings and history

| Feature | Guacamole web client | This app | Importance | Effort / blocker |
| --- | --- | --- | --- | --- |
| Connection history per connection | Yes | Yes: `GuacAdminApi` `connections/{id}/history`, `ActivitySheet.tsx` | Useful | — |
| Global history (filter, sort, page) | Yes | No | Useful for admins | S–M |
| Recording playback in the browser (`Guacamole.SessionRecording`, needs a history-recording-storage extension; 1.6.0 adds activity and key-event views) | Yes | No: `SessionRecording.js` is vendored but unused | Niche on a phone | M–L: fetch the recording through native HTTP and feed it to `SessionRecording` from a blob, since `StaticHTTPTunnel` would hit CORS |
| Recording creation (`recording-path`, `typescript-path`, …) | Server-side | Server-side (editable in the admin form) | — | — |

## 12. User preferences

| Feature | Guacamole web client | This app | Importance | Effort / blocker |
| --- | --- | --- | --- | --- |
| Change own password (Settings › Preferences, if permitted) | Yes | **No**: no call to the user password endpoint in `core/api/` | Baseline for database-auth users | S: `PUT api/session/data/{ds}/users/{user}/password` with `{ oldPassword, newPassword }` (web client `userService.js`) |
| Display language | Yes (many translations) | Partial: English and Spanish (`ui/i18n/`) | Useful | S per language (translators) |
| Time zone sent to the remote | Yes (browser zone; a preference can override it (unconfirmed)) | Partial: device zone only (`connectData.ts` `deviceTimezone`), no override | Niche | S |
| Default input method / mouse emulation | Yes | Yes: Session defaults (`ui/settings/SessionDefaultsEditor.tsx`, `ui/session/settingsSchema.ts`) | Useful | — |
| Recent-connection display settings | Yes | Partial: thumbnails can be turned off; a recents count setting was not found (unconfirmed) | Niche | S |

## 13. Protocol-specific

Most protocol features are configured server-side. With the right parameters guacd does the
work and any client benefits. Rows here list only features that need the client.

| Feature | Guacamole web client | This app | Importance | Effort / blocker |
| --- | --- | --- | --- | --- |
| RDP drive redirection (`enable-drive`, `drive-path`, …) | Yes | Yes: filesystem object (§6) | Baseline | — |
| RDP printing | Yes | Yes (§8) | Useful | — |
| RDP RemoteApp, gateway, `server-layout`, `timezone`, `console-audio` | Server-side | Server-side; editable in the admin form | — | — |
| RDP display resize (`resize-method`) | Yes | Partial: opt-in (§3) | Baseline | S |
| RDP audio input | Yes | No (§7) | Useful | M |
| RDP multi-touch (`enable-touch`) | Yes | Yes (§4) | Useful | — |
| VNC audio (PulseAudio `enable-audio`) | Yes | Yes: ordinary audio stream (§7) | Niche | — |
| VNC reverse connect, repeater, encodings, quality (1.6.0) | Server-side | Server-side; the app adds quality presets (`ui/admin/presets.ts`) | — | — |
| SSH/telnet/Kubernetes terminal: text selection copies to the clipboard, paste, font and colour | Yes | Yes: clipboard (§5), argv font/colour (`ui/session/argv.ts`, `session/terminalFont.ts`), Terminal key set by default | Baseline | — |
| SSH SFTP, `guacctl` / `guacget` | Yes | Yes (§6) | Useful | — |
| Wake-on-LAN (`wol-*`) | Server-side | Server-side; the app shows "waking the computer?" after 8 s | Useful | — |

## Baseline gaps

Ranked by severity. Lock-outs come first (the user cannot use the server at all), then
features a normal web-client user would miss.

1. **Duo two-factor.** Read from the code, Duo (Universal Prompt in 1.6.0) cannot complete:
   the app sends `duo_code` without `state`, so the server cannot resume the first factor.
   Anyone on a Duo-protected server would be locked out. M; needs a real Duo tenant to test.
2. **SSO (OpenID, SAML, CAS) is experimental.** It is built, but has never run against an
   identity provider, and the in-app-browser hand-off can lose a race with the server's own
   page (`docs/sso.md`). On SSO-only servers this is a lock-out risk. M; needs real
   identity providers.
3. **Self-signed HTTPS (already tracked as SRV-8).** A browser user can click through the
   warning; the app needs a device-installed CA. This is common on home servers. M–L,
   native.
4. **Resize follows the view.** The web client always sends the new size. The app does so only
   with "Match device size", which is off by default. S: a default change, but check RDP
   reconnect behaviour first.
5. **Change own password.** The web client offers it under Preferences when permitted. The
   app has no endpoint call. S.
6. **Forced password change and server prompt text.** The expired-password fields should
   render through the generic form, but this is untested. The server's explanatory message
   (`translatableMessage`) is not shown on the extra step. S.
7. **Large file downloads.** Downloads are buffered in memory. The web client streams them to
   disk over the REST stream endpoint. M.

## Worth adding

1. **Join / leave notices on shared sessions** (`onmsg`/`onjoin`/`onleave`). Tells the owner
   someone is watching. S.
2. **RDP microphone** (`AudioRecorder`, `enable-audio-input`). M; needs microphone
   permissions in both native shells.
3. **Admin: join an active session (`GUAC_TYPE=a`) and a global active-sessions list.** The
   API pieces exist. S.
4. **Quick Connect extension.** On servers that have it, users type `rdp://…` instead of
   saving a connection. S.
5. **Share-sheet upload target** (FIL-3). M.
6. **Global connection history** for admins. S–M.
7. **More UI languages.** S each, with translators.
8. **Header-auth / reverse-proxy SSO.** L; needs a cookie-sharing web-view login.

## Deliberately not planned or not possible

- **User, group and permission administration; batch import; audit log.** Left to the web
  client (`docs/FEATURES.md` §4).
- **Recording playback.** SPEC non-goal. Possible later via `SessionRecording` fed from a
  native-HTTP blob.
- **HTTP tunnel fallback (blocked, not a choice).** CORS and response buffering stop it
  unless a native tunnel bridge is built. It matters for proxies that refuse WebSocket.
- **Tiled multi-session view and broadcast typing.** Little value on a phone.
- **Guacamole's on-screen keyboard layouts.** Replaced by the OS keyboard plus the key bar.
- **Client-certificate / smart-card sign-in.** Needs native TLS client certificates.
- **Not possible with Guacamole today:** multiple monitors, image clipboard, horizontal
  wheel. guacd/RDP sends no video stream, and the library supports none.

## Could not confirm

- The forced-password-change flow and RADIUS challenge fields through the generic form (read
  from code only; no server).
- The Duo verdict comes from reading the code, not a test. Per the manual, `duo-redirect-uri`
  must be the Guacamole web address, so it cannot point at the app.
- These upstream names were recalled rather than fetched in this pass:
  - the Quick Connect REST path;
  - the `guacamole-auth-ssl` extension name;
  - the JSON auth `data` parameter;
  - the history-recording-storage extension;
  - the on-screen keyboard layout list.
- Header auth behaviour with native HTTP.
- Whether the web client's Preferences page offers a time-zone override.
- Image clipboard support per protocol in guacd 1.6.0.
- Hardware-keyboard fidelity on non-US layouts (own handler, not `Guacamole.Keyboard`).
- Everything marked "Yes" is unverified on a device and against a real server.
