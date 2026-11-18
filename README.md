# OpenMobileGuac

An open-source mobile client (iOS and Android) for
[Apache Guacamole](https://guacamole.apache.org/) servers. It aims to make remote desktop
sessions comfortable on a phone or tablet: proper touch pointer modes, a reliable soft
keyboard with a key bar and combos, clipboard in both directions, and zoom and pan that
behave well.

It is a [Capacitor](https://capacitorjs.com/) app with a TypeScript + React UI. The
official Guacamole JavaScript client library (`guacamole-common-js`, Apache-2.0) handles
the protocol and rendering inside the system WebView. See [docs/SPEC.md](docs/SPEC.md)
for the specification and [docs/PLAN.md](docs/PLAN.md) for the delivery plan.

> **Unofficial.** OpenMobileGuac is an independent project. It is not affiliated with,
> endorsed by, or sponsored by the Apache Software Foundation or the Apache Guacamole
> project. "Apache", "Apache Guacamole", and "Guacamole" are trademarks of the Apache
> Software Foundation.

## Status

**Early development.** Nothing is published to any app store, and **nothing has been
verified on a physical phone yet.** What exists has been exercised in unit tests and in a
desktop browser (including phone-sized viewports) against the built-in Demo server.

Implemented:

- Server list: add and edit Guacamole servers and log in, with a warning for plain
  `http://` servers. Remembered passwords and tokens use the platform's secure storage in
  the app.
- Connection browser with search, favourites and recent connections.
- Session screen: direct-touch and trackpad pointer modes (tap, long press, drag,
  two-finger scroll), pinch zoom and pan with fit modes, a soft-keyboard bridge with a key
  bar, sticky modifiers and key combos, clipboard in both directions (UTF-8 exact, emoji
  included), and automatic reconnect.
- Settings: theme, fit and pointer modes, pointer speed, natural scrolling, haptics, keep
  awake, clipboard behaviour.
- A built-in **Demo server** that runs entirely on the device: a simulated desktop with a
  text editor, an input tester and a zoom target, so every control can be tried without a
  server. It contains no personal data and sends nothing over the network.

Not yet verified:

- Real-device behaviour: the soft keyboard on Android and iOS, OS paste prompts, real
  multi-touch, rotation, and anything iOS-specific.
- Sessions against a real Guacamole server: pending testing by the project owner (see
  [docs/checklists/](docs/checklists/)).
- The TestFlight and Android release-signing paths (see [docs/release.md](docs/release.md)).

## Try it

- **Android:** install the debug APK from the rolling
  [`nightly` prerelease](https://github.com/testyfishy/OpenMobileGuac/releases/tag/nightly),
  rebuilt on every push to `main`. It is an untested development build.
- **Any build or the browser:** open **Demo** on the server list, then **Demo desktop**. The
  two fixed-size variants (1024 × 768 and 1920 × 1080) are for trying zoom and pan.

## Documentation

- [docs/SPEC.md](docs/SPEC.md): specification.
- [docs/PLAN.md](docs/PLAN.md): delivery plan and task list.
- [docs/release.md](docs/release.md): CI, nightly APK, signing and TestFlight.
- [docs/checklists/](docs/checklists/): on-device test checklists.
- [docs/protocol-notes.md](docs/protocol-notes.md): notes on the Guacamole protocol and web
  client.

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

These are the toolchain floors. The product targets in SPEC §7 (iOS 16+, Android 8.0 /
API 26+) are higher; the final floors are set in Phase 0. The generated project still uses
Capacitor's defaults (`minSdkVersion = 24`).

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

Device builds are made by GitHub Actions (see [docs/release.md](docs/release.md)). For a
local Android build you also need the Android SDK (Android Studio) and JDK 21:

```sh
npm run build && npx cap sync android
npx cap open android
```

The iOS project is generated and committed under `app/ios`; building it requires macOS and
Xcode (CI builds it for the Simulator).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for attributions.
