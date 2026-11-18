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

**Early development (Phase 0).** The repository has only a scaffold and a placeholder
screen. It cannot connect to a server yet. Nothing is published to any app store.

## Repository layout

```
app/              Capacitor + Vite + React + TypeScript app
  src/core/       API, transport, storage, models (no UI)
  src/session/    gesture, pointer, key, viewport, display, clipboard
  src/ui/         screens and components
  src/vendor/     vendored third-party code (guacamole-common-js)
  android/        generated Android project (committed)
docs/             specification, plan, checklists
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

Requires Node.js 22 or later.

```sh
cd app
npm install
cp .env.example .env.local   # then edit; .env.local is git-ignored
npm run dev                  # dev server with the placeholder screen
npm run check                # typecheck + lint + format check + unit tests + build
```

Android builds additionally need the Android SDK (Android Studio) and JDK 21:

```sh
npm run build && npx cap sync android
npx cap open android
```

The iOS project has not been generated yet; it needs a Mac or a macOS CI runner.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for attributions.
