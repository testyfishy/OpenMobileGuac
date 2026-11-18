# Phase 0 device checklist (gate G0)

Run on the Android phone and, once TestFlight signing is set up (`docs/release.md`), on the
iPhone. Record results in the tables at the bottom and report them back (no screenshots of
anything personal; don't paste real hostnames or IPs, write e.g. "tailnet IP" or
"MagicDNS name").

## Before you start

- The phone is on the tailnet (Tailscale app connected) or on the same LAN as the server.
- Your Guacamole server URL works in the phone's browser over `http://`.
- Use the low-privilege test account (PLAN U1), not your admin account.

## Install: Android (nightly APK)

1. On the phone, open
   <https://github.com/testyfishy/OpenMobileGuac/releases/download/nightly/OpenMobileGuac-debug.apk>
   in Chrome (or open the release page
   <https://github.com/testyfishy/OpenMobileGuac/releases/tag/nightly> and tap
   `OpenMobileGuac-debug.apk`).
2. When Chrome warns that the file may be harmful, tap **Download anyway**.
3. Open the download. If asked, allow **Install unknown apps** for Chrome
   (Settings → Apps → Chrome → Install unknown apps → Allow), then go back and tap
   **Install**. Play Protect may warn about an unknown developer: **Install anyway**.
4. If the install fails with "App not installed as package conflicts with an existing
   package", the signing key changed (see `docs/release.md`, "Debug signing"): uninstall
   OpenMobileGuac and install again.
5. Note the build: Settings → Apps → OpenMobileGuac → version / build number, or the
   commit shown on the release page.

## Install: iPhone (TestFlight)

Needs the one-time setup in `docs/release.md` ("One-time Apple setup") and a green
**iOS** workflow run that includes the "Sign and upload to TestFlight" step.

1. Install **TestFlight** from the App Store.
2. Accept the internal-testing invitation (email, or it appears in TestFlight if you're
   signed in with the same Apple ID as App Store Connect).
3. In TestFlight, tap OpenMobileGuac → **Install**.
4. On first connection iOS may ask to **find and connect to devices on your local
   network**: tap **Allow**, and note whether it asked.

## Pass criteria

Do each step on each phone. A criterion passes only if every step in it works.

### 1. Login and connection list over `http://`

- [ ] Add the server using its `http://` URL with a tailnet IP.
- [ ] Log in with the test account; the connection list appears.
- [ ] Repeat with the MagicDNS name (`http://<name>.<tailnet>.ts.net:<port>/…`).
- [ ] Repeat with a LAN address, if the server is reachable on the LAN.
- [ ] Wrong password shows an error rather than hanging.

### 2. A session displays and stays connected for 10 minutes

- [ ] Open an RDP (or VNC) connection; the remote desktop appears.
- [ ] Leave it open, screen on, for 10 minutes, moving the pointer now and then. It is still
      connected and responsive at the end.
- [ ] Note whether it survives the phone screen locking for ~30 s (informational, not
      a pass criterion).

### 3. Soft keyboard

- [ ] The keyboard rises when requested.
- [ ] Letters (lower and upper case) arrive correctly in a remote text editor.
- [ ] Backspace deletes, including on an empty field and when held down.
- [ ] Enter produces a newline / submits.
- [ ] Swipe typing / predictive text: note what arrives (informational).

### 4. Clipboard

- [ ] Copy text on the phone, use the app's paste action: it appears on the remote.
- [ ] Copy text on the remote: it can be pasted in another phone app.

### 5. Pinch zoom

- [ ] Pinch zoom in and out of the display is smooth (no obvious stutter or lag).
- [ ] Panning while zoomed is smooth.

## Results

| # | Criterion | Android (model, OS) | iPhone (model, iOS) | Notes |
|---|---|---|---|---|
| 1 | Login + list over http (IP / MagicDNS / LAN) | | | |
| 2 | Session 10 minutes | | | |
| 3 | Soft keyboard | | | |
| 4 | Clipboard both ways | | | |
| 5 | Pinch zoom smooth | | | |

Build tested: Android nightly run # ____ · iOS TestFlight build # ____

Did iOS show the local-network permission prompt? ____ (for which address type?) ____

If 1 or 2 fail, PLAN says do T0.7 (native tunnel bridge). If 3 fails on iOS with no
workaround, or 5 fails badly, stop and revisit SPEC §8.1.
