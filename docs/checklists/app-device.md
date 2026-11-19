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

## Other

- [ ] Haptics on connect, favourite, success/failure (when the device has haptics enabled).
- [ ] Swipe a connection row left: favourite and details actions; vertical scrolling unaffected.
- [ ] Pull to refresh the connection list.
- [ ] Thumbnails appear in "Jump back in" and Recent after using a session; turning the
      setting off deletes them; deleting a server deletes its thumbnails.
- [ ] Spanish device language shows the Spanish chrome; Settings › Language overrides it.
- [ ] Certificate errors on an HTTPS server with a private CA show the specific guidance.
