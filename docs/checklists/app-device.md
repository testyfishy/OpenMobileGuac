# App shell — on-device checklist

Things that cannot be verified in a desktop browser. Run on a real iPhone and Android phone
(and a tablet for two-pane). Use a test server and test account only.

## App lock and privacy screen (SRV-6)

- [ ] Settings › Security › "Require Face ID / fingerprint / device passcode": turning it on
      shows the system prompt first; cancelling leaves it off.
- [ ] With no passcode/biometrics enrolled, the toggle is disabled with the explanation.
- [ ] Cold start with the lock on: lock screen, prompt appears automatically, unlock works.
- [ ] Background for less than / more than the "Lock after" time: locks only after it.
      "Immediately" locks on every return.
- [ ] Android: the biometric prompt itself does not cause a lock loop.
- [ ] App switcher shows a blurred (iOS) / dimmed (Android) snapshot while the lock is on;
      screenshots are blocked on Android. Normal again when the lock is off.
- [ ] Opening a server with a saved password asks to unlock (unless just unlocked);
      cancelling shows the sign-in form with "Saved credentials were not used…".
- [ ] iOS: Face ID permission prompt shows the `NSFaceIDUsageDescription` text.

## Settings per connection (SET-2)

- [ ] In a session, tap the pointer button: the note "Saved for this connection. Other
      connections keep their own setting." appears once (OK dismisses it); a later change, or
      another connection, does not show it again.
- [ ] Settings › Connections lists that connection under its server with "Trackpad" (or the
      mode chosen); other connections say "Uses the defaults". Works with the server signed out
      and in airplane mode.
- [ ] Settings › Pointer & touch says "1 connection has its own values here" and lists it next to
      Pointer mode; the link opens the filtered list.
- [ ] More › "All settings for this connection": the editor opens over the app, the session stays
      open; change Pointer mode there, "Back to the session" (or hardware back): the session
      uses the new mode without reconnecting.
- [ ] "Use default" on a value and "Reset all for this connection" (confirm) take effect in the
      open session too.
- [ ] Connection details › "Settings for this connection" and Edit server › "Defaults for this
      server" open the same editor; the server's quick options show the new values afterwards.
- [ ] With TalkBack / VoiceOver: "Use the default for Pointer mode" is announced.

## Stored TOTP seed (SRV-9)

- [ ] Edit server › Stored two-factor key is unavailable until the lock is on.
- [ ] Paste a Base32 key and an `otpauth://` link: the live code matches an authenticator app.
- [ ] Sign-in to a TOTP server fills the code, shows the countdown, and is accepted.
- [ ] Immediately signing in again waits for the next code ("That code was just used").
- [ ] Turning the lock off offers to delete stored keys and does.

## Sessions and lifecycle (MUL-1, T2.1)

- [ ] Open three sessions; a fourth asks to close the oldest. Switcher lists all; switching
      keeps each remote screen at its size (no resize flash on the remote).
- [ ] MUL-4: tap a connection that is open (it shows "Open"): with Settings › Sessions ›
      "When a connection is already open" = Ask, "<name> is already open" appears; Go to the
      open session shows it, Open another adds a second one (on RDP note whether the first
      is signed out). Tick "Don't ask again" + Go to: the next tap goes straight there and the
      setting shows "Go to the open session". With a session "Disconnected to save battery",
      Go to reconnects it instead of opening a duplicate. Same from "Jump back in".
- [ ] MUL-5 (real server, non-admin account): open a connection, then force-quit the app (or
      sign out of it on the server side) so the session stays on the server. Reopen the app
      and sign in: the connection shows "In use", and back on the server list its "Jump back
      in" card too (only once signed in; never a sign-in just for it). Tap it: "<name> is already
      in use" with "You, since …". Open the existing one joins it (note how long it lasts
      once the old tunnel times out, ~15 s on iOS, and what the next tap on the connection does
      then: with "Go to the open session" it returns to that joined session). Repeat and choose End it and start fresh:
      the old session disappears from the web client's Active Sessions and a new one opens;
      no other user's session is touched. Open another starts a second session. With another
      user's session on the connection: only Open another / Cancel and "Another user". With
      "Always": a free connection asks "Connect to <name>?". With the server unreachable or
      slow, the tap still connects within about 2 s. An app link confirmed in "Open … on …?"
      asks nothing more. Pull to refresh and returning from a session update the badge.
- [ ] Hardware keyboard typing reaches only the visible session.
- [ ] Android back in a session: Keep open / Disconnect / Cancel.
- [ ] Background > grace period (default 60 s): on return the session shows "Disconnected to
      save battery"; Reconnect works. "Never" keeps it connected as long as the OS allows.
- [ ] Let the server token expire while a session is suspended (or sign out on the server):
      Reconnect signs in silently with the saved password, or asks to sign in again.
- [ ] On a 1.5.x server (no `HEAD api/session`) **without** a saved password: background > grace period, return, Reconnect: it reconnects with no password prompt (the token is
      confirmed with `POST api/tokens`; the log shows `reconnect: ok`).
- [ ] Settings › "Sign out of servers after …" = 1 min: background 2 min, return: sessions are
      closed and the server asks for the password (with the "Signed out because…" notice) even
      though it is saved; after signing in, the saved password is used silently again. Same
      after swiping the app away for 2 min and reopening it. Default "Never": no prompt.
      (These two timers wait while an iOS Picture in Picture window is open: see the Picture
      in Picture items in session-device.md. Run them with that setting off.)
- [ ] Token expiry during a **live** session: on a test server, invalidate the app's token
      (e.g. restart the Guacamole web application, which drops all tokens), then drop the
      connection (airplane mode on/off) so the session reconnects. The
      session signs in again silently and reconnects; with the app lock on, the unlock prompt
      appears first; on an `http://` server without consent it asks to sign in again instead.
- [ ] Session More sheet › "Back to connections" keeps the session open; the bottom
      indicator reopens it. No floating pill covers the remote desktop's top-right corner.
- [ ] Screen stays on during a session (native keep-awake plugin); after switching between
      two sessions it still stays on; after leaving the last session it sleeps normally.

## Backup, share sheet, deep links

- [ ] Settings › Back up and restore › Export opens the share sheet with a `.json` file;
      saving to Files / Drive works. Restore picks it from the file picker.
- [ ] Encrypted export with passphrase restores passwords on another device.
- [ ] Connection details › Copy app link; opening `openmobileguac://connect?server=…&connection=…`
      from Notes/Shortcuts (iOS) or a launcher/browser (Android) opens the connection,
      signing in first if needed. Unknown server shows a message.
- [ ] Diagnostics › Share log opens the share sheet; Copy log copies.

## SSO (experimental, see docs/sso.md)

- [ ] OpenID server, in-app browser mode: IdP page opens, sign-in completes, connections load
      (or the "race" message appears — note how often).
- [ ] OpenID with `openmobileguac://sso-callback` allowed at the IdP, app-callback mode:
      system browser opens, returns to the app, signs in.
- [ ] SAML and CAS servers, in-app browser mode.

## Server management (ADM-1…ADM-6)

Use an administrator account on your own server and a throwaway test connection and folder.
Compare each step with the Guacamole web client (Settings › Connections).

- [ ] As an administrator: "+" is in the connection list header, folders have an edit button,
      and a connection's details show "Manage on server".
- [ ] New folder "App test" at the top level: it appears (even while empty), also in the web client.
- [ ] New RDP connection "App test RDP" in that folder with hostname, port, username and
      password: the web client shows the same parameters (password included).
- [ ] Edit it: change one parameter (e.g. enable wallpaper), save, check the web client, reopen
      the editor: the value is marked as set.
- [ ] Back with unsaved changes asks before discarding.
- [ ] Searching "wallpaper" in the editor finds the field; labels are readable (server
      translations or names).
- [ ] Apply "Low bandwidth": the dialog lists exactly what changes; save and connect. The
      session uses fewer colours and shows no wallpaper. Note how it feels on mobile data.
- [ ] Clone it: the copy is "Copy of …", says which passwords were copied, and saves as a new
      connection; the original is unchanged.
- [ ] Move the copy to the top level, then move the folder; a folder cannot go into itself.
- [ ] Delete the copy, then the folder: the confirmation says it is permanent (and, for the
      folder, that its contents go too). Both disappear from the web client.
- [ ] Sessions and history: while connected from another device, that session is listed and
      Disconnect ends it.
- [ ] A read-only account sees no management actions.
- [ ] Revoke a right in the web client while the app is open, then try a change: the app
      explains the refusal, hides the actions and stays signed in.
- [ ] Diagnostics log after these steps: no parameter values or passwords appear.

## Other

- [ ] Haptics on connect, favourite, success/failure (when the device has haptics enabled).
- [ ] Swipe a connection row left: favourite and details actions; vertical scrolling unaffected.
- [ ] Pull to refresh the connection list.
- [ ] Thumbnails appear in "Jump back in" and Recent after using a session; turning the
      setting off deletes them; deleting a server deletes its thumbnails.
- [ ] Spanish device language shows the Spanish chrome; Settings › Language overrides it.
- [ ] Certificate errors on an HTTPS server with a private CA show the specific guidance.
- [ ] Android: install the private CA on the phone (Settings › Security › Encryption &
      credentials › Install a certificate › CA certificate). Sign-in, connection list **and
      the session tunnel (WebSocket)** then work over HTTPS (docs/tls.md).
- [ ] Share link to a server that is also saved: the share opens as a separate "(shared
      link)" entry; afterwards the saved server is still signed in as you, with its own
      connections. The entry's close button, or restarting the app, removes it.
- [ ] File download / print job: the share sheet opens; after a few minutes (or the next
      app start) the copy in the app cache is gone (Android: Settings › Apps › storage).

## Background keep-alive, scheduled backups, sign out of all (MUL-3, SRV-12, SRV-13)

- [ ] Android 13+: Settings › Sessions › "Keep sessions connected in the background" shows the
      explanation, then the system notification prompt. Allow it.
- [ ] With a session open, switch to another app for 10 minutes (longer than the disconnect
      time) and turn the screen off: the notification "1 remote session connected" stays;
      returning shows the session still connected (no reconnect). Open a second session: the
      notification says 2.
- [ ] Notification › Disconnect all closes every session and the notification goes away.
      Closing the last session also removes it.
- [ ] Deny the notification permission: sessions still stay connected (no visible
      notification); Settings shows the explanation.
- [ ] Setting off: sessions disconnect after the grace period as before.
- [ ] If sessions still drop with the setting on, note the phone maker and whether setting
      the app's battery use to Unrestricted fixes it.
- [ ] iOS: the setting is disabled with the explanation; a session still disconnects after
      the grace period and Reconnect works.
- [ ] Backups › Automatic backups on (weekly): "Back up now" adds a file under "Backups on
      this device"; Share opens the share sheet; Restore loads it into the Restore section;
      Delete asks and removes it. With "Keep the most recent" at 2, a third backup removes the
      oldest.
- [ ] Set a backup passphrase: the next automatic backup says "with encrypted passwords";
      restoring it on another device with the passphrase restores saved passwords. With the
      app lock on, the backup that runs right after unlocking includes them.
- [ ] Change the phone's date forward 8 days and open the app: a new automatic backup appears.
- [ ] Settings › Security › Sign out of all servers: the dialog lists what is removed; confirm.
      Every server then asks for its password; open sessions closed; in the web client's
      active sessions the app's session is gone (for servers that were reachable). With
      "Remove servers too" ticked, the server list is empty afterwards.

## Content-Security-Policy (AUDIT §7 R9)

Release builds carry a strict CSP (`app/src/core/security/csp.ts`, injected into
`dist/index.html` by `vite.config.ts`). Checked in desktop Chromium only. Anything it blocks
is logged as a `[csp]` warning ("CSP blocked <directive>: <origin or keyword>") in
**Settings › General & about › Diagnostics**; check that screen at the end of each step.

- [ ] Cold start on iOS (current and the oldest supported iOS) and Android (current WebView):
      the server list appears. **Failure:** blank or white screen at launch (bridge or bundle
      blocked); connect Safari Web Inspector / `chrome://inspect` with an
      `OMG_DEBUG_WEBVIEW=1` build and look for "Refused to ..." console lines.
- [ ] Android with an old System WebView if one is available (an emulator image with the
      factory WebView, or WebView disabled/rolled back): the app still starts. On WebViews
      without `DOCUMENT_START_SCRIPT` Capacitor inserts its bridge as an inline script right
      after `<head>`, before the policy meta, which the policy does not cover (simulated in
      Chromium, not seen on a device).
- [ ] Plugin calls work: saved password (secure storage), biometrics, haptics, share sheet,
      clipboard, status bar colour. **Failure:** buttons that never finish or spinners that
      hang (bridge messages blocked).
- [ ] Sign in to a real server over https and over plain http, open a session (WebSocket
      tunnel `wss:` / `ws:`), and one with the HTTP tunnel fallback. **Failure:** sign-in
      "network error", or a session with no picture (`connect-src` / `img-src`).
- [ ] In a session: audio plays, the remote cursor image shows, a video stream (if the
      server sends one) plays, microphone works when enabled.
- [ ] Download a file from the remote and save/share it; upload a file.
- [ ] SSO sign-in in the in-app browser (native view, not covered by the page policy)
      returns to the app.
- [ ] Diagnostics shows no `[csp]` line after all of the above. Note any that appear.

If a TestFlight or APK build is broken by the policy, rebuild with `OMG_CSP=off npm run
build` and `npx cap sync` to confirm (docs/BUILDING.md §3.1); do not ship that build.

## Network (REST connection reuse, request volume, tunnel drops)

Settings › General & about › Diagnostics, level **Debug**. The report's first lines include
`Network: online; …; REST: native connection pool (keep-alive)` on iOS.

- [ ] iPhone, Wi-Fi then mobile data, a server on a non-standard https port: open the server.
      The `[http]` lines say `pooled`; after the first request to that server most say
      `reused connection`. **Failure:** `REST: CapacitorHttp (native pool unavailable)` (the
      native plugin method is missing) or every line `new connection` (no reuse).
- [ ] Open a server, connect, go back to the server list, connect again. No URL appears
      twice within a second in `[http]` lines (repeats say `shared with the one in flight` or
      `answered from cache`); the badge lookups (`connections/{id}`) do not run while a
      session is in front or the app is in the background.
- [ ] Server with two data sources where one is slow or broken: the list of the other one
      shows within about 4 s, with "Some connections could not be loaded (…)" and Retry; a
      slow one fills in by itself later.
- [ ] After a minute in the background, open a server: the first `[http]` line does not take
      much longer than the others (a dead kept-alive connection is replaced, not waited on).
- [ ] Lock on, session open, switch to another app for 30 s and back: the log shows
      `Tunnel unstable (no instruction for … ms; background, …)`, a `[tunnel] WebSocket closed:
  code …` line, **one** `reconnect attempt 1 of 4` line, `Connect held until the app is
  unlocked`, then after Face ID a single new connect. Note the close code (1006 = network
      drop; a number as reason = Guacamole status from the server).
- [ ] Session in front on Wi-Fi for 10 minutes without touching it: no `Tunnel unstable`
      lines with `foreground, session shown`. If there are, note the ms value and the close
      code that follows.

## Re-test after the audit fixes (2026-11-21)

Nothing below has run on a device. iPhone first, then Android.

**App lock (AUDIT #3)**

- [ ] Lock on, cold start: the lock screen is the first thing drawn (no flash of the server
      list or of a session).
- [ ] Lock on, "Lock after" set to 5 min: background for 10 s and return. The app is
      hidden while away (blank cover), then shows again **without** a prompt.
- [ ] Lock on, background for longer than "Lock after": the lock screen is drawn first on
      return, before any session frame.
- [ ] Cancel the Face ID prompt 3 times: the app stays locked; "Try again" works; there is
      **no** "turn off the lock" button.
- [ ] Turn the device passcode off (or remove all biometrics) with the lock on, then
      relaunch: the app stays locked and says biometrics/passcode are not available.
      "Remove saved sign-ins and turn off the lock" asks first, then closes sessions and
      deletes passwords, tokens and TOTP keys; servers and settings stay.
- [ ] Settings › Security: turning the lock **off** asks for Face ID / passcode first;
      cancelling leaves it on.
- [ ] While locked, open an `openmobileguac://connect?...` link from Notes: nothing
      connects until unlocked; after unlocking, "Open … on …?" appears.
- [ ] While locked, with a session open, turn Wi-Fi off and on: the session does not
      reconnect (no token use) until unlocked, then reconnects.
- [ ] Automatic backup due while locked: not written until unlocked.

**Servers, links, backup (AUDIT #1, #2, #11, §3 #8, #9)**

- [ ] Edit a server with a saved password, change the host: a dialog shows old → new
      address. After "Change address" the server list asks for the password again; the
      old host's session ended (Active Sessions on the old server).
- [ ] Add a server as `host:8443` where https fails: the error shows with "Use http
      instead — not encrypted"; nothing appears in the http server's access log before
      tapping it.
- [ ] Deep link to a saved server: "Open <connection> on <server>?" with "Don't ask again for
      links to this server"; the server options show "Ask before app links connect".
- [ ] Share link to an `http://` server: the plain-http warning appears before sign-in.
- [ ] Restore a backup where one server's address was edited (keep the id): the summary
      says it was added as a new server without saved passwords; the old server keeps its
      sign-in; nothing is sent to the edited address before signing in there.
- [ ] Delete a server while signed in, with the server offline: the screen returns at once.

**Android backup and thumbnails (AUDIT #12)**

- [ ] `adb shell bmgr backupnow <package>` reports nothing backed up; a device-to-device
      transfer to a new phone carries no OpenMobileGuac data.
- [ ] Thumbnails still appear in "Jump back in" after reopening the app; "Clear cache" in
      Android app info removes them; turning thumbnails off removes them.
