# Security policy

OpenMobileGuac is open source under GPL-3.0-or-later with an app-store permission (earlier
commits Apache-2.0; the vendored `guacamole-common-js` is Apache-2.0), so anyone can review
the code this policy covers.

## Supported versions

Only the latest release is supported: the newest App Store / TestFlight build, the newest
APK on GitHub Releases, and the `main` branch. Fixes are not back-ported to older builds.

The project is in early development and has not had a formal release yet (see
[CHANGELOG.md](CHANGELOG.md)).

## Reporting a vulnerability

Please report security problems privately, not in a public issue:

1. Go to <https://github.com/testyfishy/OpenMobileGuac/security>.
2. Click **Report a vulnerability**. This opens a private security advisory that only you
   and the maintainer can see.

If the button is not there, open a normal issue that only says you have a security report
and asks for a private channel. Do not put any details in it.

Please include what you found, the steps to reproduce it, the app version and platform, and
what an attacker could do with it. Do not include real passwords, server addresses or
screenshots of a real remote desktop; use a test server.

You will get a reply in the advisory. This is a volunteer project, so there is no fixed
response time. Once a fix is released, the advisory can be published with credit to you if
you want it.

## Scope

In scope:

- The app code in this repository (`app/src`, the native projects in `app/android` and
  `app/ios`, and the local plugin `app/plugins/omg-pinned-tls`).
- How the app stores secrets, handles TLS and certificates, restores backups, opens deep
  links and share links, and handles data from a Guacamole server.
- The build and release workflows in `.github/workflows`.

Out of scope (please report these upstream instead):

- Apache Guacamole itself (server, guacd, the web client). See
  <https://guacamole.apache.org/security/>.
- The vendored `guacamole-common-js` library in `app/src/vendor`, unless the problem is in
  how this app uses it.
- Capacitor and third-party plugins, unless the problem is in how this app uses them.
- Problems that need a rooted or jailbroken device, or physical access to an unlocked phone.
- Traffic sent over plain `http://` being readable on the network. The app warns about this;
  it is the expected result of choosing `http://`.

## Security model in short

- **Where secrets live.** Saved passwords, sign-in tokens, the optional TOTP secret,
  remembered connection passwords and the backup passphrase are kept in the iOS Keychain
  (this device only, no iCloud sync) or in storage encrypted with a key in the Android
  Keystore. Server profiles, settings, recents and thumbnails are not secrets and are kept in
  ordinary app storage. Android system backup and device transfer are turned off for the
  app's data.
- **Backups.** A backup holds no secrets by default. If the user sets a passphrase,
  passwords and TOTP secrets are encrypted with PBKDF2-SHA256 (310,000 iterations) and
  AES-256-GCM through WebCrypto. Sign-in tokens are never exported.
- **App lock.** An optional Face ID / Touch ID / fingerprint or device-passcode lock. When
  it is on, saved secrets are used only after unlocking, and the app switcher shows a privacy
  screen instead of the app's content.
- **TLS.** HTTPS uses the operating system's trust store, including CAs the user installed.
  For self-signed servers, the user can trust one certificate for one server after
  comparing its SHA-256 fingerprint. That pin applies only to that scheme, host and port, and
  a changed certificate is blocked until the user trusts it again. The app never offers to
  ignore certificate errors. Details: [docs/tls.md](docs/tls.md).
- **Plain http.** Allowed, because many self-hosted servers on private networks use it. The
  app does not fall back from https to http by itself, and it warns before sending a password
  over http.
- **Network.** The app talks only to the servers the user adds (and to single sign-on pages
  those servers send it to). It has no analytics or crash-reporting SDKs.

Known weaknesses and their status are listed in the audit: [docs/AUDIT.md](docs/AUDIT.md),
in particular "3. Security and privacy" and "6. Resolution". Much of the native code (secure
storage, app lock, pinned TLS) has been compiled in CI but has not been checked on a device
against the checklists in [docs/checklists/](docs/checklists/README.md).
