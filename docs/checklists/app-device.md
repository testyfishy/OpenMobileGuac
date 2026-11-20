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

## Stored TOTP seed (SRV-9)

- [ ] Edit server › Stored two-factor key is unavailable until the lock is on.
- [ ] Paste a Base32 key and an `otpauth://` link: the live code matches an authenticator app.
- [ ] Sign-in to a TOTP server fills the code, shows the countdown, and is accepted.
- [ ] Immediately signing in again waits for the next code ("That code was just used").
- [ ] Turning the lock off offers to delete stored keys and does.

## Sessions and lifecycle (MUL-1, T2.1)

- [ ] Open three sessions; a fourth asks to close the oldest. Switcher lists all; switching
      keeps each remote screen at its size (no resize flash on the remote).
- [ ] Hardware keyboard typing reaches only the visible session.
- [ ] Android back in a session: Keep open / Disconnect / Cancel.
- [ ] Background > grace period (default 60 s): on return the session shows "Disconnected to
      save battery"; Reconnect works. "Never" keeps it connected as long as the OS allows.
- [ ] Let the server token expire while a session is suspended (or sign out on the server):
      Reconnect signs in silently with the saved password, or asks to sign in again.
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
