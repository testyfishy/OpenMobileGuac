# Guacamole 1.6.0 feature parity

What an Apache Guacamole 1.6.0 server offers a client, compared with what this app implements.
Compiled 2026-11-20 by reading the vendored `guacamole-common-js` 1.6.0 modules, the app's
code, the Guacamole manual and selected `apache/guacamole-client` 1.6.0 sources.

## How to read this

- **App = Yes** means the code is in the tree and unit-tested. As with every row in
  `docs/FEATURES.md`, **nothing has run on a phone yet**, and only the rows marked
  "local 1.6.0 server" (sign-in rows in §1 and §12, 2026-11-20) were run against a real
  Guacamole server, a throwaway local one. "Yes" is never "verified in the field".
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
| Server's explanatory text on the extra step (e.g. "password expired", "Duo required", auth-restrict "outside allowed hours") | Yes (translated `translatableMessage`) | Yes (2026-11-20): the step's prompt and refusals (`BAD_REQUEST` on the extra step) are shown from the server's own `translations/<lang>.json`, with `{VAR}` / plural formatting, else its English `message` (`ui/auth/serverText.ts`, `LoginForm.tsx`). Field labels use `LOGIN.FIELD_HEADER_*`. Checked against a local 1.6.0 server (expired password, password policy, TOTP enrolment) | Useful | — |
| Forced password change at login (database extension: password expired / reset) | Yes | Yes (2026-11-20, local 1.6.0 server, desktop browser): new/confirm fields, a local mismatch check, policy errors from the server. The server stores the new password before a later step (TOTP) runs, so the app then signs in with the new password and saves it if remembered; before this fix the next step sent the old password and failed (`ui/auth/authFlow.ts`, `AuthService.login`; docs/protocol-notes.md §1.8) | Baseline | — |
| Duo (1.6.0 uses Duo Universal Prompt: a `REDIRECT` field named `duo_code`; Duo returns `duo_code` **and** `state`) | Yes | Experimental (2026-11-20): the extra step shows "Continue to Duo", the in-app browser waits for a page at the return address with both `duo_code` and `state`, and the app posts both with the username and password (`ConnectionsScreen.tsx` `startDuo`, `core/sso/sso.ts` `findDuoRedirect`, docs/protocol-notes.md §1.7). Unit-tested against the upstream request shapes; never run against Duo. The race with the server's own page (`docs/sso.md`) applies | Baseline where Duo is used | Test with a real Duo tenant; the race needs native navigation interception |
| SSO: OpenID Connect, SAML, CAS | Yes | Experimental: detected from the `REDIRECT` field **or** the login-page links in `api/patches` (on a database + OpenID server only the links exist; the app previously missed SSO there). OpenID checked end to end against Keycloak 26 and a local 1.6.0 server except the in-app browser step itself (`core/sso/sso.ts`, `ui/auth/ssoFlow.ts`, `docs/sso.md`). The race with the server's own page remains (measured margin about 170 ms in desktop Chromium) | Baseline where SSO is used | M: native navigation interception removes the race; SAML/CAS untested |
| Several SSO providers offered at once (1.6.0 lists each once) | Yes | Yes: one button per provider from `api/patches` (`ssoProvidersFromPatches`) | Niche | — |
| HTTP header auth (`guacamole-auth-header`, behind an authenticating reverse proxy) | Yes (the browser carries the proxy's cookies) | No (unconfirmed): requests go through native HTTP with no proxy session cookie. Works only if the proxy can authenticate a non-browser client | Useful for proxy setups | L: needs a web-view login that shares cookies with native HTTP and the WebSocket |
| Client-certificate / smart-card sign-in (1.6.0 `guacamole-auth-ssl`) | Yes | No | Niche | L: needs native TLS client-certificate support |
| Encrypted JSON auth (`data=` parameter) | Yes | No: `loginWithParameters` exists (`GuacApi.ts`), but no link format feeds `data` to it | Niche | S |
| Quick Connect extension (type a URI such as `rdp://user@host:port/?params`; its REST path was not confirmed) | Yes when installed | No. `ui/servers/QuickConnect.tsx` is a different feature (a recents strip) | Useful | S |
| Share link join (`#/?key=…`) | Yes | Yes: `ui/servers/ShareLinkDialog.tsx` posts `{ key }`; memory-only session, `ui/services/shareSessions.ts` | Baseline | — |
| Private-CA or self-signed HTTPS | Browser decides | Yes (untested on device): device-installed CAs, or per-server trust of the certificate after showing its fingerprint, pinned to that address, over a native REST + tunnel path (`docs/tls.md`) | Baseline for home servers | Device test |
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
| Send a new size when the view changes (RDP `resize-method`, VNC `disable-display-resize` off, SSH/telnet/k8s) | Yes, always (`guacClient.js` `mainElementResized` → `sendSize`) | Yes, by default: "Match device size" (`matchDeviceSize: true` in `ui/session/settings.ts`; a stored per-connection "off" is kept), `SessionController.scheduleMatchSize`. Debounced (400 ms, 1.5 s on Low); compared with the last request, not the remote size. Deliberate differences: no resize while the soft keyboard is up (the keyboard only covers the desktop; a change made meanwhile is sent when it closes), never with a fixed or custom Remote resolution, and never in a joined or share-link session (guacd takes `size` from any non-read-only user, `rdp/user.c`, so a viewer would resize the owner's desktop) | Baseline | — |
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
| Large files | Downloads go over REST (`GET api/session/tunnels/{uuid}/streams/{index}/{name}`) straight to disk; uploads are POSTed in 4 MiB chunks | Downloads: Yes on native. The same stream endpoint, requested through native HTTP (`Filesystem.downloadFile`, no CORS) with the token in the `Guacamole-Token` header, written to a hidden `.omg-…part` file and renamed when complete (`ui/session/fileSave.ts`, `transfers.ts`). Complete only when the in-band `end` arrives too (the response also ends normally on a tunnel close). Falls back to in band (append per ~768 KB, ack after each write) when the request fails before any data, and on the web. Cancel stops acking the server's forced blobs instead of sending an error ack (see `transfers.ts`), so guacd stalls at the next frame and the part file is deleted after the 60 s idle timeout (with a still remote screen the file may finish first; unverified). Servers trusted by fingerprint (SRV-8) get the in-band path: the native download does not use the pinned-TLS plugin. Uploads: still in band (6 KB blobs, one per ack) | Baseline for big files | Uploads: M (REST `PUT` through native HTTP) |
| Drag and drop / share-sheet "Open in" to upload | Yes (drag and drop) | No share-sheet target (proposed FIL-3); upload is from a file picker | Useful | M: native share extension / intent |
| Server switches `disable-download`, `disable-upload`, `sftp-*` | Server-side | Server-side | — | — |

## 7. Audio and other streams

| Feature | Guacamole web client | This app | Importance | Effort / blocker |
| --- | --- | --- | --- | --- |
| Audio output (`audio` stream, `AudioPlayer`) | Yes | Yes: `ui/session/audio.ts`, per-session mute; no audio focus or iOS silent-switch handling | Baseline | S for audio focus |
| Audio input (RDP `enable-audio-input`): on connect the web client calls `createAudioStream('audio/L16;rate=44100,channels=2')` with `Guacamole.AudioRecorder`, and re-opens it when it closes | Yes | Yes, opt-in: "Send microphone" (`microphone: false` by default; More › Sound, toolbar Mic, Settings › Sound), `ui/session/microphone.ts`. Same mimetype and re-open on close; opened only while the option is on, the session is shown and in the foreground. `getUserMedia` (the OS prompt) runs only after guacd accepts the stream (owner + `enable-audio-input`); a refusal turns the option off with an explanation. iOS: `NSMicrophoneUsageDescription`; Android: `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS` | Useful (calls, dictation) | — |
| Named pipes (`pipe` instruction, RDP `static-channels`) | Not handled by the web client | Not handled | Niche | — |
| Argument values (`argv`): SSH/telnet font, colour scheme | Yes | Yes: `ui/session/argv.ts` | Useful | — |
| `required` prompt (server asks for username/password/domain) | Yes (asks every time; nothing is remembered) | Yes: `session/credentials/requiredParams.ts`, `ui/session/CredentialSheet.tsx`. Beyond the web client: answers can be remembered per connection ("Remember connection passwords", default until the app is closed, in memory; optional secure-store save), so reconnects after the app was in the background do not ask again (`session/credentials/rememberedParams.ts`, `ui/services/connectionSecrets.ts`) | Baseline | — |
| "User joined / left" notices and user count on shared sessions (`msg`, `onjoin`, `onleave`, 1.5.0+) | Yes | Yes: `client.onjoin` / `onleave` (vendored `Client.js` "msg" handler) → toast and an "N viewers" pill with names (`SessionController.ts`). guacd sends these to the owner only (`libguac/client.c` `guac_client_owner_notify_join`), so the count excludes the owner; anonymous (share-link) users have an empty name | Useful (privacy) | — |

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
| Admin: view all active sessions, filter, kill | Yes (Settings › Active Sessions) | Yes (no filter): header button in the connection list, `ui/admin/SessionsSheet.tsx` (all managed data sources, newest first, user · connection · start · remote host, Disconnect where `canKill`). Offered for system ADMINISTER or any active-connection permission | Useful | — |
| Admin: join or watch an active session (`GUAC_TYPE=a`) | Yes (`guacSettingsSessions.js` `getClientURL`: `ClientIdentifier.Types.ACTIVE_CONNECTION` with the active id, only when `connectable`) | Yes: Join in the same list (after a confirmation) opens a session with `GUAC_TYPE=a`, `GUAC_ID=<active id>` (`ui/launch/SessionHost.tsx`, `SessionTarget.join`). No settings, thumbnails or recents are stored for it, and it never resizes the remote | Useful | — |

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
| Change own password (Settings › Preferences, if permitted) | Yes | Yes (2026-11-20, local 1.6.0 server, desktop browser): Edit server › Account password, shown while signed in and when the account has `UPDATE` on itself or `ADMINISTER` (`GuacApi.canChangePassword`, `changePassword`; `ui/servers/ChangePasswordSection.tsx`). Wrong current password and policy errors are shown; a saved password is replaced | Baseline for database-auth users | — |
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
| RDP display resize (`resize-method`) | Yes | Yes, by default (§3) | Baseline | — |
| RDP audio input | Yes | Yes, opt-in (§7) | Useful | — |
| RDP multi-touch (`enable-touch`) | Yes | Yes (§4) | Useful | — |
| VNC audio (PulseAudio `enable-audio`) | Yes | Yes: ordinary audio stream (§7) | Niche | — |
| VNC reverse connect, repeater, encodings, quality (1.6.0) | Server-side | Server-side; the app adds quality presets (`ui/admin/presets.ts`) | — | — |
| SSH/telnet/Kubernetes terminal: text selection copies to the clipboard, paste, font and colour | Yes | Yes: clipboard (§5), argv font/colour (`ui/session/argv.ts`, `session/terminalFont.ts`), Terminal key set by default | Baseline | — |
| SSH SFTP, `guacctl` / `guacget` | Yes | Yes (§6) | Useful | — |
| Wake-on-LAN (`wol-*`) | Server-side | Server-side; the app shows "waking the computer?" after 8 s | Useful | — |

## Baseline gaps

Ranked by severity. Lock-outs come first (the user cannot use the server at all), then
features a normal web-client user would miss.

1. **Duo two-factor (fixed in code 2026-11-20, untested with Duo).** The app now sends
   `duo_code` and `state` with the username and password (docs/protocol-notes.md §1.7).
   It still needs a real Duo tenant, and it shares the in-app-browser race below, so a
   Duo-protected server may still be unusable on some devices. M remaining: Duo test, native
   navigation interception.
2. **SSO (OpenID, SAML, CAS) is experimental.** OpenID was checked against Keycloak and a
   local 1.6.0 server up to the token exchange, and detection now also works when a
   database back end comes first. The in-app-browser hand-off can still lose a race with the
   server's own page (`docs/sso.md`); the app-callback hand-off avoids it for OpenID but
   needs IdP configuration. On SSO-only servers this remains a lock-out risk. M: native
   navigation interception; SAML/CAS tests.
3. **Self-signed HTTPS (SRV-8): built, untested on device.** A browser user can click through
   the warning; the app now shows the certificate's fingerprint and lets the user trust that
   one certificate for that address (pinned; a changed certificate is blocked). REST and the
   tunnel then use the app's native `PinnedTls` plugin (docs/tls.md). Remaining: the device
   checklist in docs/tls.md.
4. ~~**Resize follows the view.**~~ Done 2026-11: on by default, with the keyboard and
   fixed-resolution exceptions in §3. Untested on a device.
5. ~~Change own password~~ and 6. ~~Forced password change and server prompt text~~:
   done 2026-11-20 and checked against a local 1.6.0 server (rows in §1 and §12).
7. ~~**Large file downloads.**~~ Done 2026-11 on native (stream endpoint to disk, §6).
   Untested on a device. Uploads are still in band.

## Worth adding

1. ~~**Join / leave notices on shared sessions**~~ Done 2026-11 (§7).
2. ~~**RDP microphone**~~ Done 2026-11, opt-in (§7).
3. ~~**Admin: join an active session and a global active-sessions list.**~~ Done 2026-11
   (§9).
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

- RADIUS challenge fields through the generic form (read from code only; no server). The
  forced-password-change flow was checked on 2026-11-20.
- Duo is built from the code and unit tests, not a test. Per the manual, `duo-redirect-uri`
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
