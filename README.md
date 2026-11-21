# OpenMobileGuac

A free, open-source mobile client (iOS and Android) for
[Apache Guacamole](https://guacamole.apache.org/) servers that you host yourself. It aims to
make remote desktop sessions comfortable on a phone or tablet: proper touch pointer modes, a
reliable soft keyboard with a key bar and combos, clipboard in both directions, and zoom and
pan that behave well.

It is a [Capacitor](https://capacitorjs.com/) app with a TypeScript + React UI. The
official Guacamole JavaScript client library (`guacamole-common-js`, Apache-2.0) handles
the protocol and rendering inside the system WebView. See [docs/SPEC.md](docs/SPEC.md)
for the specification and [docs/PLAN.md](docs/PLAN.md) for the delivery plan.

> **Why this exists.** I respect the developer of
> [PocketGuac](https://guac.pocketsized.app/). But I use an iPhone, PocketGuac is for
> Android, and I needed a Guacamole client for iOS, so I made this one myself. All of the
> source is here if you want to build your own. If you just want to use mine, the iPhone
> and iPad app is published under my Apple developer account (App Store listing in
> preparation) and the Android APK is on the
> [Releases page](https://github.com/testyfishy/OpenMobileGuac/releases/latest). Missing a
> feature? [Open an issue](https://github.com/testyfishy/OpenMobileGuac/issues) and I will
> look at adding it.

> **Unofficial.** OpenMobileGuac is an independent project. It is not affiliated with,
> endorsed by, or sponsored by the Apache Software Foundation or the Apache Guacamole
> project. "Apache", "Apache Guacamole", and "Guacamole" are trademarks of the Apache
> Software Foundation.

## The open-source promise

- **Open source, for good.** All of the app's source code, the native projects and the
  build workflows are in this repository under the GPL-3.0-or-later (see [Licence](#licence)).
  There is no closed part.
- **Free.** No price, no paid tier, no in-app purchases, no licence key.
- **No account, no telemetry.** The app has no analytics, ads, tracking or crash-reporting
  SDK, and the developer runs no server. It connects only to the Guacamole servers you add
  (and to the single sign-on page your server sends you to, if it uses one). Details:
  [PRIVACY.md](PRIVACY.md); the network audit is in [docs/AUDIT.md](docs/AUDIT.md) §3.

## How this project is distributed

| Platform | Where | Built by |
|---|---|---|
| Source | This repository | — |
| Android | APK on [GitHub Releases](https://github.com/testyfishy/OpenMobileGuac/releases): the [latest release](https://github.com/testyfishy/OpenMobileGuac/releases/latest), and a rolling debug build on the [`nightly`](https://github.com/testyfishy/OpenMobileGuac/releases/tag/nightly) prerelease. Google Play later | [`.github/workflows/android.yml`](.github/workflows/android.yml) |
| iOS | App Store and TestFlight, under the maintainer's Apple developer account. Not yet on the App Store | [`.github/workflows/ios.yml`](.github/workflows/ios.yml), on GitHub's macOS runners, from a commit on `main` |

The iOS build is made by the public workflow, and its run log is public. The build number
in TestFlight and the App Store is the workflow run number, so each build can be traced to
a run and a commit.

There is no iOS app file on GitHub. Most iPhones can only install apps from the App Store
or TestFlight, so a file here would not help most people. Anyone with a Mac, or a fork with
GitHub Actions, can build and install their own copy from this source with their own Apple
developer account: see [docs/BUILDING.md](docs/BUILDING.md).

## Features

Full list with the status of each feature: [docs/FEATURES.md](docs/FEATURES.md).
Comparison with the Guacamole 1.6.0 web client: [docs/GUACAMOLE-PARITY.md](docs/GUACAMOLE-PARITY.md).

- Servers: several profiles, passwords and tokens in the iOS Keychain / Android Keystore,
  TOTP (optionally with a stored secret), self-signed HTTPS by trusting a certificate
  fingerprint, plain-`http` warning, silent re-login, biometric app lock, backup and
  restore, share links, deep links, SSO (experimental).
- Connections: tree with search, favourites, recents and thumbnails; connection and folder
  management for accounts that are allowed to edit them.
- Session screen: fit modes, pinch zoom, direct-touch, trackpad and RDP multi-touch modes,
  hardware mouse and keyboard, soft-keyboard bridge with key sets, an editable key bar and
  combos, clipboard both ways with a history panel, file transfer and print jobs, audio and
  microphone, a configurable toolbar, keep-awake, automatic reconnect.
- Settings per connection, with app and server defaults.
- Several sessions at once, background grace period, English and Spanish, local diagnostics.
  On iOS, an experimental Picture in Picture window (off by default).
- A built-in **Demo server** that runs entirely on the device: a simulated desktop with a
  text editor, an input tester and a zoom target, so every control can be tried without a
  server. It contains no personal data and sends nothing over the network.

## Status

**Early releases on GitHub; not yet in any app store.**

What has been checked:

- Unit tests and a production build on every push to `main` and every pull request
  (`npm run check` in CI).
- The whole UI in a desktop browser at phone sizes, against the built-in Demo server, and
  some sign-in flows against a local Guacamole 1.6.0 server (see FEATURES.md).
- CI builds the Android debug APK and an iOS Simulator build, and uploads signed iOS builds
  to TestFlight from `main` (seen passing in CI since 2026-11-20).

What has been checked by hand: the maintainer uses TestFlight builds on an iPhone against
their own Guacamole server (sign-in, VNC sessions, landscape layout, extra keys, the
remembered connection password with Face ID). No results are recorded in the checklists
yet, and nothing has been run on an Android device. Not yet checked
systematically on a device: RDP and SSH sessions, OS paste prompts, file transfer,
keep-awake, self-signed certificates, backups, and everything on Android. Testing order:
[docs/checklists/README.md](docs/checklists/README.md), then
[phase0.md](docs/checklists/phase0.md), [session-device.md](docs/checklists/session-device.md)
and [app-device.md](docs/checklists/app-device.md).

## Try it

- **Android:** install the APK from the
  [latest release](https://github.com/testyfishy/OpenMobileGuac/releases/latest), or the
  debug APK from the rolling
  [`nightly` prerelease](https://github.com/testyfishy/OpenMobileGuac/releases/tag/nightly),
  rebuilt on every push to `main`. Neither has been run on an Android device yet.
- **Any build or the browser:** open **Demo** on the server list, then **Demo desktop**. The
  two fixed-size variants (1024 × 768 and 1920 × 1080) are for trying zoom and pan.

## Documentation

- [docs/BUILDING.md](docs/BUILDING.md): build both apps from source, with your own signing.
- [docs/release.md](docs/release.md): CI, nightly APK, signing and TestFlight.
- [docs/FEATURES.md](docs/FEATURES.md): feature status and comparison with other clients.
- [docs/GUACAMOLE-PARITY.md](docs/GUACAMOLE-PARITY.md): parity with the Guacamole web client.
- [docs/AUDIT.md](docs/AUDIT.md): feature, security and privacy audit.
- [docs/tls.md](docs/tls.md): self-signed and private-CA servers.
- [docs/sso.md](docs/sso.md): single sign-on.
- [docs/SPEC.md](docs/SPEC.md) and [docs/PLAN.md](docs/PLAN.md): specification and plan.
- [docs/checklists/](docs/checklists/README.md): on-device test checklists, in testing order.
- [docs/protocol-notes.md](docs/protocol-notes.md): notes on the Guacamole protocol and web
  client.
- [docs/TRANSLATING.md](docs/TRANSLATING.md): adding a language.
- [docs/store/](docs/store/README.md): store listing drafts and the submission checklist.
- [PRIVACY.md](PRIVACY.md), [SECURITY.md](SECURITY.md), [CHANGELOG.md](CHANGELOG.md),
  [CONTRIBUTING.md](CONTRIBUTING.md).

## Repository layout

```
app/              Capacitor + Vite + React + TypeScript app
  src/core/       API, transport, storage, models (no UI)
  src/session/    pure gesture, pointer, key and viewport logic (no DOM)
  src/ui/         screens and components; ui/session/ holds the session screen and DOM glue
  src/demo/       built-in Demo server (simulated desktop behind a tunnel)
  src/vendor/     vendored third-party code (guacamole-common-js)
  android/        generated Android project (committed)
  ios/            generated iOS project (committed)
docs/             specification, plan, release notes, checklists
```

## Toolchain and platform minimums

Versions in use:

| Component  | Version |
| ---------- | ------- |
| Capacitor  | 8.6.x   |
| Vite       | 8.3.x   |
| React      | 19.3.x  |
| TypeScript | 6.0.x   |
| Vitest     | 5.1.x   |
| ESLint     | 10.x    |

TypeScript is held at 6.0 because typescript-eslint 8.73 supports TypeScript `<6.1` only.

Requirements of Capacitor 8, from the official docs
([support policy](https://capacitorjs.com/docs/main/reference/support-policy),
[environment setup](https://capacitorjs.com/docs/getting-started/environment-setup),
[updating to 8.0](https://capacitorjs.com/docs/updating/8-0); checked 2026-11-18):

| Requirement           | Capacitor 8 minimum                                     |
| --------------------- | ------------------------------------------------------- |
| Node.js               | 22                                                      |
| iOS                   | 15.0 (Xcode 26.0 or later)                              |
| Android               | 7.0, API 24 (compile/target SDK 36)                     |
| Android Studio        | 2025.2.1                                                |
| JDK (Android builds)  | 21 (the generated Gradle files set `JavaVersion.VERSION_21`) |
| Gradle / AGP          | 8.14.3 / 8.13.0 (as generated)                          |

These are the toolchain floors. The project sets `minSdkVersion = 26` (Android 8.0, in
`app/android/variables.gradle`) and the iOS deployment target 15.0. SPEC §7 aims at iOS 16+;
the final floors are set in Phase 0.

## Development

Requires Node.js 22 or later. The whole app runs in a desktop browser for development:

```sh
cd app
npm ci
npm run dev                  # Vite dev server; open the printed URL
npm run check                # typecheck + lint + format check + unit tests + build
```

The Demo server works in the browser with no further setup. Use the browser's device
toolbar for a phone-sized viewport.

To reach a real Guacamole server from the browser (it sends no CORS headers), the dev
server can proxy it. Optional:

```sh
cp .env.example .env.local   # .env.local is git-ignored; use a low-privilege test account
```

Set `VITE_DEV_GUAC_URL` (including the context path), `VITE_DEV_GUAC_USER` and
`VITE_DEV_GUAC_PASS`. `npm run dev` then forwards `/dev-guac/...`, websocket tunnel
included, to that server and lists it pre-filled. These values are read only by the dev
server and never go into a production build.

Device builds are made by GitHub Actions (see [docs/release.md](docs/release.md)). For local
Android and iOS builds, including your own signing, see [docs/BUILDING.md](docs/BUILDING.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

OpenMobileGuac is licensed under the [GNU General Public License, version 3 or later](LICENSE)
(GPL-3.0-or-later), with an
[additional permission for app stores](LICENSE-APP-STORE-EXCEPTION). See [NOTICE](NOTICE)
for attributions.

What this means in plain words (the licence text is what counts):

- You may use, study, change and share the app, for free.
- If you distribute a changed version (a fork, a store listing, an APK), you must share its
  source code under the same licence. That keeps every version of the app open.
- App stores add terms of their own that can conflict with the GPL. The additional
  permission allows the app, and forks of it, to be distributed through stores such as the
  App Store and Google Play anyway, as long as the complete source of the distributed
  version is made available under this licence.

Earlier commits of this repository were published under the Apache License 2.0 and remain
available under it. The vendored `guacamole-common-js` in `app/src/vendor` is Apache-2.0
and keeps its own LICENSE and NOTICE; Apache-2.0 code can be used in a GPL-3.0 program.
