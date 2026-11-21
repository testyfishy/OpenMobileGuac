# Privacy policy

Applies to: the OpenMobileGuac app for iOS and Android, as published from this repository
(App Store, TestFlight, Google Play and the APK files on GitHub).
Last updated: 2026-11-21.

## Summary

- The app has no analytics, no advertising, no tracking, no crash reporting and no user
  accounts.
- The developer runs no server for this app and receives no data from it.
- The app connects to the Apache Guacamole servers that you add, and to nothing else unless
  you start it (see "What leaves your device").
- Everything the app stores stays on your device. Passwords and other secrets are kept in
  the iOS Keychain or in storage protected by the Android Keystore.

OpenMobileGuac is open source (GPL-3.0-or-later, with an app-store permission; earlier
versions Apache-2.0). You can check every statement here in the source code at
<https://github.com/testyfishy/OpenMobileGuac>.

## What the app stores on your device

| Data | Where | Notes |
|---|---|---|
| Server profiles: name, address, user name, options, the certificate you chose to trust for a server | App storage | Added and edited by you |
| Favourites, recent connections, per-connection settings, app settings, key sets and combos | App storage | |
| Saved server passwords | iOS Keychain / Android Keystore-protected storage | Only if you choose to save the password |
| Sign-in tokens from your server | iOS Keychain / Android Keystore-protected storage | Used to avoid signing in again |
| TOTP (two-factor) secret | iOS Keychain / Android Keystore-protected storage | Off by default. Only if you choose to store it |
| Connection passwords you type when a connection asks for them | Memory, or the Keychain / Keystore | Saved on the device in the Keychain / Keystore by default, released by Face ID, fingerprint or the device passcode where one is set up. You can choose memory-only, a time limit, or never in Settings, and untick "Remember" in the prompt |
| Backup passphrase | iOS Keychain / Android Keystore-protected storage | Only if you set one for automatic backups |
| Thumbnails: small pictures of the last screen of a session | App cache folder | Can be turned off and deleted in Settings. Not included in system backups |
| Backups | App storage | Only if you make a backup or turn on automatic backups. A backup holds no passwords unless you set a passphrase; then passwords and TOTP secrets are encrypted with it. Sign-in tokens are never put in a backup |
| Files you download from a remote computer, and print jobs | Your device's Documents / Downloads area, or a temporary folder | Only when you accept a file. On iOS they appear in the Files app under the app's folder |
| Diagnostics log | Memory only | Recent technical events with passwords removed. It is lost when the app closes, and is never sent anywhere unless you copy or share it |

Keychain items are stored as "this device only" and are not synced to iCloud. On Android,
the app turns off Android's automatic cloud backup and device-to-device transfer for its
data.

## What leaves your device

- **Traffic to your Guacamole servers.** Sign-in, the connection list and the remote
  desktop session go to the server address you entered, or to the server in a share link
  you open. That includes your keyboard and pointer input, clipboard text you send, files you
  upload, and microphone audio if you turn on "Send microphone". What happens to that data
  on the server is decided by whoever runs the server.
- **Single sign-on and Duo.** If your server uses single sign-on (SAML, OpenID, CAS) or Duo,
  the app opens that sign-in page in an in-app or system browser. That page belongs to the
  identity provider your server is set up with, not to this app.
- **Things you choose to share.** When you share or copy a diagnostics log, a backup, a
  downloaded file, a print job or a session link, it goes where you send it.
- **The "Source code" link** in Settings › About opens the project's GitHub page, only when
  you tap it.

The app does not contact the developer or any third-party service. The built-in Demo runs
entirely on the device and sends nothing over the network.

If you connect with a plain `http://` address, the traffic is not encrypted and others on
the network may be able to read it. The app warns you before it sends a password over
`http://`.

## Clipboard

The app reads your device clipboard only when you tap Paste or a similar action, or when
you turn on automatic sending of the clipboard when a session opens. Text copied on the
remote computer is copied to your device clipboard; you can turn that off.

## Permissions

The app asks for a permission only when you use the feature that needs it.

**iOS**

| Permission | Why |
|---|---|
| Face ID | To unlock the app and your saved passwords when you turn on the app lock |
| Microphone | To send your microphone to the remote computer, only while "Send microphone" is on in a session |
| Local network | To connect to servers on your home or private network |

The app's Documents folder is visible in the Files app so you can open files you
downloaded.

**Android**

| Permission | Why |
|---|---|
| Internet (`INTERNET`) | To connect to your servers |
| Microphone (`RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`) | To send your microphone to the remote computer, only while "Send microphone" is on |
| Notifications (`POST_NOTIFICATIONS`) | For the notification shown while "Keep sessions connected in the background" is on (off by default) |
| Foreground service (`FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_SPECIAL_USE`) and `WAKE_LOCK` | To keep a session connected in the background when you turn that setting on |
| Vibration (`VIBRATE`) | Haptic feedback on taps and clicks; can be turned off in Settings |
| Biometrics (`USE_BIOMETRIC`, `USE_FINGERPRINT`, added by the AndroidX biometric library) | Fingerprint or face unlock for the app lock |

The app does not ask for location, contacts, camera, photos or storage access.

## Children

The app is a general tool for connecting to remote computers. It is not directed at
children and collects no data from anyone.

## Deleting your data

- **Delete a server** in the app: its saved password, token, TOTP secret, saved connection
  passwords, favourites, recents and settings are removed.
- **Settings › Sign out of all servers** removes every saved password, token, TOTP secret
  and remembered connection password. You can choose to remove the servers too.
- **Thumbnails** can be deleted in Settings. **Backups**, and the backup passphrase
  ("Remove passphrase"), can be deleted in the backup section of Settings.
- **Uninstalling the app** removes its storage. On iOS, the system may keep Keychain items
  after an app is deleted. To be sure your passwords are gone, delete your servers or use
  "Sign out of all servers" before you uninstall.
- Files you saved to Documents or Downloads stay there until you delete them.

The developer holds no copy of your data, so there is nothing to request from us.

## Changes

Changes to this policy are made in this file in the public repository, so every version and
its date can be seen in the history.

## Contact

Open an issue at <https://github.com/testyfishy/OpenMobileGuac/issues>. For security
problems, see [SECURITY.md](SECURITY.md).

OpenMobileGuac is an unofficial client. It is not affiliated with, endorsed by, or
sponsored by the Apache Software Foundation. "Apache Guacamole" and "Guacamole" are
trademarks of the Apache Software Foundation.
