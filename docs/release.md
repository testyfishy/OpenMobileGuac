# Builds and releases

All device builds are made by GitHub Actions. Nothing here needs a Mac or a local Android
SDK. Workflows live in `.github/workflows/`:

| Workflow | Runner | What it does |
|---|---|---|
| `ci.yml` (CI) | ubuntu-latest, Node 22 | `npm ci` + `npm run check` in `app/` on every push and PR. |
| `android.yml` (Android) | ubuntu-latest, JDK 21, preinstalled Android SDK | Web build, `npx cap sync android`, `./gradlew assembleDebug`. Uploads the APK as a run artifact. On pushes to `main` it also updates the rolling `nightly` prerelease. |
| `ios.yml` (iOS) | macos-26 (Xcode 26.x) | Web build, `npx cap sync ios`, unsigned Simulator build. On pushes to `main` (or a manual run) **and** when the signing secrets exist, it archives, signs and uploads to TestFlight. |

The Android and iOS workflows skip pushes/PRs that only change Markdown files (macOS
runners can queue for a long time); run them by hand from the Actions tab if needed.

> **Status legend.** "Verified" means the step was seen passing in CI. "Unverified" means it
> is written but has not run end-to-end yet, usually because it needs the owner's Apple
> account.

- Verified: CI check, Android debug APK build and nightly publishing, iOS Simulator build.
- **Unverified:** the whole TestFlight path (archive, cloud signing, upload), Android
  release signing, and all on-device behaviour (see `docs/checklists/phase0.md`).

---

## Android

### Download the nightly APK

Every push to `main` replaces the APK on the `nightly` prerelease:

- Release page: <https://github.com/testyfishy/OpenMobileGuac/releases/tag/nightly>
- Direct link: <https://github.com/testyfishy/OpenMobileGuac/releases/download/nightly/OpenMobileGuac-debug.apk>

Builds from PRs and other branches are only available as a run artifact
(Actions → Android → the run → *Artifacts* → `OpenMobileGuac-debug-apk`, a zip that needs a
GitHub login to download).

The `versionCode` is the workflow run number, so each nightly installs over the previous one
**as long as the signing key stays the same** (next section).

### Debug signing

Android refuses to update an app if the new APK is signed with a different key. The
workflow keeps the debug key stable like this:

1. If the secret `ANDROID_DEBUG_KEYSTORE_BASE64` is set, it uses that keystore.
2. Otherwise it restores `~/.android/debug.keystore` from the GitHub Actions cache (key
   `android-debug-keystore-v1`), creating and caching a new one on the first run.

Option 2 needs no setup, but GitHub evicts caches that go unused for 7 days. After a long
pause the next build gets a new key and the phone will say the update conflicts with the
installed app: uninstall the old one first. To make the key permanent, set the secret
(optional):

1. On the Windows PC (JDK 21 includes `keytool`), in PowerShell:
   ```powershell
   keytool -genkeypair -keystore debug.keystore -storepass android -keypass android `
     -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 `
     -dname "CN=Android Debug,O=Android,C=US"
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("$PWD\debug.keystore")) | gh secret set ANDROID_DEBUG_KEYSTORE_BASE64
   Remove-Item debug.keystore
   ```
   (The passwords `android` are the standard debug-keystore values; this key is not a
   release key and does not need to be secret.)

### Android release signing (for later, Phase 3)

`app/android/app/build.gradle` signs the `release` build type only when
`ANDROID_KEYSTORE_PATH` is set in the environment. The workflow step "Assemble signed
release" runs `assembleRelease bundleRelease` and uploads an `OpenMobileGuac-release`
artifact, but only on non-PR runs and only when these secrets exist:

| Secret | Contents |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | The upload/release keystore (`.jks`), base64-encoded. |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password. |
| `ANDROID_KEY_ALIAS` | Key alias inside the keystore. |
| `ANDROID_KEY_PASSWORD` | Key password. |

Unverified: this path has not run. Uploading to Play internal testing is not implemented
yet (Phase 3).

---

## iOS

### How the `app/ios` project was produced

Capacitor 8 creates iOS projects with **Swift Package Manager** by default (no CocoaPods,
no `pod install`). `npx cap add ios` therefore works on Windows: it only copies the Xcode
template and writes `ios/App/CapApp-SPM/Package.swift`. The project was generated on
Windows with `@capacitor/ios` 8.6.2 and committed (SPEC §8.6: native projects are
committed). Each CI run still does `npx cap sync ios`, which rewrites `Package.swift` and
copies the web build. When you add or remove a Capacitor plugin, run `npx cap sync` and
commit the changed `Package.swift` / `capacitor.settings.gradle` / `capacitor.build.gradle`.

Why not generate it in CI on every build: a committed project lets us keep hand edits
(Info.plist keys, bundle id, build settings) under review, which is what the store needs.

### Xcode version

Capacitor 8 requires Xcode 26.0+ and iOS 15+ (capacitorjs.com/docs/ios). On the GitHub
runner images checked on 2026-11-18, `macos-15`'s default Xcode is 16.4 (too old), while
`macos-26` defaults to Xcode 26.6. The workflow uses `runs-on: macos-26`, prints
`xcodebuild -version` and fails if the major version is below 26. If GitHub changes the
default, select a version with `sudo xcode-select -s /Applications/Xcode_26.x.app`.

GitHub's macOS arm64 runners are sometimes out of capacity; the job then sits in the queue
and ends "cancelled" with *"The job was not acquired by Runner of type hosted even after
multiple attempts"*. That is not a build failure. Only one iOS run per branch runs at a
time, so first **cancel** any iOS run still waiting in the queue (Actions → iOS → the run →
*Cancel workflow*), otherwise a new run waits behind it. Then re-run later, or use the Intel image
(`macos-26-intel`, same Xcode 26.x set): either pick it under Actions → iOS → **Run
workflow** → *runner*, or set a repository **variable** (Settings → Secrets and variables
→ Actions → *Variables*) named `IOS_RUNNER` with value `macos-26-intel` to make it the
default for pushes.

### One-time Apple setup (owner, no Mac needed)

Requires an active Apple Developer Program membership. All steps are in a web browser.

**1. Find your Team ID**

1. Go to <https://developer.apple.com/account> and sign in.
2. Scroll to **Membership details**. Copy the 10-character **Team ID**.

**2. Register the bundle ID**

The bundle ID is `io.github.testyfishy.omg` (chosen 2026-11-19). If you want a
different one, change it **before** registering, in all of these places, and commit:

- `app/capacitor.config.ts` → `appId`
- `app/ios/App/App.xcodeproj/project.pbxproj` → both `PRODUCT_BUNDLE_IDENTIFIER = …;` lines
- `app/android/app/build.gradle` → `namespace` and `applicationId` (Android only; also move
  `MainActivity.java` to the matching package folder)

Then:

1. <https://developer.apple.com/account> → **Certificates, Identifiers & Profiles** →
   **Identifiers** → the blue **+** button.
2. Choose **App IDs** → Continue → **App** → Continue.
3. Description: `OpenMobileGuac`. Bundle ID: **Explicit**, enter the bundle ID exactly.
4. Leave all capabilities unticked → **Continue** → **Register**.

**3. Create the app record**

1. <https://appstoreconnect.apple.com> → **Apps** → **+** → **New App**.
2. Platforms: **iOS**. Name: any name not already taken on the App Store (this can be
   changed until first release; SPEC §2 Q1 / PLAN U3). Primary language: your choice.
3. Bundle ID: pick the one registered in step 2 from the dropdown.
4. SKU: any internal string, e.g. `openmobileguac`. User Access: **Full Access**.
5. **Create**.

**4. Create an App Store Connect API key**

1. <https://appstoreconnect.apple.com> → **Users and Access** → **Integrations** tab →
   **App Store Connect API** → **Team Keys**.
   (First time only: the Account Holder must click **Request Access** and accept the terms.)
2. Click **Generate API Key** (or the **+** button).
3. Name: `GitHub Actions`. Access: **Admin**.
   Admin is needed because the workflow lets Xcode create/use a *cloud-managed* Apple
   Distribution certificate and provisioning profile through this key; lower roles
   (App Manager, Developer) are reported to fail with "You haven't been given access to
   cloud-managed distribution certificates". *(Unverified for this project.)*
4. **Generate**. Copy the **Key ID** shown in the row and the **Issuer ID** shown above the
   table.
5. Click **Download** on the key row. You get `AuthKey_<KEYID>.p8`. **It can only be
   downloaded once**; store it in a password manager.

**5. Set the GitHub Actions secrets**

GitHub → the repository → **Settings** → **Secrets and variables** → **Actions** →
**New repository secret**, once per row:

| Secret name | What it contains |
|---|---|
| `APPLE_TEAM_ID` | The 10-character Team ID from step 1. |
| `APP_STORE_CONNECT_API_KEY_ID` | The Key ID from step 4. |
| `APP_STORE_CONNECT_API_ISSUER_ID` | The Issuer ID (a UUID) from step 4. |
| `APP_STORE_CONNECT_API_KEY_P8` | The full text of the `.p8` file, including the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines. Open it in Notepad and paste. |

Or from PowerShell in the folder holding the `.p8` (the values never appear in the repo or
logs):

```powershell
gh secret set APPLE_TEAM_ID
gh secret set APP_STORE_CONNECT_API_KEY_ID
gh secret set APP_STORE_CONNECT_API_ISSUER_ID
Get-Content -Raw .\AuthKey_XXXXXXXXXX.p8 | gh secret set APP_STORE_CONNECT_API_KEY_P8
```

**6. Trigger a build**

Push to `main`, or GitHub → **Actions** → **iOS** → **Run workflow** (leave "Upload to
TestFlight" ticked). When the run succeeds, the build appears in App Store Connect →
your app → **TestFlight** after Apple finishes processing (often 5–30 minutes).

**7. Add yourself as a tester**

1. App Store Connect → your app → **TestFlight** → **Internal Testing** → **+** → create a
   group (e.g. `Owner`), add yourself, and add the build to the group.
2. On the iPhone, install **TestFlight** from the App Store, sign in with the same Apple ID,
   and accept the invitation. Install steps are also in `docs/checklists/phase0.md`.

### How signing works in CI (and why this approach)

The workflow uses plain `xcodebuild` with Xcode automatic signing and the App Store
Connect API key:

1. `xcodebuild archive … CODE_SIGNING_ALLOWED=NO CURRENT_PROJECT_VERSION=<run number>`:
   builds an unsigned Release archive. The build number must increase for every TestFlight
   upload, so it is the workflow run number.
2. `xcodebuild -exportArchive -allowProvisioningUpdates -authenticationKeyPath … 
   -authenticationKeyID … -authenticationKeyIssuerID …` with an export-options plist of
   `method = app-store-connect`, `destination = upload`, `signingStyle = automatic`,
   `teamID`. Xcode signs with a cloud-managed Apple Distribution certificate, creates the
   App Store provisioning profile itself, and uploads the IPA directly to App Store Connect.

Why not fastlane `match` / `cert` + `sigh`: those need a distribution certificate's private
key on the runner, i.e. a `.p12` exported from a keychain (awkward without a Mac) or a
separate certificates repository, and `cert` would mint a new certificate on every
ephemeral runner until the account's certificate limit is hit. Cloud-managed signing keeps
the private key at Apple and needs only the API key. It also avoids adding a Ruby
toolchain. Archiving unsigned avoids an Apple Development profile, which Xcode can only
create if the team has at least one registered device.

**Unverified (needs your account to test):**

- That the export step succeeds with an Admin API key on a fresh team. If it fails with a
  cloud-signing / "no account" error, check that the key's access is **Admin**, then
  re-run. If it still fails, the fallbacks are: (a) archive with signing on, after
  registering the iPhone's UDID under *Certificates, Identifiers & Profiles → Devices*; or
  (b) switch to fastlane with a stored distribution certificate. Report the exact error
  text (it contains no secrets) and a session can adapt the workflow.
- That `uploadSymbols` and the upload itself pass App Store Connect validation (icons,
  Info.plist keys) on the first try. Missing marketing icons sizes etc. would show as
  upload errors in the run log.

### `ITSAppUsesNonExemptEncryption`

`Info.plist` sets it to `false`: the app only uses the OS's standard HTTPS/TLS. This answers
the export-compliance question for every build so TestFlight builds don't stop at
"Missing Compliance". Re-check at submission time (SPEC §10.2).

---

## Foreground service (Android background keep-alive)

The optional setting "Keep sessions connected in the background" (off by default; Android
only) starts a foreground service while at least one remote session is open, using
`@capawesome-team/capacitor-android-foreground-service` 8.1.0 (MIT). Manifest entries
(`android/app/src/main/AndroidManifest.xml`): `FOREGROUND_SERVICE`,
`FOREGROUND_SERVICE_SPECIAL_USE`, `POST_NOTIFICATIONS` (runtime prompt on Android 13+, asked
when the user turns the setting on, after an in-app explanation), `WAKE_LOCK` (the plugin
holds a partial wake lock while the service runs), the plugin's `AndroidForegroundService`
with `android:foregroundServiceType="specialUse"` and the
`android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE` property, and its
`NotificationActionBroadcastReceiver` (not exported). The notification icon is
`res/drawable/ic_stat_session.xml`. The JS side passes
`FOREGROUND_SERVICE_TYPE_SPECIAL_USE` (`0x40000000`) to `startForeground`
(`ui/services/keepAlive.ts`). `SYSTEM_ALERT_WINDOW`, which the plugin's README lists for
`moveToForeground()`, is not added (not used).

Why `specialUse`: of the Android 14 types, `dataSync` is for finite transfers (upload,
backup, sync, import/export) and is time-limited from Android 15; `connectedDevice` is for
Bluetooth / USB / NFC / IR or similar external devices and needs a related permission the
app does not have; `remoteMessaging` is for moving text messages between devices;
`mediaProjection` is for screen capture; `shortService` stops after about 3 minutes. Keeping an
interactive remote desktop connection open fits none of them, which is what `specialUse`
(reviewed in the Play Console) is for. Sources checked 2026-11-20: Android's foreground
service types page, the Android 15 behavior changes (`dataSync`: 6 hours per 24 hours), and
Play Console Help "Understanding foreground service and full-screen intent requirements"
(special use only when no defined type fits; every type is reviewed; the declaration needs a
description, the user impact if the task is deferred or interrupted, and a video). That page
does not mention remote desktop clients, so approval is not guaranteed; if Play rejects
`specialUse`, the fallback is to keep the setting off in Play builds.

**Play Console › App content › Foreground service permissions**: declare *Special use* and
paste:

> OpenMobileGuac is a remote desktop client for Apache Guacamole. When the user turns on
> "Keep sessions connected in the background" (off by default), a foreground service runs
> only while at least one remote desktop session that the user opened is connected. It keeps
> the WebSocket connection to the user's own Guacamole server open when the user switches to
> another app or the screen turns off, so the remote session (and the work in it) is not
> dropped. The notification shows how many sessions are connected and has a "Disconnect all"
> action; the service stops as soon as the last session closes. No data is collected; the
> connection goes only to the server the user added. The work cannot be deferred or
> interrupted, because the remote session would be disconnected.

Video for the declaration: open a demo or test session, turn the setting on, switch apps,
show the notification, return to the still-connected session, tap Disconnect all.

iOS: no background mode is added. iOS does not allow keeping a remote desktop connection open
in the background for this kind of app (adding one would fail App Review), so sessions keep
the grace-period disconnect and reconnect on return.

## Network configuration

Users connect to self-hosted Guacamole servers, usually on private networks (Tailscale
`100.x.y.z` addresses, MagicDNS names such as `host.tailnet-name.ts.net`, LAN hosts like
`guac.example` or `192.168.x.y`) and often over plain `http://` and `ws://`. The hosts are
chosen by the user at run time, so no per-host allowlist is possible. REST calls go through
Capacitor's native HTTP (outside the WebView, so no CORS); the tunnel is a WebSocket opened
from the WebView.

### Android

Checked against capacitorjs.com/docs/config and the Capacitor 8.6.2 source in
`node_modules/@capacitor`:

- `server.androidScheme: 'https'` (the Capacitor default, stated explicitly). The page is
  served from `https://localhost`, which is a secure context, so clipboard and similar
  APIs keep working. Changing the scheme would also change the origin and wipe stored data.
- `android.allowMixedContent: true`. Capacitor's `Bridge.java` then calls
  `WebSettings.setMixedContentMode(MIXED_CONTENT_ALWAYS_ALLOW)`. Without it the WebView
  blocks `ws://` (insecure) sockets opened from the `https://localhost` page.
- Cleartext: Android blocks cleartext by default since API 28. The committed
  `AndroidManifest.xml` points to `res/xml/network_security_config.xml`, whose
  `base-config` sets `cleartextTrafficPermitted="true"` and, for HTTPS, trusts the system CAs
  plus user-installed CAs (`<certificates src="user" />`, so a private home/company CA
  installed on the device works; see docs/tls.md; untested on a device). This
  covers native HTTP (Capacitor's `HttpURLConnection`) and the WebView. The manifest also
  has `android:usesCleartextTraffic="true"` (ignored when a network security config is
  present, kept for clarity). `server.cleartext: true` is set too, but in Capacitor 8 it
  only adds `usesCleartextTraffic` to the generated, git-ignored cordova-plugins manifest,
  so it is not relied on.
- The Capacitor docs mark `cleartext` and `allowMixedContent` "not intended for use in
  production". For this app they are the product requirement (plain-http private servers);
  the store justification is the same as for iOS ATS below.
- `INTERNET` permission is declared in the manifest.
- `minSdkVersion` is **26** (Android 8.0), per SPEC. Capacitor 8's default is 24; nothing
  in the app needs 24–25 and the WebView behaviour we rely on is better on 26+.
  `compileSdk`/`targetSdk` stay at Capacitor's 36.

Unverified on hardware: that `ws://` to a tailnet host really connects from the WebView with
these settings (G0 criteria 1–2).

### iOS: App Transport Security

`Info.plist` contains only:

```xml
<key>NSAppTransportSecurity</key>
<dict>
  <key>NSAllowsArbitraryLoads</key>
  <true/>
</dict>
```

Why this and not a narrower key (from Apple's documentation for the ATS keys):

- `NSAllowsLocalNetworking` covers unqualified names, `.local` names and IP addresses, but
  **not fully qualified names**, so MagicDNS names (`*.ts.net`) and ordinary LAN DNS names
  would still be blocked.
- `NSAllowsArbitraryLoadsInWebContent` covers only the WebView, not Capacitor's native HTTP
  (URLSession), which we use for REST.
- `NSExceptionDomains` needs the host names at build time; users pick them at run time.
- Apple documents that on iOS 10+ `NSAllowsArbitraryLoads` is **ignored** if
  `NSAllowsLocalNetworking`, `NSAllowsArbitraryLoadsInWebContent` or
  `NSAllowsArbitraryLoadsForMedia` is present. So adding any of them "for safety" would
  silently break connections to MagicDNS names. Don't.

App Review requires a justification for `NSAllowsArbitraryLoads`. Draft text for submission
(SPEC §10.2): *"OpenMobileGuac is a client for Apache Guacamole servers that users host
themselves, typically on a home or private network (for example a Tailscale tailnet or a
LAN) where TLS is often not configured. The user enters the server address; the app does
not contact any server the user has not added. HTTPS is used whenever the user's server
supports it."*

Other keys:

- `NSLocalNetworkUsageDescription`: iOS 14+ shows a local-network permission prompt the
  first time the app connects to a LAN address; this string is the explanation shown.
  Whether a given connection (LAN vs. tailnet `100.x`) triggers the prompt is checked in G0.
- `UIRequiredDeviceCapabilities` changed from the template's `armv7` to `arm64`.

Unverified: that WebKit lets the `capacitor://localhost` page open `ws://` sockets (mixed
content rules for custom schemes). This is the main thing G0 criterion 1–2 tests on iPhone;
if it fails, PLAN T0.7 (native tunnel bridge) is the fallback.
