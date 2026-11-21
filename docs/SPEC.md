# OpenMobileGuac — Product & Technical Specification

Status: draft v0.1 (2026-11-18). Working name; the store name is an open question (§2).
Companion document: [PLAN.md](PLAN.md) — phases and task briefs.

## 1. Summary

OpenMobileGuac is an open-source iOS and Android client for self-hosted
[Apache Guacamole](https://guacamole.apache.org/) servers. It connects to a Guacamole
server the user already runs (typically over Tailscale, a VPN, or a LAN) and replaces the
mobile-browser experience with one built for touch: a summonable keyboard, a
direct-touch / trackpad toggle, proper fit and zoom modes, two-way clipboard, and an extra
key bar. It will be published free on the App Store and Google Play.

The app does not replace any server component. It speaks the same REST API and tunnel that
the stock Guacamole web client uses.

## 2. Assumptions and open questions

These were assumed so planning could proceed. Each one names what changes if it is wrong.

| # | Assumption | If wrong |
|---|---|---|
| A1 | The owner has no Mac. iOS builds run on CI macOS runners and reach devices through TestFlight. | With a Mac, iOS tasks can be verified locally and Phase 0 gets faster. |
| A2 | The owner has at least one iPhone and one Android phone (ideally a foldable) for manual checks. | Without an iPhone, iOS behaviour cannot be verified by anyone before public release. |
| A3 | The owner's Guacamole server is reachable from the dev PC and is plain `http://` on a tailnet address. | If it is `https://` with a valid certificate, the cleartext and mixed-content work in §8.3 shrinks. |
| A4 | Auth on the owner's server is username/password, possibly with TOTP. | SSO (SAML/OIDC) moves from Phase 2 to Phase 1. |
| A5 | Docker is not installed on the dev PC (checked: it is not). Development tests against the owner's own server with a dedicated low-privilege test account. | Installing Docker Desktop allows a disposable local Guacamole stack; see PLAN task T0.2. |
| A6 | Licence is GPL-3.0-or-later, so that forks stay open, with an additional permission under GPLv3 section 7 (`LICENSE-APP-STORE-EXCEPTION`) that allows distribution through app stores. Earlier commits were published under Apache-2.0 and remain available under it; the vendored `guacamole-common-js` stays Apache-2.0. | Without the store permission, store terms could conflict with the GPL. |

Open questions for the owner:

1. **Store name.** "Guacamole" is an Apache Software Foundation trademark. The listing should
   follow the "X for Apache Guacamole" pattern with an "unofficial, not affiliated" line.
   A distinct product name (X) is needed before store submission, not before coding.
2. **Developer accounts.** Apple Developer Program and Google Play Console accounts must be
   opened by the owner (PLAN task U2). Individual or organisation?
3. **Demo server for store review** (§10.3): acceptable to host a small public one, or
   prefer an in-app demo mode only?

## 3. Background and prior art

- **Stock Guacamole web client on mobile.** Works, but on phones the soft keyboard cannot be
  raised reliably, phone-to-remote paste does not work, and scaling is limited. These are the
  owner's first-hand complaints and the reason for this project.
- **PocketGuac** ([site](https://guac.pocketsized.app/),
  [repo](https://github.com/pocketsized-apps/pocketguac)). Android only, distributed as an APK
  on GitHub Releases, not on Play. Its site states it is **not open source**, and the repo
  holds no source and no licence. Its public feature list is a useful reference: trackpad
  gestures, pinch zoom, key-combo menu with saved combos, two-way clipboard, audio, file
  transfer, saved servers, nested connection groups, TOTP with stored seed, SSO through a
  webview, biometric lock, JSON backup. **Feature reference only: no code or assets may be
  taken from it.**
- **DWService mobile.** Not examined for this spec. The behaviours cited from it come from
  the owner's description: the whole remote screen visible at once, a choice between fit
  modes, and a switch between direct touch input and whole-screen-as-trackpad.
- A brief, non-exhaustive search found no native iOS Guacamole client. It did surface a
  mention of an open-source "Flutter Guacamole" project whose page no longer loads; it is
  unverified prior art worth one more look in T0.1.

## 4. Goals and non-goals

Goals

- G1. Everything a user can do in a Guacamole session from a desktop browser is comfortable
  on a phone, tablet, or foldable.
- G2. One codebase, feature parity between iOS and Android.
- G3. Fully open source (GPL-3.0-or-later with an app-store permission), reproducible builds
  from the public repo.
- G4. No telemetry, no ads, no account, no third-party servers. The app talks only to servers
  the user adds.
- G5. Published on the App Store and Google Play; APK also on GitHub Releases.

Non-goals

- Bundling a VPN or Tailscale. The app needs a network path the OS already provides.
- Speaking RDP/VNC/SSH directly. Guacamole's server does that.
- Server administration (users, permissions, connection editing) in v1.
- Session recording playback in v1. (Printing was a v1 non-goal and is now built as FIL-2;
  microphone input moved to AUD-2, P3; see §6.8.)

## 5. Users and scenarios

Primary user: someone who self-hosts Guacamole on a private network and wants to reach
their machines from a phone.

- S1. On a phone in portrait, open a saved server, pick a Windows PC, see the whole desktop,
  zoom into a window, type a command, send Ctrl+Shift+Esc.
- S2. Copy a URL on the phone, paste it into a remote browser.
- S3. Unfold a foldable mid-session; the session re-lays out without reconnecting.
- S4. Nudge a small UI control precisely using trackpad mode.
- S5. On a tablet with a hardware keyboard and mouse, use the session like a desktop.

## 6. Functional requirements

Priority: **P1** = first public release, **P2** = fast follow, **P3** = later.
Every requirement has an acceptance criterion (AC) that a tester can check.

### 6.1 Servers and authentication

| ID | Pri | Requirement | AC |
|---|---|---|---|
| SRV-1 | P1 | Add, edit, delete, reorder multiple server profiles (name, base URL, username, optional saved password). | Two servers saved; each logs in independently. |
| SRV-2 | P1 | URL entry tolerates missing scheme and missing/trailing `/guacamole/` path, and reports a clear error for unreachable host, TLS failure, and "not a Guacamole server". | Each failure shows a distinct, human-readable message. |
| SRV-3 | P1 | Credentials stored only in the iOS Keychain / Android Keystore-backed storage. | Nothing sensitive in plain app storage or backups. |
| SRV-4 | P1 | Username/password login; session token reused until it expires, then silent re-login if a password is saved. A token is only treated as expired when the server refuses it (401/403), so servers before 1.6.0 (no `HEAD api/session`) keep their sign-in. Optional "Sign out of servers after the app is in the background for" 1 min / 5 min / 15 min / 1 h / Never (default Never): when due, every server sign-in ends and the next one asks for the password even if one is saved. | Kill and reopen the app within token lifetime: no login prompt. Background past the grace period on a 1.5.x server without a saved password, Reconnect: no login prompt. |
| SRV-5 | P1 | Handle the server's "additional credentials required" response generically (this is how TOTP is requested): render the requested fields and resubmit. | Login to a TOTP-enabled server succeeds by typing the code. |
| SRV-6 | P2 | Optional biometric/device-credential gate before saved credentials are used. | With the gate on, a session cannot start without Face ID / fingerprint. |
| SRV-7 | P2 | SSO (SAML/OIDC/CAS) by completing the login in an in-app browser and capturing the resulting session token. | Login succeeds against an OIDC-configured test server. |
| SRV-8 | P2 | Per-server trust of a self-signed certificate after showing its fingerprint. Never a global "ignore TLS errors". | Untrusted cert prompts once; a changed cert prompts again. |
| SRV-9 | P3 | Stored TOTP seed with auto-fill (off by default; storing the seed beside the password weakens 2FA and the UI must say so). | — |
| SRV-10 | P2 | Export/import server profiles as JSON, without passwords. | Round trip restores profiles. |

### 6.2 Connection browser

| ID | Pri | Requirement | AC |
|---|---|---|---|
| CON-1 | P1 | Show the connection tree across all of the user's data sources, with nested groups, protocol icon, and active-use indicator. | Matches what the web client home screen lists. |
| CON-2 | P1 | Search by name; pull to refresh. | — |
| CON-3 | P1 | Recents and favourites, per server, stored locally. | — |
| CON-4 | P2 | Thumbnail of the last session frame on recents (stored locally, can be disabled). | — |
| CON-5 | P2 | Deep link / home-screen shortcut straight to a connection. | — |
| CON-6 | P3 | Balancing groups and sharing-profile links. | — |

### 6.3 Session display

| ID | Pri | Requirement | AC |
|---|---|---|---|
| DSP-1 | P1 | View modes selectable in-session and remembered per connection: **Fit screen** (whole remote desktop visible), **Fit width**, **Fit height**, **1:1**. | Each mode produces the expected framing in portrait and landscape. |
| DSP-2 | P1 | Pinch zoom and pan from any mode, with bounds, momentum, and double-tap-with-two-fingers (or toolbar button) to return to the selected mode. | Zoom holds 60 fps on a mid-range phone at 1080p remote. |
| DSP-3 | P1 | Rotation, split-screen, and fold/unfold re-lay out the view without reconnecting. The layout follows the current window, not the device: a window whose short side is at most 540 CSS px (a phone, a foldable's cover screen, a half-width Split View) gets the phone layout (side toolbar and key column in landscape); larger windows (a foldable's inner screen, tablets) get the tablet layout. This is re-evaluated on every resize, also while the soft keyboard is up when the width changes (a fold or rotation). | S3 passes. |
| DSP-4 | P1 | "Match device" option: ask the server to resize the remote desktop to the device viewport where the protocol supports it (RDP with display-update; SSH/terminal always). Off by default for VNC. | With the option on, an RDP session fills the screen with no letterboxing after rotation. |
| DSP-5 | P1 | Viewport follows the pointer in trackpad mode when zoomed in, and keeps the pointer/focus area visible above the soft keyboard. | Typing into a field near the bottom of the remote screen stays visible. |
| DSP-6 | P1 | Remote cursor is always drawn (server cursor image when sent, fallback arrow otherwise). | Cursor visible in trackpad mode on RDP and VNC. |
| DSP-7 | P1 | Safe-area, notch, and gesture-bar aware; optional immersive full screen; keep-screen-awake during a session. | — |
| DSP-8 | P2 | Foldable tabletop posture: display on the upper half, trackpad surface and key bar on the lower half. Only a horizontal hinge reported by the system (viewport segments, or the device posture where the hinge direction is unambiguous) turns it on in "Auto"; a book fold (vertical hinge, e.g. iPhone Duo or a Galaxy Fold held like a book) keeps the desktop whole. Where the hinge is a gap, the desktop ends above it. | — |
| DSP-9 | P2 | Clear connection-state UI: connecting, reconnecting with backoff after network loss, error with reason, disconnect. | Toggle airplane mode for 5 s: session resumes on its own. |

### 6.4 Pointer input

The app owns the gesture layer. It does not rely on the library's default touch handlers,
because the modes below need behaviours those do not offer.

| ID | Pri | Requirement | AC |
|---|---|---|---|
| PTR-1 | P1 | **Direct touch mode**: tap = left click at that point; double tap = double click; long press = right click; long press then move = left drag; two-finger drag = scroll; pinch = zoom. | — |
| PTR-2 | P1 | **Trackpad mode**: the whole screen is a relative trackpad. One-finger move = move pointer; tap = left click; two-finger tap = right click; three-finger tap = middle click; two-finger drag = scroll; double-tap-and-hold then move = drag; pinch = zoom. Pointer speed and acceleration adjustable. | S4 passes. |
| PTR-3 | P1 | One-tap toggle between the two modes from the session toolbar; mode remembered per connection. | — |
| PTR-4 | P1 | Haptic tick on click, right click, and drag start (can be disabled). | — |
| PTR-5 | P2 | Hardware mouse / trackpad / stylus: hover moves the pointer, buttons and wheel map 1:1, pointer capture where the OS allows. | S5 passes. |
| PTR-6 | P2 | **Native touch pass-through** mode for RDP connections with touch enabled (multi-touch events sent to the remote instead of mouse emulation). | Pinch zooms a remote Windows photo viewer. |
| PTR-7 | P2 | Configurable scroll direction, two-finger-drag behaviour (scroll vs pan), and long-press duration. | — |

### 6.5 Keyboard and text input

| ID | Pri | Requirement | AC |
|---|---|---|---|
| KEY-1 | P1 | A keyboard button raises the device soft keyboard at any time, regardless of what is focused on the remote. | Works on iOS and Android, in both pointer modes. |
| KEY-2 | P1 | Typed text reaches the remote correctly including backspace, enter, emoji-free Unicode, and IME composition (e.g. Japanese, swipe typing). Autocorrect and autocapitalise are off by default; Settings › Keyboard & keys › Typing has "Autocorrect" and "Capitalise sentences" (per connection) to turn them on, and then corrections reach the remote as Backspaces and retyped text. | Type a mixed-case password, a URL, and a composed CJK string without errors. |
| KEY-3 | P1 | **Extra key bar** above the keyboard: Esc, Tab, Ctrl, Alt, Shift, Super/Win, arrows, Home, End, PgUp, PgDn, Del, and an F-key row. Modifiers are sticky: tap = next key only, double tap = locked. | Ctrl (sticky) + C from the soft keyboard copies on the remote. |
| KEY-4 | P1 | Key-combo menu with presets (Ctrl+Alt+Del, Alt+Tab, Alt+F4, Win, Win+D, Ctrl+Shift+Esc, PrtSc) and user-defined combos, reorderable. | A saved custom combo fires correctly. |
| KEY-5 | P1 | The key bar is usable with the soft keyboard hidden (docked at the bottom, collapsible). On phones in landscape it is a vertical column at a side by default (setting "Extra keys in landscape": Free side, Bottom row, Left side, Right side), in space reserved like a side toolbar's so the desktop is fitted beside it and nothing is pushed up; it ends above the keyboard and scrolls. Free side = opposite a side-docked toolbar, else the side away from the camera cutout. Keys never sit under the cutout. One fixed-width column (Fn inserts the F keys after the Fn key); the pinned buttons are at the bottom; the dismiss swipe goes towards the screen edge; the sideways set swipe is off there. Portrait, tablets and the split layout keep the row. | iPhone landscape, keyboard up: the desktop keeps its vertical position (not pushed up) and the keys sit in the side column, clear of the Dynamic Island. |
| KEY-6 | P2 | Hardware keyboard: all keys and modifier chords pass through, including those the OS does not reserve. | S5 passes. |
| KEY-7 | P2 | User-editable key bar layout. | — |

### 6.6 Clipboard

| ID | Pri | Requirement | AC |
|---|---|---|---|
| CLP-1 | P1 | **Phone → remote**: a Send button ("Send clipboard" in More; called Paste before 1.1.0) sends the device clipboard to the remote clipboard, then, with "Send also pastes" (on by default, per connection), presses the remote's paste shortcut (Ctrl+V; Ctrl+Shift+V in terminals). Optional automatic send when a session comes to the foreground; automatic sends never paste. | S2 passes on iOS and Android. |
| CLP-2 | P1 | **Remote → phone**: text copied on the remote lands on the device clipboard (can be disabled per server). | — |
| CLP-3 | P1 | "Type clipboard" fallback that sends the clipboard as keystrokes, for connections where the server has clipboard disabled. | Works on a connection with `disable-paste` set. |
| CLP-4 | P1 | iOS paste-permission prompts are kept to a minimum: read the clipboard only on an explicit user action unless auto-send is enabled. | No unexpected "Allow Paste" prompt. |
| CLP-5 | P2 | In-session clipboard panel to view/edit the text before sending. | — |

### 6.7 Later features

| ID | Pri | Requirement |
|---|---|---|
| AUD-1 | P2 | Remote audio playback, with a mute toggle; respects the silent switch and audio focus. |
| FIL-1 | P2 | File browser for filesystems a session exposes (SFTP, RDP drive): upload from and download to the OS file picker / share sheet. |
| MUL-1 | P2 | Several sessions open at once with a switcher; sessions survive brief backgrounding. |
| SET-1 | P1 | Settings: defaults for view mode, pointer mode, pointer speed, haptics, clipboard sync, keep-awake, theme (system/light/dark). Organised as a short list of categories (General & about, Display, Toolbar & layout, Pointer & touch, Gestures, Keyboard & keys, Sessions, Connections, Security & privacy, Backup & restore), each a sub-page of small groups with rarely used items under a collapsed Advanced and destructive actions last; one search across every setting (label, hint, option labels, in the active language) opens the setting on its page. |
| SET-2 | P1 | Settings per connection. Session settings are layered built-in ← app defaults (Settings) ← server defaults ← connection; whatever is changed in a session is stored for that connection. Settings › Connections lists every connection known on this device (stored settings, recents, favourites; local data only, so signed-out servers are listed too), grouped by server, each with a one-line summary of what differs ("Trackpad · 1:1 pixels · 3 changes" / "Uses the defaults"; an unknown name falls back to "Connection <id>"). Tapping one opens the same category pages as the defaults, session settings only, each control showing the effective value marked "This connection" (with "Default: …" and "Use default") or "Uses the default", plus "Use the defaults for this page" and "Reset all for this connection" (confirmed). The same editor opens from the connection details sheet ("Settings for this connection"), the session's More sheet ("All settings for this connection"; the session stays open and Back returns to it) and, as "Defaults for this server", from the server's options. Changes reach an open session of that connection at once. Every defaults page says how many connections have their own values there (linking to the filtered list); Pointer mode lists the connections that override it; search results name the connections that set a setting themselves. The first pointer mode change in a session shows once "Saved for this connection. Other connections keep their own setting." The built-in default pointer mode stays Direct touch. |
| I18N-1 | P2 | All strings externalised; English at launch; community translations accepted. |
| A11Y-1 | P1 | App chrome (everything except the remote canvas) works with VoiceOver/TalkBack, dynamic type, and sufficient contrast. |
| DIAG-1 | P2 | Local-only diagnostics screen and shareable log with secrets redacted. |

### 6.8 Additions (2026-11)

Proposed in `docs/FEATURES.md` §5 and accepted here because they are built (code and unit
tests; **not yet tested on a device or a real server**) or planned. Status as of 2026-11-19.

| ID | Pri | Requirement | AC | Status |
|---|---|---|---|---|
| SRV-11 | P1 | Handle the `required` instruction: prompt for the requested parameters (username, password, domain) and send them on `argv` streams. | An RDP connection with no stored credentials connects after the user types them in the prompt. | Built. Answers are remembered per server profile + connection (address, data source, type, identifier) + requested names, by Settings › Security & privacy › "Remember connection passwords": Never / 5 min / 15 min / 1 hour (from the last use) / Until closed / On this device (default). All but the last keep them in memory only; "On this device" uses the secure store (`secretKeys.connectionPasswords`, behind the app lock / credential gate) and is deleted with the profile's other secrets. The prompt has a "Remember for this connection" box (hidden for Never). Typed values are kept only once the session connects; a remembered answer is used at most once per attempt and forgotten when the server asks again, when guacd reports CLIENT_UNAUTHORIZED / CLIENT_FORBIDDEN, or when the attempt ends before the desktop without a network drop. Never logged, never in backups. Device check: "Ask for Face ID / fingerprint before filling a remembered password" (`rememberConnectionUnlock`: `auto` (default) = on for "On this device", off for the memory choices; `on` / `off` = for every choice; the label names the device's method, else "biometrics or the device passcode"). When on, `LockService.confirmPresence` runs in the recall path before a value is returned or sent, only when one is remembered, with a prompt naming the connection; for "On this device" it comes before the app-lock gate, which it satisfies (one prompt). It waits for the app lock and the foreground; one prompt is shared by concurrent sessions; grace: any successful device check (this one, the app lock, saved credentials) within 30 s, with no move to the background since, counts; after a cancel or failure, further checks for 10 s return no without a prompt. Cancel / failure shows the normal password prompt and keeps the value. No biometrics or passcode (or the web build): no check, toggle disabled with a hint. Turning it off needs a successful check. It is an app-level gate (like the app lock), not Keychain / Keystore access control. Kept from this device on a backup restore. Unit-tested; not yet run on a device |
| FIL-2 | P2 | RDP print jobs (`enable-printing`) arrive as a PDF and open in the OS share sheet / print dialog. | Printing a test page from Notepad offers the PDF on the phone. | Built |
| MUL-2 | P3 | Open a Guacamole share link (sharing profile) and join the shared session, as a separate, memory-only session that does not replace a saved server's own sign-in. | Opening a share link from the web client joins the session in the app; the saved server is still signed in as its own user afterwards. | Built |
| AUD-2 | P3 | RDP microphone input when the connection has `enable-audio-input`; permission requested on first use; mic indicator and toggle in the toolbar. | Speech recorded in a remote Windows app is audible on playback. | Planned |
| CON-7 | P2 | Show a "waking the computer" state with a longer connect timeout for connections that use Wake-on-LAN. | A sleeping PC with WoL configured connects without a timeout error. | Planned |
| KEY-8 | P2 | Swipe on the key bar (or hold Space and slide) to send arrow keys. | Caret moves by one character per step in Notepad. | Planned |
| A11Y-2 | P2 | VoiceOver/TalkBack pass of every screen recorded in a device checklist before each release. | Checklist completed with no blocking issue. | Planned |
| ADM-1 | P2 | For accounts with the permissions (system ADMINISTER, CREATE_CONNECTION or CREATE_CONNECTION_GROUP, or UPDATE/DELETE on the object, per data source), create, edit, clone, move and delete connections on the server from the connection browser. Updates send the complete object, parameters included. | A test connection created in the app appears in the web client with the same parameters; an edit, a clone, a move and a delete are reflected there. | Built (fake server only) |
| ADM-2 | P2 | The connection editor is generated from the server's schema (`schema/protocols`, connection attributes): one section per form, the right control per field type, search, set-versus-default indication, an "Advanced" key/value list for unlisted parameters, required-field checks and an unsaved-changes guard. | Every RDP parameter the web client shows can be set in the app; a missing name or hostname is caught before saving. | Built (fake server only) |
| ADM-3 | P2 | Create, edit, move and delete folders (organisational or balancing) with their attributes. A folder cannot be moved into itself or a descendant, and the delete confirmation says its contents are deleted too. | A folder created in the app holds a moved connection; deleting it removes both. | Built (fake server only) |
| ADM-4 | P2 | RDP and VNC "Performance & quality" presets (Best quality, Balanced, Low bandwidth) that set only existing 1.6.0 parameters and list the exact changes before applying. | After applying Low bandwidth and reconnecting, the session has a lower colour depth and no wallpaper. | Built (fake server only) |
| ADM-5 | P2 | Management UI only where permitted. A permission-denied answer while the session is still valid hides it for that data source and explains why, without signing the user out. Parameter values are never logged or stored on the device. | A read-only account sees no management actions; an account whose rights were revoked sees the explanation. | Built (fake server only) |
| ADM-6 | P3 | Connection details show active sessions (with Disconnect where permitted) and recent history. | Disconnecting a session from the app ends it in the web client's session list. | Built (fake server only) |
| KEY-9 | P2 | Named key sets for the extra key bar: built-in read-only templates (General, Windows, Terminal / Linux, macOS remote, Editing / navigation, Function keys) and user sets (create, rename, duplicate, reorder, delete, edit rows); a key is a named key, sticky modifier, literal text or a combo (inline or saved). One-tap set switcher on the key bar (long press: list), optional toolbar action and opt-in sideways swipe. Active set remembered per connection, with an app default and per-protocol defaults. Saved combos are ordered steps (chords) with optional pauses, edited in a typed form or a tap-to-build editor. Key sets and combos import/export as JSON and are in the app backup; old text combos and per-connection layouts keep working. | A Terminal set duplicated and edited in Settings appears in an SSH session; a two-step combo with a pause runs in order. | Built (demo/harness only) |
| FIL-4 | P2 | Consent for files the remote pushes (including RDP print jobs, labelled as such): Ask each time (default) / Always accept / Always decline, per connection with an app default. Nothing is acknowledged before the answer; Decline sends an error ack (CLIENT_FORBIDDEN) so the server stops. | Declining a pushed file stops the transfer on the server; accepting downloads it. | Built (harness only) |
| SRV-12 | P3 | Scheduled automatic backups (off by default): daily / weekly / monthly, written to app-private storage with a rolling retention (default 5), run when the app is opened or resumed after they are due; last/next time, Back up now, and stored backups with share / restore / delete. Secrets only with a backup passphrase kept in the secure store. | With weekly backups on, opening the app 8 days after the last one writes a new file and keeps at most 5. | Built (web only) |
| SRV-13 | P2 | "Sign out of all servers" (Settings › Security & privacy) with a confirmation listing what is removed (saved passwords, tokens, TOTP seeds) and that server entries are kept unless "Remove servers too" is ticked; best-effort server-side sign-out; open sessions are closed. | After confirming, no server has a saved password or token, and each server's session list no longer shows the app's session. | Built (fake server only) |
| MUL-3 | P2 | Android: optional "Keep sessions connected in the background" (off by default) holds a foreground service (`specialUse`) with a notification ("N remote sessions connected", Disconnect all) while a session is open; the grace-period disconnect does not apply while it runs. iOS keeps the grace period, except while the experimental Picture in Picture window is open (MUL-6). | With the setting on, a session survives 10 minutes with the screen off and is still connected on return. | Built – untested on device |
| MUL-4 | P2 | Settings › Sessions › "When a connection is already open" (`openAgain`): Ask (default) / Go to the open session / Open another. Applies when a connection (same server profile, type, data source, identifier) already has a session in the app and is tapped in the connection list, a favourite or recent, "Jump back in", or an app link. Ask: "<name> is already open" with Go to the open session (primary), Open another, Cancel and "Don't ask again" (stores the answer; Cancel stores nothing). Going to it shows the most recently shown of its sessions, as the switcher does; a session disconnected in the background reconnects at once (re-validating the sign-in), one whose sign-in failed shows "Sign in again". Open another still respects the open-session cap. Admin Join and share links always go to the open session; the Demo follows the setting. Connections with a session open show an "Open" badge (in the list and "Jump back in"). | With Ask, tapping an open connection offers the open session; with "Don't ask again" ticked on Go to, the next tap goes straight to it. | Built (unit-tested; not yet run on a device) |
| MUL-5 | P2 | Settings › Sessions › "Ask before connecting" (`askInUse`): When in use (default) / Always / Never. About sessions the **server** reports (MUL-4 is about sessions open in the app). Before a new session of a connection, the app asks the server within 2 s (`GET connections/{id}`, `GET activeConnections`, `GET self/effectivePermissions`; protocol-notes §8.5); no answer or an error = connect. When sessions other than the app's own live ones are reported: "<name> is already in use", "The server reports N active session(s) on this connection.", who and since when where the server says ("You, since 14:02", another user's name, or "Another user"), and: **Open the existing one** (primary; a session of it open in the app → go to it; otherwise the newest session the server marks `connectable`, the user's own first (an administrator may also get another user's) → join it with `GUAC_TYPE=a`; a joined own session then counts as the connection's open one, another user's is named "<name> (<user>)" like admin Join), **End it and start fresh** ("End all N …" when several; only with DELETE on every one of the user's own sessions on it, or for an administrator with none of their own; never while one is open in the app; ends exactly those, all listed in the dialog, then connects; a refusal shows inline and changes nothing), **Open another**, Cancel, and "Don't ask again" (stores Never with an explicit answer only). Whenever "Open the existing one" is not offered: "This account cannot join running sessions; an administrator account can." Always + not in use: "Connect to <name>?". The check (up to 2 s) shows no progress indicator; a second tap meanwhile is ignored. One question per tap: open in the app + Go to → silent; + Ask → only the MUL-4 question; at the session cap → only the cap question; a confirmed app link → no further question. Never for the Demo, share links, joining (admin Join, Open the existing one) or reconnecting; balancing groups only get the Always confirm. "In use" badge (count from 2; label "N active session(s) on the server", the app's own live sessions subtracted) in the connection list and on "Jump back in" (only servers signed in at the moment), refreshed on pull-to-refresh and when returning from a session. | With an own session left running on the server, tapping the connection offers to open it, and "Open the existing one" joins it instead of starting a second one. | Built (unit-tested; fake server only; not yet run against a real server or on a device) |
| MUL-6 | P3 | Experimental, iOS only, off by default, per connection: Settings › Sessions › In the background › "Picture in picture (experimental)". With it on, leaving the app with a connected session, or More › "Open picture in picture", shows the remote screen in the system's floating window (up to 12 frames a second, view only). The iOS build declares the `audio` background mode, which the window needs. While the window is up the session keeps running in the background; the background disconnect and "Sign out of servers after" timers wait until it closes. The app lock is never held off: when it falls due, the window closes. | With the setting on, leave the app during a session for 2 minutes with the window open: the session is still connected on return. With the app lock due after 1 minute, the window closes by then. | Built – opening and staying live seen on the owner's iPhone; the timer and lock behaviour not yet checked on a device |

Notes on earlier rows (the rows themselves are unchanged):

- SRV-4: silent re-login also runs when a live session's tunnel refuses an expired token
  (not only before reconnecting a suspended session).
- SRV-8: until per-server fingerprint trust exists, a private CA installed on the device is
  trusted (Android: user CAs in the network security config; iOS: enabled profile).
- SRV-10: the backup may also carry passwords and TOTP seeds (opt-in), but only inside a passphrase-encrypted
  export; a plain export has none.
- CON-6: share links are covered by MUL-2.
- I18N-1: Spanish ships alongside English, session screen included.
- §4 non-goal "Server administration ... in v1": connection and folder management was approved
  on 2026-11-20 and is ADM-1…ADM-6 above. Users, groups and permissions remain out of scope.

## 7. Non-functional requirements

- **Performance.** Input-to-send latency under 16 ms on device; display at the server's frame
  rate without dropped frames at 1080p on a mid-range 2022 phone; cold start to server list
  under 2 s.
- **Compatibility.** Guacamole server 1.5.x and 1.6.x (developed against 1.6.0). iOS 16+ and
  Android 8.0 (API 26)+; final floors set in Phase 0 from what the toolchain supports.
- **Privacy.** No network request to any host other than user-added servers. No analytics or
  crash SDKs. Stated in a public privacy policy.
- **Security.** Secrets only in OS secure storage; TLS validation on by default; tokens never
  logged; the session view is excluded from the app-switcher snapshot when the biometric gate
  is on. Exception: the experimental Picture in Picture window (MUL-6) shows the remote
  screen outside the app until the lock falls due, when it closes.
- **Battery/data.** Tunnel closed when the app is backgrounded beyond a grace period
  (default 60 s, configurable), with clean resume; not while Android keeps sessions connected
  (MUL-3) or the iOS Picture in Picture window is open (MUL-6).

## 8. Architecture

### 8.1 Decision (provisional, gated by Phase 0)

**A Capacitor app: TypeScript + React UI, with the official Guacamole JavaScript client
library (`guacamole-common-js`, Apache-2.0) doing protocol, rendering, audio, and streams
inside the system WebView, and thin native plugins for what the web platform cannot do.**

Why this over a fully native client:

- The owner's complaints are about input and app chrome, not rendering. The official library
  already renders the protocol correctly and is what every browser session uses.
- It is the only option whose core can be developed and verified on the Windows dev PC, in a
  desktop browser, by an automated agent. A native-rendering client (Flutter/Kotlin
  Multiplatform with a re-implemented protocol) would need device or emulator verification
  for nearly every task, and iOS could not be verified at all without a Mac.
- Re-implementing the drawing protocol, audio, and stream handling is months of work with a
  long tail of rendering bugs.

Cost accepted: rendering runs in a WebView, and soft-keyboard/IME handling must be engineered
carefully (§8.4).

Alternatives kept open:

- **Native WebSocket/HTTP bridge** if the WebView cannot reach the server directly (§8.3).
- **Native rendering core later**, swapped in behind the `SessionTransport` and
  `RemoteDisplay` interfaces, if profiling shows the WebView is the bottleneck.

**Phase 0 is a spike with pass/fail criteria (PLAN §Phase 0). If it fails on a point with
no workaround, this decision is revisited before any Phase 1 work.**

### 8.2 Components

```
┌──────────────────────── App shell (Capacitor) ────────────────────────┐
│  React UI: servers · connection browser · settings · session chrome   │
│                                                                        │
│  session/                                                              │
│    GestureLayer ──► PointerModel (direct | trackpad | passthrough)     │
│    TextInputBridge + KeyBar ──► KeyModel (keysyms, sticky modifiers)   │
│    Viewport (fit modes, zoom/pan, follow-pointer, keyboard inset)      │
│    ClipboardBridge                                                     │
│    RemoteDisplay ◄── guacamole-common-js Client/Display (vendored)     │
│                                                                        │
│  core/                                                                 │
│    GuacApi (REST)  ──► HttpClient      [native HTTP | fetch (dev)]     │
│    SessionTransport ─► Tunnel          [WebSocket | native bridge]     │
│    SecureStore, Settings, Profiles                                     │
│                                                                        │
│  Native plugins: HTTP, secure storage, biometrics, clipboard, haptics, │
│  keyboard insets, keep-awake, file picker/share, foldable posture      │
└────────────────────────────────────────────────────────────────────────┘
```

Rules:

- `PointerModel`, `KeyModel`, and `Viewport` are pure TypeScript with no DOM or Capacitor
  imports, so they are unit-testable. They are where most of the product's value lives.
- All network access goes through `HttpClient` and `SessionTransport`. Nothing else calls
  `fetch` or opens a socket.
- `guacamole-common-js` is **vendored from the upstream `apache/guacamole-client` repo at the
  1.6.0 tag** (`guacamole-common-js/src/main/webapp/modules/*.js`), with its licence and
  NOTICE. The package of that name on npm is a third-party repackaging at 1.5.0 and is not
  used.

### 8.3 Network path (the main technical risk)

| Concern | Expected handling | Verified in |
|---|---|---|
| REST calls from the app origin are cross-origin and Guacamole sends no CORS headers. | Route REST through Capacitor's native HTTP so CORS does not apply. In browser dev mode, use a Vite dev proxy. | T0.6, G0 |
| WebSocket from the WebView to `ws://` on a tailnet IP or MagicDNS name. | Android: allow cleartext and mixed content for the WebView. iOS: App Transport Security exception with a written justification for review. | T0.4, T0.6 |
| Self-signed HTTPS. | WebView sockets cannot be told to trust one server's certificate, so per-server trust (SRV-8) needs the native tunnel bridge. A CA the user installs on the device is trusted (Android: `<certificates src="user"/>` in the network security config; iOS: enabled profile); see docs/tls.md. | Phase 2 (bridge); user CA untested on device |
| Server rejects the WebSocket origin (reverse proxies sometimes do). | Fall back to the native tunnel bridge, or to the HTTP tunnel. | T0.4 |

The server interface is not a documented public API. Endpoints and parameters must be read
from the 1.6.0 source, not assumed. Reference files in `apache/guacamole-client`:

- REST client usage: `guacamole/src/main/frontend/src/app/rest/services/*.js`
  (`tunnelService.js`, `connectionGroupService.js`, `requestService.js`), and the auth
  service under `frontend/src/app/auth/`.
- REST server side: `guacamole/src/main/java/org/apache/guacamole/rest/**`.
- Tunnel: `guacamole-common-js/.../modules/Tunnel.js` and the web client's
  `guacClientManager` / `ManagedClient` for the connect parameters.

### 8.4 Text input

A focused, visually hidden text field owned by `TextInputBridge` is what raises the soft
keyboard. It holds sentinel content so that backspace always produces an event, listens to
`beforeinput`/`input`/composition events, converts the result to key events or committed
text, and resets itself. Hardware keys are handled separately through key events on the
document. The library's `Keyboard.js` and `OnScreenKeyboard.js` and the web client's "text
input" mode are prior art to read before implementing. iOS behaviour here can only be
confirmed on a real device.

### 8.5 Pointer and viewport

`GestureLayer` consumes Pointer Events on an overlay above the display and feeds a small
gesture recogniser. `PointerModel` turns recognised gestures into remote mouse state
(position, buttons, wheel) according to the active mode. `Viewport` owns the transform
between remote and screen coordinates. Zoom is applied as a compositor transform on the
display element, not by re-scaling the canvas each frame. The library's `Mouse.js` and
`Touch.js` are read for the wire format and as reference only.

### 8.6 Repository layout

```
/app            Capacitor + Vite + React + TypeScript app
  /src/core     api, transport, storage, models (no UI)
  /src/session  gesture, pointer, key, viewport, display, clipboard
  /src/ui       screens and components
  /src/vendor/guacamole-common-js   vendored upstream + LICENSE/NOTICE
  /android /ios native projects (generated, committed)
/docs           SPEC.md, PLAN.md, privacy policy, store listing text
/.github        CI workflows, issue templates
```

## 9. Testing strategy

- **Unit** (Vitest): `PointerModel`, `KeyModel`, `Viewport`, gesture recogniser, API parsing.
  These must cover every row of §6.3–6.6 that can be expressed as input → output.
- **Replay tests**: a fake `SessionTransport` that plays a captured instruction stream, so
  display and session code run in CI with no server.
- **Browser integration**: the app in a desktop browser with touch emulation against a real
  server through the dev proxy.
- **Device checklists**: `docs/checklists/*.md`, run by the owner on real hardware for
  everything that cannot be automated — above all iOS keyboard, paste, and foldables.

## 10. Distribution

### 10.1 Builds

GitHub Actions builds Android (AAB + APK) on Linux and iOS (IPA) on macOS runners, signs
with secrets, and uploads to Play internal testing and TestFlight. Tagged releases also
attach the APK to a GitHub Release.

### 10.2 Store requirements to confirm at submission time

Rules change; each is a checklist item in PLAN Phase 3, to be verified against the current
official pages rather than this document.

- Apple Developer Program membership (annual fee) and Google Play Console registration
  (one-time fee).
- Google Play's closed-testing requirement for new personal developer accounts (a minimum
  number of opted-in testers for a minimum number of days before production access).
- Apple export-compliance declaration (the app uses only standard TLS).
- Privacy policy URL and the stores' data-safety / privacy-label forms ("no data collected").
- ATS exception justification for cleartext connections to user-specified private hosts.
- ASF trademark guidance for naming and the "not affiliated" disclaimer.

### 10.3 Store review access

Reviewers cannot reach a tailnet. The app needs one of:

- **Demo mode** (built): a built-in "Demo server" entry backed by a simulated desktop that
  runs inside the app and speaks the real protocol (`app/src/demo`). It reacts to clicks,
  drags, scrolling, typing, key combos, and clipboard in both directions, so a reviewer can
  exercise every session control offline.
- **Public demo server**: a small hosted Guacamole with a throwaway desktop and review
  credentials, mentioned in the review notes. More convincing, but it is infrastructure to
  run and secure.

## 11. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| WebView cannot reach the server reliably (§8.3). | Medium | Phase 0 gate; native bridge fallback behind interfaces. |
| iOS soft keyboard / IME quirks. | High | Prototype in Phase 0 on a real iPhone; device checklist; budget iteration. |
| No Mac: slow iOS feedback loop through CI and TestFlight. | Certain | Keep native iOS code minimal; verify logic in browser; batch device checks. |
| App Store rejection (ATS exception, reviewer cannot test, trademark). | Medium | Demo mode, written justifications, naming per ASF guidance. |
| Undocumented server API changes between Guacamole versions. | Low–medium | Isolate in `GuacApi`; pin and state tested versions; version check on login. |
| WebView rendering performance on low-end Android. | Low–medium | Measure in Phase 0; compositor-only zoom; native core as later option. |
