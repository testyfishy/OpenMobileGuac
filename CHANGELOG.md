# Changelog

All notable changes to Open Mobile Guac (OMG) are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project intends to use
[Semantic Versioning](https://semver.org/).

How far the releases have been tested: they are unit-tested, CI builds both apps, and the
maintainer uses the iOS app daily through TestFlight against a real Guacamole server (VNC).
The device checklists in docs/checklists have not been completed, and the Android app has
not been run on a device yet. See "Untested on device" in [docs/FEATURES.md](docs/FEATURES.md).

## [Unreleased]

## [1.1.0] - 2026-11-21

### Added

- Settings › Keyboard & keys › Typing: "Autocorrect" and "Capitalise sentences" (both off by
  default, and settable per connection). With either on, the keyboard app keeps the sentence
  being typed, so it can correct words, turn a double space into a full stop and capitalise
  sentences; corrections reach the remote as Backspaces and retyped text. A click or a key
  bar key starts a fresh sentence.
- Picture in Picture (experimental, iOS only, off by default, per connection): Settings ›
  Sessions › In the background › "Picture in picture". Leaving the app with a session open,
  or More › "Open picture in picture", shows the remote screen in the system's floating
  window, view only, updated when the remote display changes (up to 12 frames a second).
  While the window is open the session keeps running in the background, and the background
  disconnect and "Sign out of servers after" timers wait until it closes. The app lock is
  never held off: when it falls due, the window closes. The window is not covered by the
  app-switcher privacy screen. It may still freeze or close. Every iOS build now declares
  the audio background mode, which the window requires.
- Settings › Connections ("Settings per connection"): every connection known on this device,
  grouped by server, with a one-line summary of what it changes from the defaults. Each one
  opens its own settings on the same pages as the defaults, with every value marked as its
  own ("Default: Direct touch", "Use default") or inherited, and "Reset all for this
  connection". Also opened from the connection details, the session's More sheet ("All
  settings for this connection") and, as "Defaults for this server", from the server's
  options. Changes reach an open session of that connection at once.
- The defaults pages say how many connections keep their own values there; Pointer mode lists
  them, and search results show "Also set for: …".
- A one-time note after the first pointer mode change in a session: "Saved for this
  connection. Other connections keep their own setting."
- "Send also pastes" (Settings › Sessions › Clipboard, per connection, on by default): Send
  puts the device clipboard on the remote and then presses the remote's paste shortcut
  (Ctrl+V; Ctrl+Shift+V in SSH / telnet / Kubernetes terminals) about 150 ms after the
  clipboard stream has ended. Turn it off to send only. Automatic clipboard sending and
  "Type clipboard" never paste.

### Changed

- The "Paste" action is now called "Send" ("Send clipboard" in More), because it sends this
  device's clipboard to the remote.
- Builds: manual iOS workflow runs upload to TestFlight only from `main`. The Android
  workflow no longer keeps the nightly debug key in the Actions cache, where pull-request
  code could restore it; without the `ANDROID_DEBUG_KEYSTORE_BASE64` secret each nightly now
  has a new signature (docs/release.md, "Debug signing").

### Fixed

- A pinned (self-signed) server never gets a request over system trust when the trusted
  certificates cannot be read: a known pin still applies, otherwise the request fails as
  unreachable.
- A backup whose plain part dropped a certificate pin no longer restores the password or
  TOTP secret sealed with that pin.
- A foreground request's deadline now includes the time it waits for a free connection slot.
- Diagnostics: user and group names in REST paths are replaced with a marker.
- A malformed percent escape in an `otpauth://` label no longer throws.
- Android: the session WebSocket answers a Close frame with code 1000 (the server's own code
  can be one the HTTP library refuses to send).

## [1.0.1] - 2026-11-21

### Fixed

- iOS: every REST request (sign-in, connection list, "in use" checks, permissions) opened a
  new connection with a full TCP and TLS handshake since the redirect hardening in 1.0.0,
  because CapacitorHttp creates a new URLSession per request when redirects are disabled.
  REST now goes through the app's own native plugin with one long-lived session per server
  that keeps connections open and still never follows a redirect. If the native method is
  missing, the app falls back to the previous behaviour.
- Pinned (self-signed) servers reuse their connections too, on iOS.
- Fewer parallel requests: identical requests that run at the same time are sent once,
  permission and connection lookups are cached for a few seconds, badge and permission
  lookups wait behind sign-in and the connection list (at most two at a time per server),
  and the recent-connection badges are not refreshed while a session or another screen
  covers the list or the app is in the background.
- Every REST request now has a hard deadline (its timeout plus 3 s), so a request that
  trickles cannot keep a spinner up indefinitely.
- A data source that fails to load, or answers more than 4 s after the first one, no longer
  hides the connections of the others. Its connections from the previous load stay listed,
  a notice with Retry names it, and a slow one is filled in by itself when it arrives. A
  "Jump back in" tap waits for that data source instead of saying the connection is gone.
- Diagnostics: the log no longer repeats "reconnect attempt 1 of 4" when a reconnect held
  for the app lock goes out. HTTP lines show whether a connection was reused and how many
  requests were in flight; tunnel lines show the WebSocket close code and reason, the time
  since the last instruction and whether the app was in the foreground; the report starts
  with a network summary.

## [1.0.0] - 2026-11-21

First public version.

### Licence

- The project is licensed under GPL-3.0-or-later, with an additional permission that allows
  distribution through app stores (`LICENSE-APP-STORE-EXCEPTION`). Commits published before
  this change were released under Apache-2.0 and remain available under it. The vendored
  `guacamole-common-js` library stays under Apache-2.0.

### Servers and sign-in

- Several server profiles: add, edit, delete and reorder. Addresses work with or without
  `https://` and the `/guacamole/` path, with clear errors for unreachable servers, timeouts,
  certificate problems and "not a Guacamole server".
- Passwords and sign-in tokens saved in the iOS Keychain or Android Keystore-protected
  storage. Silent re-login when a token expires.
- Two-factor sign-in: TOTP codes and TOTP enrolment, an optional stored TOTP secret (off by
  default), Duo (experimental), and the server's own messages for expired passwords and
  policy errors. Forced password change at sign-in and changing your account password.
- Single sign-on (SAML, OpenID, CAS) through an in-app or system browser (experimental).
- Self-signed HTTPS: trust one server's certificate after checking its fingerprint. A changed
  certificate is blocked until you trust it again. Certificates installed on the device also
  work.
- A warning before a password is sent over plain `http://`. No automatic fallback from
  https to http.
- App lock with Face ID, Touch ID, fingerprint or the device passcode, and a privacy screen
  in the app switcher.
- Backup and restore of servers and settings, with optional passphrase-encrypted passwords.
  Scheduled automatic backups.
- Sign out of all servers in one step.

### Connections

- Connection tree with folders, search (ignores case and accents), pull to refresh,
  favourites, recents and thumbnails of the last session screen.
- App links (`openmobileguac://connect?…`) and Guacamole share links.
- A built-in Demo: a simulated desktop that runs on the device with no server, for trying
  every control.
- Connection and folder management for accounts allowed to do it: create, edit, clone,
  delete, quality presets, active sessions with Disconnect and Join.
- "In use" badges, and a question before connecting when the server reports a session already
  running on the connection: open the existing one, end it and start fresh, or open another.

### Session screen

- Fit screen, fit width, fit height, 1:1 and 100 % views; pinch zoom and pan; re-layout on
  rotation without reconnecting; remote size that follows the device.
- Direct touch, trackpad and RDP multi-touch pointer modes; hardware mouse and keyboard.
  A Gestures section in Settings with an animation and a switch for each gesture.
- Soft keyboard with an editable extra-key bar, key sets for different systems, a combo
  builder and saved combos.
- Clipboard in both directions, a clipboard history panel and "type clipboard".
- Toolbar docked at the bottom, top or side, or floating; choose and order its buttons.
- File browser with upload and download (downloads are written to storage as they arrive),
  RDP print jobs as PDF, audio with mute, and microphone input for RDP (off by default).
- Quality, resolution and scale settings; view-only mode; terminal font size and colours;
  sharing a session through the server's sharing profiles.
- Several sessions at once, a background grace period, automatic reconnect, keep-awake, and
  on Android an optional setting to keep sessions connected in the background.
- Connection prompts for servers that ask for credentials, with an option to remember them.

### App

- English and Spanish. A guide for adding languages is in `docs/TRANSLATING.md`.
- Settings for theme, language, session defaults, clipboard, haptics and more.
- A local diagnostics log (passwords removed) you can copy or share, and a connection test.
- A strict Content-Security-Policy in release builds (no inline or eval'd script); anything it
  blocks is noted in the diagnostics log.
- No analytics, ads, tracking or account.

### Builds

- CI runs typecheck, lint, format check, unit tests and a production build on pushes to `main` and on
  pull requests.
- A debug APK on the rolling `nightly` prerelease. (A signed Android release APK was
  planned, but release signing has not run yet, so none is attached to the release.)
- iOS builds uploaded to TestFlight from `main` by the public workflow.

[1.1.0]: https://github.com/testyfishy/OpenMobileGuac/releases/tag/v1.1.0
[1.0.1]: https://github.com/testyfishy/OpenMobileGuac/releases/tag/v1.0.1
[1.0.0]: https://github.com/testyfishy/OpenMobileGuac/releases/tag/v1.0.0
