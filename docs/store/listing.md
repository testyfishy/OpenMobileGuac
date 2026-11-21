# Store listing text (drafts)

Drafts to paste into App Store Connect and the Play Console. Character counts were checked
when written; re-check after editing. Store limits named here are the ones the stores showed
at the time of writing and may change.

Naming: "Guacamole" and "Apache Guacamole" are trademarks of the Apache Software Foundation.
The text below uses them only to say what the app works with, and always says the app is
unofficial. Do not use "Guacamole" as the first word of the app name or in a way that
suggests the app comes from the Apache project.

## App name

The app is called "OpenMobileGuac" in the project. Check that the name is free in both
stores before relying on it (see the checklist in [README.md](README.md)).

## Subtitle (App Store, max 30 characters)

Three options. Pick one.

| Option | Characters |
|---|---|
| Client for Apache Guacamole | 27 |
| Touch remote desktop client | 27 |
| Remote desktop, self-hosted | 27 |

The first is the clearest about what the app needs. The other two avoid the trademark in the
subtitle; then the description must say early that a Guacamole server is required.

## Short description (Google Play, max 80 characters)

> Open-source client for your own Apache Guacamole remote desktop server

70 characters.

## Keywords (App Store, max 100 characters, comma separated)

```
remote desktop,rdp,vnc,ssh,telnet,self-hosted,homelab,remote access,open source,guacd,touch,keyboard
```

100 characters. Product names of other companies are left out on purpose. Words that are
already in the app name or subtitle do not need repeating.

## Description (both stores, max 4000 characters)

```
OpenMobileGuac is a free, open-source app for using your own Apache Guacamole server from a phone or tablet. It is an unofficial client: it is not made or endorsed by the Apache Software Foundation.

You need a Guacamole server that you or your organisation runs. The app connects to that server and shows your remote desktops and terminals (RDP, VNC, SSH, Telnet and Kubernetes, whatever your server offers). You can try every control first with the built-in Demo, which runs on the device and needs no server.

MADE FOR TOUCH
- Direct touch or trackpad pointer, switched with one tap
- Pinch to zoom and pan, fit to screen, fit width or 1:1
- RDP multi-touch, hardware mouse and keyboard support
- Every gesture explained in Settings, each with its own switch

A KEYBOARD THAT WORKS
- Soft keyboard on demand, even when nothing on the remote has focus
- Extra-key bar with Esc, Tab, Ctrl, Alt, Win, arrows and F1–F12
- Key sets for Windows, macOS, Linux terminals and more, or build your own
- Saved key combos such as Ctrl+Alt+Del

CLIPBOARD, FILES AND SOUND
- Clipboard in both directions, with a history panel
- Upload and download files through the drive or SFTP your server provides
- RDP print jobs as PDF
- Sound, and the microphone for RDP when you turn it on

YOUR SERVERS, YOUR WAY
- Several servers and several sessions at once
- Folders, search, favourites, recents and thumbnails
- Two-factor sign-in with TOTP, single sign-on (experimental)
- Self-signed HTTPS: trust your server's certificate after checking its fingerprint
- Toolbar at the bottom, top, side or floating; many options in Settings
- Connection management for accounts that are allowed to edit connections

PRIVATE BY DESIGN
- No account, no analytics, no ads, no tracking
- The app talks only to the servers you add
- Saved passwords stay in the device keychain
- Optional app lock with Face ID or the device passcode
- Backups are encrypted with your passphrase if they contain passwords

OPEN SOURCE
The full source code, the build workflow and the privacy policy are public at github.com/testyfishy/OpenMobileGuac. The app is licensed under the GNU GPL version 3 or later. Anyone can build it themselves.

Apache, Apache Guacamole and Guacamole are trademarks of the Apache Software Foundation.
```

About 2,300 characters. For Google Play, replace "Face ID or the device passcode" with
"fingerprint, face unlock or the device PIN".

Before publishing, remove any line for a feature you have not seen working on a device
(see [docs/FEATURES.md](../FEATURES.md); most rows are still "untested on device").

## What's New (first version)

```
First release. Connect to your own Apache Guacamole server with touch-friendly controls, an extra-key bar, clipboard in both directions, file transfer and a built-in Demo. Free and open source, with no account and no tracking.
```

For later versions, copy the user-facing lines of [CHANGELOG.md](../../CHANGELOG.md).

## Category

Suggested: Utilities (primary), Productivity (secondary). This is the owner's choice.

## URLs

| Field | Value |
|---|---|
| Privacy policy URL | <https://github.com/testyfishy/OpenMobileGuac/blob/main/PRIVACY.md> |
| Support URL | <https://github.com/testyfishy/OpenMobileGuac/issues> |
| Marketing URL (optional) | <https://github.com/testyfishy/OpenMobileGuac> |
| Copyright (App Store) | 2026 The OpenMobileGuac contributors |
