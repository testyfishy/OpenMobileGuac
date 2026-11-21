# Building from source

This guide is for anyone who wants their own build of OpenMobileGuac: for development, to
check that a store build matches this source, or to run a fork. Everything needed is in this
repository. The project is licensed under GPL-3.0-or-later with an app-store permission (see
[LICENSE](../LICENSE) and [LICENSE-APP-STORE-EXCEPTION](../LICENSE-APP-STORE-EXCEPTION)).
If you distribute your build, you must make its source available under the same licence.
Earlier commits were published under Apache-2.0 and remain available under it; the vendored
`guacamole-common-js` in `app/src/vendor` is Apache-2.0.

CI details, signing background and store-specific notes are in [release.md](release.md).
This page links to it instead of repeating it.

> **What has been run.** The web steps are run by CI on pushes to `main` and on pull requests, and by contributors. The
> Android and iOS steps below mirror what `.github/workflows/android.yml` and
> `.github/workflows/ios.yml` do, and those workflows are seen passing in CI. The local
> Android Studio and Xcode steps have not been written up from a run on a local machine; if a
> step does not work for you, please open an issue.

## Contents

1. [Requirements](#1-requirements)
2. [Get the source and run the web app](#2-get-the-source-and-run-the-web-app)
3. [Android](#3-android)
4. [iOS](#4-ios)
5. [Using your own app ID](#5-using-your-own-app-id)
6. [Build with GitHub Actions in your fork](#6-build-with-github-actions-in-your-fork)
7. [Checking a build against the source](#7-checking-a-build-against-the-source)

## 1. Requirements

| For | You need |
|---|---|
| Web development | Node.js 22 or later (CI uses 22), npm, git |
| Android | The above, plus JDK 21 and the Android SDK (Android Studio 2025.2.1 or later is the easiest way to get it). `compileSdk` and `targetSdk` are 36; `minSdkVersion` is 26 (Android 8.0) |
| iOS | The above, plus a Mac with Xcode 26 or later (Xcode 27.1 or later for iPhone Duo: Apple says apps built with Xcode 26 and earlier do not extend under its status bar and camera, so they do not fill its screens). A device build needs an Apple ID; TestFlight or App Store needs a paid Apple Developer Program membership. Deployment target is iOS 15.0 |

Versions in use are listed in the [README](../README.md#toolchain-and-platform-minimums).

## 2. Get the source and run the web app

```sh
git clone https://github.com/testyfishy/OpenMobileGuac.git
cd OpenMobileGuac/app
npm ci
npm run dev        # Vite dev server; open the printed URL
npm run check      # typecheck, lint, format check, unit tests, production build
```

The whole UI runs in a desktop browser. Use the browser's device toolbar for a phone-sized
viewport. The built-in Demo server works with no further setup: tap **Demo**, then
**Demo desktop**.

To try a real Guacamole server from the browser, the dev server can proxy it (Guacamole
sends no CORS headers):

```sh
cp .env.example .env.local   # git-ignored; use a low-privilege test account
```

Fill in `VITE_DEV_GUAC_URL` (with the context path, for example
`https://guac.example.com/guacamole`), `VITE_DEV_GUAC_USER` and `VITE_DEV_GUAC_PASS`.
`npm run dev` then lists a "Dev server" entry. These values are read only when Vite runs as
a dev server (`vite.config.ts` checks `command === 'serve'`), so they do not reach a
production build. Even so, never set them for a release build.

Note: in a browser build, saved passwords are kept in memory only (production build) or in
unencrypted browser storage with a visible warning (dev build). The Keychain / Keystore is
used only in the iOS and Android apps.

## 3. Android

### 3.1 Debug APK from the command line

From `app/`:

```sh
npm ci
npm run build
npx cap sync android
cd android
./gradlew assembleDebug          # on Windows: gradlew.bat assembleDebug
```

The APK is `app/android/app/build/outputs/apk/debug/app-debug.apk`. It is signed with your
local debug key (`~/.android/debug.keystore`, created by the Android tooling if missing).

Install it on a phone with USB debugging on:

```sh
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

An APK signed with a different key cannot update an installed copy. If you already have
the nightly APK from GitHub installed, uninstall it first, or use your own app ID
([section 5](#5-using-your-own-app-id)) so both can be installed side by side.

**Debugging the WebView.** Every build, debug ones included, has Capacitor's plugin-call
logging and WebView debugging (Chrome `chrome://inspect`, Safari Web Inspector) turned off,
because the log lines contain passwords and tokens. To turn both on for a local build, sync
with the environment variable set: `OMG_DEBUG_WEBVIEW=1 npx cap sync` (PowerShell:
`$env:OMG_DEBUG_WEBVIEW='1'; npx cap sync`). It is read from `capacitor.config.ts` at sync
time and baked into the native project, so sync again without it before building anything
you give to someone else. The same applies to iOS.

### 3.2 Android Studio

```sh
npm run build && npx cap sync android
npx cap open android
```

Then pick a device and press Run. Run `npm run build && npx cap sync android` again after
every change to the web code.

### 3.3 Release build with your own keystore

`app/android/app/build.gradle` signs the `release` build type only when the environment
variable `ANDROID_KEYSTORE_PATH` is set. Without it, `assembleRelease` produces an unsigned
APK.

1. Create a keystore once and keep it safe. If you lose it, you cannot ship updates to
   people who installed your build.

   ```sh
   keytool -genkeypair -keystore my-release.jks -alias my-key \
     -keyalg RSA -keysize 4096 -validity 10000
   ```

2. Build with these environment variables set (names from `build.gradle`):

   | Variable | Value |
   |---|---|
   | `ANDROID_KEYSTORE_PATH` | Path to the `.jks` file |
   | `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
   | `ANDROID_KEY_ALIAS` | Key alias, for example `my-key` |
   | `ANDROID_KEY_PASSWORD` | Key password |
   | `ANDROID_VERSION_CODE` | Optional. An integer that must go up with every build you distribute (default 1) |

   ```sh
   cd app
   npm ci && npm run build && npx cap sync android
   cd android
   ./gradlew assembleRelease bundleRelease
   ```

3. Outputs: `app/build/outputs/apk/release/*.apk` (for direct install) and
   `app/build/outputs/bundle/release/*.aab` (for Google Play).

Status: this release-signing path has not been run yet, locally or in CI (the CI step is
skipped because no release keystore secret is set).

## 4. iOS

### 4.1 Simulator build (no Apple account)

From `app/` on a Mac:

```sh
npm ci
npm run build
npx cap sync ios
npx cap open ios
```

In Xcode, choose an iPhone simulator and press Run. This is the same as the "Unsigned
simulator build" step in CI:

```sh
cd ios/App
xcodebuild build -project App.xcodeproj -scheme App -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO
```

The iOS project uses Swift Package Manager; there is no CocoaPods step.

### 4.2 Run on your own iPhone

1. Change the bundle ID to one you own ([section 5](#5-using-your-own-app-id)). The bundle
   ID in this repository, `io.github.testyfishy.omg`, is registered to the maintainer's
   Apple team, so Xcode cannot sign it for yours.
2. Open the project (`npx cap open ios`), select the **App** target, then **Signing &
   Capabilities**.
3. Keep **Automatically manage signing** ticked and choose your **Team**. A free Apple ID
   works for installing on your own device; such builds expire after a few days and must be
   re-installed.
4. Connect the iPhone, turn on Developer Mode on it if asked (Settings › Privacy & Security ›
   Developer Mode), choose it as the run destination and press Run.

The project file in the repository has no `DEVELOPMENT_TEAM`. Choosing a team in Xcode
writes one into `project.pbxproj`; do not commit that change in a pull request.

### 4.3 TestFlight and App Store with your own account

You need a paid Apple Developer Program membership. The steps are in
[release.md, "One-time Apple setup"](release.md#one-time-apple-setup-owner-no-mac-needed):
find your Team ID, register your bundle ID, create the app record in App Store Connect, and
create an App Store Connect API key with **Admin** access.

From a Mac you can then use Xcode: **Product › Archive**, then **Distribute App › App Store
Connect**. Without a Mac, use the workflow in your fork ([section 6](#6-build-with-github-actions-in-your-fork)).

Before you submit to the App Store, also read [store/](store/README.md): the export-compliance
key, the App Transport Security justification and the privacy answers apply to your build
too.

## 5. Using your own app ID

Use your own ID for any build you distribute, and for any build you want to install next to
the official one. Change it in all of these places and keep them equal:

| File | What to change |
|---|---|
| `app/capacitor.config.ts` | `appId` |
| `app/ios/App/App.xcodeproj/project.pbxproj` | Both `PRODUCT_BUNDLE_IDENTIFIER = …;` lines |
| `app/ios/App/App/Info.plist` | `CFBundleURLName` inside `CFBundleURLTypes` (it holds the ID as a label) |
| `app/android/app/build.gradle` | `namespace` and `applicationId` |
| `app/android/app/src/main/res/values/strings.xml` | `package_name` and `custom_url_scheme` (generated by Capacitor with the ID) |
| `app/android/app/src/main/java/io/github/testyfishy/omg/MainActivity.java` | Its `package` line, and move the file to the folder that matches the new package |

Then run `npx cap sync`.

Also consider the app name (`appName` in `capacitor.config.ts`, `CFBundleDisplayName` in
`Info.plist`, `app_name` in `app/android/app/src/main/res/values/strings.xml`) so people can
tell your build from the official one.

The deep-link scheme `openmobileguac://` (used for app links and the single sign-on return)
is declared in `Info.plist` and `AndroidManifest.xml`. If two builds with the same scheme are
installed, the OS picks one of them to open those links. Changing the scheme also needs
changes in `app/src` where links are built and parsed (`core/links/links.ts`,
`core/sso/sso.ts`).

## 6. Build with GitHub Actions in your fork

The three workflows in `.github/workflows/` work in a fork. Enable Actions in your fork
first.

| Workflow | Runs on | Produces |
|---|---|---|
| `ci.yml` | pushes to `main`, pull requests and manual runs | `npm ci` and `npm run check` |
| `android.yml` | pushes to `main` and pull requests that change more than Markdown, and manual runs | A debug APK as a run artifact; on pushes to `main`, also the rolling `nightly` prerelease of your fork |
| `ios.yml` | pushes to `main` and pull requests that change more than Markdown, and manual runs | An unsigned Simulator build; with the secrets below, a signed upload to TestFlight on pushes to `main` and on manual runs with "Upload to TestFlight" ticked |

### Secrets the workflows read

Set them under your fork's **Settings › Secrets and variables › Actions**. All are
optional; without them, the signed steps are skipped.

| Secret | Workflow | Used for |
|---|---|---|
| `APPLE_TEAM_ID` | `ios.yml` | Your 10-character Apple Team ID |
| `APP_STORE_CONNECT_API_KEY_ID` | `ios.yml` | Key ID of your App Store Connect API key |
| `APP_STORE_CONNECT_API_ISSUER_ID` | `ios.yml` | Issuer ID (a UUID) shown above the key list |
| `APP_STORE_CONNECT_API_KEY_P8` | `ios.yml` | Full text of the `.p8` key file, including the BEGIN and END lines |
| `ANDROID_DEBUG_KEYSTORE_BASE64` | `android.yml` | A base64 debug keystore, so every nightly has the same signature |
| `ANDROID_KEYSTORE_BASE64` | `android.yml` | Your release keystore, base64-encoded |
| `ANDROID_KEYSTORE_PASSWORD` | `android.yml` | Release keystore password |
| `ANDROID_KEY_ALIAS` | `android.yml` | Release key alias |
| `ANDROID_KEY_PASSWORD` | `android.yml` | Release key password |

The iOS upload runs only when all four Apple secrets are set. The Android release step runs
only when `ANDROID_KEYSTORE_BASE64` is set, and never on pull requests.

Optional repository **variable** (not a secret): `IOS_RUNNER`, set to `macos-26-intel` to use
the Intel macOS runner when arm64 runners are out of capacity. See release.md.

### How CI signs iOS builds

The workflow archives without signing, then `xcodebuild -exportArchive` signs with a
cloud-managed Apple Distribution certificate through the API key and uploads to App Store
Connect. No certificate or provisioning profile has to be made on a Mac. The build number
is the workflow run number. Background and fallbacks:
[release.md, "How signing works in CI"](release.md#how-signing-works-in-ci-and-why-this-approach).

Status: in this repository, the signed TestFlight upload is seen passing in CI on pushes to
`main` (from 2026-11-20). It has not been tried on a fresh fork.

## 7. Checking a build against the source

- **iOS builds from the maintainer** are made by `ios.yml` on GitHub's runners from a commit
  on `main`. The run log is public: Actions › iOS › the run. Its build number is the
  workflow run number, which is the build number shown in TestFlight and App Store Connect.
  The web code inside the app is the output of `npm run build` at that commit.
- **Android nightly APKs** are made by `android.yml`; the release notes on the `nightly`
  prerelease name the commit and run number.
- Builds are not bit-for-bit reproducible (signing, timestamps and toolchain versions on
  the runner differ). What you can do is build the same commit yourself and compare the
  behaviour, or compare the web assets: unpack the APK (`assets/public/`) or the iOS app
  bundle (`public/`) and compare them with `app/dist/` from your own `npm run build` at the
  same commit. This comparison has not been tried yet; differences in generated file names
  are possible.
