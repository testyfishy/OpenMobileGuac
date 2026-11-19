# Device testing: where to start

Nothing in the app has been tested on a phone or against a real Guacamole server yet. Test
in this order: each step only makes sense once the one before it works. The three
checklists hold the detailed items; this page only sets the order. Record failures with
device, OS version, keyboard app and build, and never paste real hostnames, IPs or
screenshots with personal data (write "tailnet IP", "MagicDNS name").

## 1. 15-minute smoke test (no server needed)

On the Android phone (and the iPhone once TestFlight works):

1. Install the nightly APK (`phase0.md` › "Install: Android").
2. Open the app; on the server list choose **Demo**, then **Demo desktop**.
3. **Keyboard**: tap the keyboard button, type into the demo text editor; try Backspace,
   Enter and the key bar (Ctrl, Esc, arrows).
4. **Both pointer modes**: in direct mode tap, long-press (right click) and drag; switch to
   trackpad mode and move, tap, two-finger tap.
5. **Paste both ways**: copy text on the phone and paste into the demo; copy in the demo and
   paste on the phone (watch for OS paste prompts).
6. **Zoom**: pinch in and out, pan, then return to Fit screen.
7. More sheet › **Back to connections**: the session stays open; reopen it from the
   indicator at the bottom.

If any of this fails, stop and report it: the remaining lists depend on it.

## 2. Real server (gate G0)

`phase0.md`: reach your Guacamole server over the tailnet or LAN, sign in with the
low-privilege test account, open one RDP or VNC connection, and fill in its results table.

## 3. The long lists

- `session-device.md` (gate G1): soft keyboards and IMEs, key bar, clipboard, gestures,
  rotation and folding, connection state, then the session features (credential prompt,
  audio, files, lifecycle).
- `app-device.md`: app lock, stored TOTP seed, several sessions and background behaviour,
  token expiry during a session, backup and share sheet, deep links, share links, SSO,
  private CA, keep-awake.

Run the session list first; app-level items such as background disconnect and token expiry
assume sessions already work.
