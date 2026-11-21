# Changelog

All notable changes to OpenMobileGuac are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project intends to use
[Semantic Versioning](https://semver.org/).

"Untested on device" in [docs/FEATURES.md](docs/FEATURES.md) applies to most of the first
release: it has been unit-tested and used in a desktop browser, and CI builds the Android and
iOS apps, but the device checklists have not been completed yet.

## [1.0.0] - Unreleased

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
- Android debug APK on the rolling `nightly` prerelease.
- iOS builds uploaded to TestFlight from `main` by the public workflow.

[1.0.0]: https://github.com/testyfishy/OpenMobileGuac/commits/main
