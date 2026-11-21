# Session screen: on-device checklist

For the owner, on real devices. Covers what a desktop browser cannot verify: the soft
keyboard, OS paste prompts, real multi-touch, rotation and folding. Run each section on an
iPhone and an Android phone (plus a tablet/foldable where noted), once in the installed app
and once in the mobile browser via the dev URL. Use a throwaway remote desktop with nothing
personal on screen.

Record failures as `T1.x-fix` tasks with device, OS version, keyboard app and app/browser.

## Setup

- [ ] Connection opens; the "Connecting…" overlay is replaced by the desktop.
- [ ] Whole desktop visible in portrait (Fit screen); no page scroll or bounce anywhere.
- [ ] Screen stays awake during a 3-minute idle session (Keep awake on).

## Soft keyboard (KEY-1, KEY-2): iOS and Android

- [ ] Toolbar > Keyboard raises the keyboard on the first tap, in direct and trackpad mode.
- [ ] Dismiss with the system control (iOS: swipe/Done, Android: back or the hide key), then
      tap Keyboard again: it comes back on the first tap.
- [ ] The page does not zoom or scroll when the keyboard opens (iOS especially).
- [ ] The desktop does not shrink when the keyboard opens; the key bar sits above the keyboard
      (with the toolbar docked at the bottom: keyboard, then toolbar row, then key bar; other
      styles: right above the keyboard); the area near the pointer/last tap stays visible
      above them (DSP-5).
- [ ] Letters, digits and punctuation arrive correctly in a remote text editor, including a
      mixed-case password like `Ab3$xY9!`.
- [ ] With Settings › Keyboard & keys › Typing › "Autocorrect" and "Capitalise sentences"
      off (the default): autocorrect, auto-capitalise and suggestions do not change what
      reaches the remote (type `teh`, `i`, `hello.` + space: the remote shows exactly that).
- [ ] With "Autocorrect" on: `teh` + space becomes `the ` on the remote (sent as Backspaces
      and the retyped word), and a double space gives a full stop. With "Capitalise
      sentences" on: the first letter of a sentence is capitalised. A click on the desktop or
      a key bar key starts a fresh sentence (no correction reaches back across it). Set on one
      connection only: another connection keeps both off.
- [ ] Backspace deletes one character; holding Backspace repeats; Backspace in an empty field
      still deletes on the remote.
- [ ] Enter / Return sends Enter (new line in an editor, submits a form).
- [ ] Android: swipe/glide typing a few words gives the right words with single spaces.
- [ ] Android Gboard: tapping a suggestion replaces the word correctly on the remote.
- [ ] IME: Japanese (or Chinese pinyin) composition, convert, commit: the final text is right.
- [ ] iOS: dictation inserts text (note whether it works; not required).
- [ ] Tapping the desktop or the key bar while typing does not close the keyboard.
- [ ] Rotating with the keyboard open keeps typing working.
- [ ] Hardware keyboard (tablet, S5): letters, arrows, Ctrl+C / Ctrl+V, Alt+Tab, Esc reach
      the remote; no key is sent twice; no key stays stuck after switching apps.

## Toolbar and keyboard (toolbar styles, keyboard dismissal)

Defaults: toolbar docked at the bottom, swipe-down on the key bar on, tap-to-hide off. Change
them in Settings › Session defaults, or for one connection in More › Session options.

- [ ] Docked bottom (default), portrait: a static row above the home indicator; nothing of the
      desktop is under it (the desktop is fitted above it); no gap below the bar.
- [ ] Docked bottom, keyboard up: the row sits right above the keyboard with the key bar
      above it; all buttons reachable; the desktop does not shrink or jump in size.
- [ ] Docked top: the row sits below the notch / status bar; the desktop starts below it;
      toasts and the Demo badge are not hidden behind it.
- [ ] Landscape: Left and Right put a column at that edge (the desktop fits beside it; the key
      bar is a column too on phones, see "Key column in landscape", or spans the rest with
      Extra keys in landscape = Bottom row); in portrait they fall back to the bottom row.
- [ ] Floating: the old collapsible bar still works (hide, handle, auto-hide after 5 s; no
      auto-hide while the keyboard is up; immersive turns the handle into an edge grip).
- [ ] More › Toolbar buttons: add Files and Disconnect, move them, remove one, "Reset to
      default"; the row follows at once; Disconnect asks for a second tap.
- [ ] Labels: Auto hides them in landscape on a phone; Always keeps them; Icons only hides
      them everywhere.
- [ ] Keyboard button shows its "on" state while the keyboard is up and hides it on a tap,
      in every style.
- [ ] The key bar's accent "hide keyboard" key (right edge) is always visible, even with the
      Fn rows or after scrolling the row sideways; tapping it hides the keyboard and the key
      bar, and the desktop re-fits with no empty band.
- [ ] Swipe down on the key bar hides the keyboard; with the keyboard hidden it hides the
      key bar. A sideways swipe still scrolls the keys and does not press one.
- [ ] Turn on "Tap the desktop to hide the keyboard": a tap on the desktop with the keyboard
      up hides it (and clicks). Off (default): a tap only clicks.
- [ ] More sheet: switches (Keyboard, Extra keys, Natural scrolling, Large cursor, Split
      layout, Full screen, Sound) apply at once and keep the sheet open; every sheet closes
      with ✕, a tap outside, or a swipe down on its title.
- [ ] Settings › Session defaults: change the toolbar style and a slider; open a connection
      you never changed: it uses them. In a connection you changed, Session options shows
      "Custom for this connection"; "Use app default" switches it back.
- [ ] Settings › About › Demo server in the list: Automatic hides the Demo once a server is
      saved; Show brings it back; onboarding's "Try the Demo" still opens it.

## Key bar and combos (KEY-3, KEY-4, KEY-5)

- [ ] Toolbar > Keys shows the key bar with the keyboard hidden: above the docked toolbar row
      (bottom dock), or above the gesture bar / home indicator (other styles); the chevron at
      the right hides it.
- [ ] Ctrl tap (one-shot, outlined) + `c` on the soft keyboard copies on the remote; Ctrl
      then turns off by itself.
- [ ] Shift double tap locks (filled); arrows extend a selection; third tap unlocks.
- [ ] Esc, Tab, arrows, Home, End, PgUp, PgDn, Del each work; Fn shows F1–F12 and the row
      scrolls sideways.
- [ ] Combos: Ctrl+Alt+Del, Alt+Tab, Win, Win+D, Ctrl+Shift+Esc each do the expected thing
      on a Windows remote (S1).
- [ ] Add a custom combo (e.g. `Ctrl+Shift+T`), reorder, delete; leave and reopen the
      connection: the list is remembered and the combo fires.

### Key column in landscape (KEY-5, "Extra keys in landscape")

Default: Free side. Phone only (a tablet, portrait and the split layout keep the bottom row).

- [ ] iPhone landscape, toolbar defaults (docked, side away from the camera): open the
      keyboard. The keys are a column on the camera side, the toolbar on the other side; the
      desktop is not pushed up (its top stays where it was) and nothing covers it.
- [ ] Rotate the phone the other way (camera on the other side): toolbar and column swap sides.
- [ ] The column's keys never sit under the Dynamic Island / punch-hole; on the side without
      the cutout the column hugs the edge (narrow margin), as the side toolbar does.
- [ ] Keyboard up: the column ends right above the keyboard and scrolls vertically, with a fade
      at the edge that has more keys; set button and accent "hide keyboard" stay pinned at the
      bottom and reachable; every key is at least a finger wide.
- [ ] Scrolling the column up and down never hides the keyboard or presses a key; a swipe
      towards the screen edge hides the keyboard (with the keyboard hidden: the column).
- [ ] Ctrl tap + `c` copies; Shift double tap locks; arrows, combos, text and saved-combo keys
      work; Fn shows F1–F12 right below the Fn key without widening the column.
- [ ] Set button: tap = next set (toast), hold = list. Long labels wrap inside the column.
- [ ] Toolbar > Keys with the keyboard hidden: the column shows down to the home indicator;
      the desktop fits beside it; hiding it restores the full width.
- [ ] Keyboard open / close several times with "Match device size" on: no resize is sent while
      the keyboard opens or is up (session log), and the remote ends at the same size each time.
- [ ] Session options › Extra keys in landscape: Bottom row brings back the old row; Left /
      Right put the column there, next to a toolbar docked on the same side (toolbar at the
      edge, keys beside it, the desktop fitted beside both).
- [ ] Toolbar floating or docked top / bottom ("Keep in place"): the column goes to the side
      away from the camera; the floating bar / bottom row and sheets stay clear of it.
- [ ] Portrait, a tablet in landscape and the split layout: unchanged bottom row.

## Clipboard (CLP-1..CLP-4)

- [ ] iOS: no "Allow Paste" prompt appears when connecting, rotating or returning to the app
      (with auto-send off).
- [ ] Copy a URL on the phone, focus a field on the remote, tap Send: the URL arrives (S2),
      pasted once ("Send also pastes" is on by default; with it off, press Ctrl+V on the
      remote yourself). iOS shows the paste prompt only now, after the tap.
- [ ] Long-press Send (or Combos > Type clipboard): the text is typed on a connection with
      `disable-paste` set (CLP-3).
- [ ] Copy text on the remote: it lands on the phone clipboard (toast shown); with "remote to
      device" off it does not.
- [ ] Auto-send on foreground on: switch to another app, copy, come back: sent once, and a
      second return without a new copy does not resend.
- [ ] "Send also pastes" (Settings › Sessions › Clipboard, on by default): copy text on the
      phone, focus a text field on the remote, tap Send: the text appears without pressing
      Ctrl+V; the toast says "Sent and pasted N characters". Check on a **Windows** remote (RDP,
      Notepad), a **Linux desktop** (VNC or RDP, a text editor) and an **SSH terminal**
      (Ctrl+Shift+V is pressed; on a connection with `disable-paste` the terminal pastes its
      own buffer, so turn the setting off there). A **Mac** remote needs ⌘V, which is not
      pressed: not covered. Note whether 150 ms is enough on a slow link (stale clipboard
      pasted).
- [ ] With the setting off, Send only sends (toast "Paste on the remote"). With View only on,
      nothing is pasted. Auto-send on foreground / on connect and Type clipboard never paste.

## Gestures: direct mode (PTR-1)

- [ ] Tap clicks exactly under the finger; double tap opens a desktop icon.
- [ ] Long press gives a haptic, right-click menu appears on release; long press then move
      drags (selects text) without a context menu.
- [ ] One-finger drag pans when zoomed in, with momentum; it stops at the desktop edges.
- [ ] Two-finger drag scrolls a remote page (content follows the fingers).
- [ ] Pinch zooms smoothly around the fingers (60 fps feel on a mid-range phone at a 1080p
      remote); View > Reset zoom returns to the mode's framing.

## Gestures: trackpad mode (PTR-2, S4)

- [ ] Toolbar mode button switches with a toast; the cursor is visible and in view.
- [ ] One-finger move moves the pointer; slow moves are precise enough to hit a small
      checkbox; fast flicks cross the screen.
- [ ] Tap = left click, two-finger tap = right click, three-finger tap = middle click.
- [ ] Double-tap-and-hold then move drags a window; release drops it.
- [ ] Zoomed in, moving the pointer to the edge pans the view (follow pointer).
- [ ] The server cursor shape (I-beam over text, resize arrows) is shown; on a connection
      without cursor updates a fallback arrow is shown.
- [ ] Haptics on click / right click / drag start; none with Haptics off.

## Display, rotation, fold (DSP-1..DSP-4, DSP-7, S3)

- [ ] Each View mode (Fit screen / width / height / 1:1) frames as named in portrait and
      landscape.
- [ ] Rotate both ways mid-session: re-lays out without reconnecting; un-zoomed view re-fits.
- [ ] Foldable: unfold and fold mid-session; split-screen / resize the app window on Android:
      no reconnect, content re-fits.
- [ ] Notch / punch-hole / home indicator never cover the toolbar or key bar.
- [ ] Match device size on (RDP with display update): after rotation the remote resizes to
      fill the screen with no letterboxing.

## Foldables (DSP-3, DSP-8): iPhone Duo, Galaxy Z Fold, Pixel Fold

Reference sizes (CSS px / points; derived, not published by Apple): iPhone Duo outer screen
about 466×678, inner screen about 669×951 (Apple's screenshot specification: 1398×2034 and
2007×2853 px at 3x). Write down what Diagnostics shows (screen and viewport) on each screen.

- [ ] iPhone Duo: the build was made with Xcode 27.1 / the iOS 27.1 SDK or later. Apple: apps
      built with Xcode 26 or earlier do not extend under the status bar and camera, so the
      app cannot fill the screen whatever the web layer does. (CI uses `macos-26`, Xcode 26.x,
      at the time of writing.)
- [ ] Every screen of the app (server list, settings, a session) fills the outer screen and
      the inner screen edge to edge, in portrait and landscape: no black bands, no
      letterboxed "compatibility" frame, nothing under the camera or the side status bar.
- [ ] Outer screen: the status bar and camera sit at one side (iPhone Duo, also in
      portrait). The toolbar, key bar and sheets stay clear of them; record which side
      `safe-area-inset-*` reports.
- [ ] Session open on the outer screen, unfold: no reconnect; the desktop re-fits the inner
      screen within a second; with Match device size on, the remote resizes to the new
      area (no bands). Fold again: back to the phone layout and size.
- [ ] Phone layout on the outer screen in landscape (side toolbar, key column per
      "Docked toolbar in landscape" and "Extra keys in landscape"); tablet layout on the
      inner screen (toolbar where Toolbar style puts it, key bar as a row).
- [ ] Unfold and fold with the soft keyboard up: the layout switches at once; the remote
      resize, if any, follows when the keyboard closes.
- [ ] Rotate the open device both ways: re-lays out; note whether the inner screen honours
      the app's orientations (Apple's guidance contradicts itself on this).
- [ ] Book pose (partly folded, hinge vertical): the desktop stays one picture across the
      fold; the split layout does not turn on by itself. Note whether the WebView reports
      viewport segments or a device posture (Diagnostics, or Safari Web Inspector:
      `window.viewport?.segments`, `navigator.devicePosture?.type`,
      `matchMedia('(horizontal-viewport-segments: 2)').matches`). On iOS 27.1 these are
      Safari feature flags, off by default.
- [ ] Laptop / tabletop pose (open device turned so the hinge runs across, partly folded):
      with Split layout on Auto, the split turns on only where the system reports the fold;
      the desktop ends at the hinge and the trackpad starts below it.
- [ ] Split View on the inner screen (two apps side by side): a half-width window gets the
      phone layout and the desktop fills it.
- [ ] Android book foldables: the same steps; also that the activity is not recreated on
      fold (no reconnect; `configChanges` includes `screenSize|smallestScreenSize|screenLayout`).

## Connection state (DSP-9)

- [ ] Airplane mode for 5 s: "Reconnecting…" overlay, then the session resumes by itself.
- [ ] Wrong/removed connection: a readable error with Retry and Close.
- [ ] Exit (tap twice) returns to the connection list; the remote session is closed.

## Input pass (tap latency, settings, keyboard robustness): needs a real device

### Taps and gestures

- [ ] Direct mode: a slow tap (finger held ~0.4 s, not moved) still clicks; there is no
      "nothing happens" zone between a tap and a long press.
- [ ] Trackpad mode: a single tap feels instant (a button reacts on press at once; a link
      that opens on release may lag by up to the double-tap time).
- [ ] Trackpad: tap, then touch again and drag a window by its title bar: the window moves
      and does NOT maximise; text selection by tap-and-a-half selects by character, not by
      word (the remote must not see a double click).
- [ ] Trackpad: double tap opens a desktop icon.
- [ ] Input options > Tap and a half to drag off: taps are instant complete clicks; long
      press still drags.
- [ ] Two-finger tap = right click and three-finger tap = middle click in both modes (direct:
      at the fingers' centre). A hurried two-finger double tap gives one context menu only.
- [ ] Three-finger double tap resets the zoom in both modes, with no middle click.
- [ ] Direct mode, whole desktop visible: one-finger drag drags (e.g. selects text, moves a
      window) at once. Zoomed in: it pans (or drags with "Drag on the remote").
- [ ] Horizontal two-finger drag scrolls sideways in a wide spreadsheet / browser page
      (Shift + wheel); a mostly vertical drag never scrolls sideways. The switch turns it off.
- [ ] Trackpad: pinch to zoom away from the pointer, then tap: the pointer first jumps to
      the nearest visible spot, then clicks there.
- [ ] Input options timing sliders (long press, double tap, tap tolerance) change the feel
      at once; leave and reopen the connection: they are remembered (this needs the app
      shell to store the new input fields; record it if they reset).

### Hardware keyboard, mouse and pen (tablet / Chromebook / DeX)

- [ ] Ctrl+C, Ctrl+V, Ctrl+Shift+T, Alt+Tab (Alt held across several Tabs), Alt+F4, Win.
- [ ] A lone Alt tap focuses the menu bar of a Windows app; Ctrl+click multi-selects files.
- [ ] AltGr characters on a non-US layout (`@`, `€`, `{`): exactly the character arrives,
      no Ctrl+Alt shortcut fires.
- [ ] Holding an arrow key repeats; no key stays stuck after switching apps or locking the
      screen.
- [ ] Caps Lock toggles on the remote; typed letters have the right case.
- [ ] Mouse: hover moves the pointer, left/middle/right and wheel work; horizontal wheel
      (tilt or trackpad) scrolls sideways; back/forward buttons go back/forward (Alt+Left /
      Alt+Right) and never leave the session.
- [ ] Input options > Pointer lock (trackpad mode, tablet with mouse): clicking captures
      the mouse; motion is relative; Esc releases it.
- [ ] Stylus: hover moves the pointer, tip = left click/drag at the tip in both modes,
      barrel button = right click.
- [ ] With a hardware keyboard and the on-screen keyboard hidden, nothing is padded at the
      bottom for a keyboard that is not shown.

### Soft keyboard robustness

- [ ] iOS: drag the space bar to move the cursor left inside the word you typed: the remote
      cursor moves left the same number of characters; typing continues there correctly.
- [ ] Autocorrect replacing a word (if enabled by the keyboard anyway), tapping a suggestion,
      dictation, and pasting into the keyboard's clipboard strip all produce the right text.
- [ ] Android keyboards that send key code 229 (Gboard, Samsung, SwiftKey): no doubled or
      missing characters; Backspace on an empty field still deletes on the remote.
- [ ] Input options > Commit on word: a word appears on the remote when space/punctuation is
      typed, on Enter from the key bar, or when tapping the desktop.
- [ ] Text input bar: type, dictate or paste into the visible field, Send types it; ⏎ sends
      it plus Enter.

### Key bar editor (KEY-7)

- [ ] Input options > Edit key bar: add a key and a saved combo, reorder, add/remove a row,
      Reset to default; the bar updates live and is remembered for the connection.
- [ ] Sticky Shift + "1" on the soft keyboard gives "!" on the remote (US and non-US remote
      layouts: note what a non-US layout gives).

### Touch pass-through (PTR-6, RDP with touch enabled)

- [ ] On an RDP connection with touch support, the pointer-mode button also offers
      Multi-touch; pinch zooms a Windows photo viewer; a two-finger scroll scrolls natively.
- [ ] Toolbar Zoom / Out buttons zoom the local view in that mode; leaving the app lifts all
      touches (nothing stays pressed on the remote).
- [ ] On a connection without touch support the mode is not offered.

### Cursor, split layout, immersive

- [ ] A remote app that hides its cursor: trackpad mode still shows the fallback arrow;
      direct mode shows none. Large cursor makes it bigger with a contrasting outline.
- [ ] Foldable in tabletop posture: with Split layout "When folded" the display sits on the
      top half and a trackpad + key bar on the bottom; unfolding returns to normal.
- [ ] Split layout "On" on a phone/tablet: the trackpad area drives the pointer (move, tap,
      tap-and-a-half drag, two-finger scroll) while the display area keeps its mode.
- [ ] Immersive on: status bar hidden on iOS and Android (Android navigation bar too where
      the WebView allows full screen); the collapsed toolbar becomes a thin edge grip that
      still opens the toolbar.

## Session features (credential prompt, audio, files, lifecycle)

Use a test connection on a throwaway machine. Nothing here has been tried against a real
guacd yet; the browser harness (`app/src/ui/session/dev/harness.html?tunnel=features`)
only fakes the server side.

### Credential prompt (SRV-11)

- [ ] An RDP connection saved without username/password shows "Sign in to the remote
      computer" with Username, Domain (if requested) and Password; the password is masked
      and the eye button shows/hides it.
- [ ] Correct values connect. Wrong values end with "Sign-in failed" and no auto-retry.
- [ ] Cancel (or the close button, or Escape on a hardware keyboard) disconnects; Reconnect
      prompts again. Values are not pre-filled and do not appear in the app's diagnostics log.
- [ ] iOS / Android password manager offers to fill the fields (autocomplete hints).
- [ ] VNC connection without a stored password: the prompt asks for Password (and
      Username where the VNC auth type needs one). SSH without a stored password asks
      inside the terminal instead (guacd 1.6.0 behaviour), and typing there works.

#### Remembered answers ("Remember connection passwords", SRV-11)

- [ ] Default (On this device): the prompt shows "Remember for this connection", ticked, with
      "Until the app is closed, in memory only". Continue connects. Disconnect and open the
      connection again: no prompt. Send the app to the background for 30 s+ (iPhone: the
      tunnel drops) and come back: it reconnects without a prompt.
- [ ] Untick Remember, connect, disconnect, reconnect: the prompt appears again.
- [ ] Type a wrong password with Remember ticked: "Sign-in failed"; Reconnect prompts again
      (the wrong value was not remembered).
- [ ] Change the password on the remote computer, then reconnect: the remembered value is
      tried once, then the prompt appears (no reconnect loop). Note what guacd reports for
      RDP and for VNC (expected: the prompt, not repeated failures).
- [ ] 5 min: connect, wait 6 min with the app closed to the background, reopen: prompt.
      Use the session every few minutes for 10 min: no prompt (time counts from last use).
- [ ] Until closed: force-quit the app and reopen: prompt (nothing was written to disk).
- [ ] On this device, "Ask for … before filling" off: connect once, force-quit, reopen and
      connect: no prompt. With the app lock on, Face ID / fingerprint is asked first (unless
      just unlocked). Cancel it: the prompt appears instead.

#### Device check before filling ("Ask for Face ID / fingerprint …", SRV-11)

- [ ] Settings › Security: the toggle names the device's method (iPhone with Face ID:
      "Ask for Face ID …"; Touch ID; Android fingerprint; a device with only a passcode:
      "biometrics or the device passcode"). Spanish: same, translated. Simulator / device
      without a passcode: toggle disabled with the "Needs Face ID …" hint, and remembered
      values fill in without asking.
- [ ] Default with "On this device": toggle on. With "Until closed" etc.: off. Turning it on
      for a memory choice works; turning it off shows a device prompt first (cancel: stays on).
- [ ] On this device + toggle on, app lock off: force-quit, reopen, connect: the system
      prompt reads "Unlock the saved password for <connection>"; pass it: connects without
      the password prompt. Cancel it: the password prompt appears (no error, no second
      Face ID prompt); connect, then reconnect later: the saved value is still used.
- [ ] App lock on: open the app (unlock), connect within 30 s: one prompt only (the unlock
      counts). Connect again a minute later: one prompt naming the connection.
- [ ] Android: the prompt's own pause/resume does not lock the app, cover it or start a
      second prompt; the session continues after it.
- [ ] Two or three sessions open, background the app until the tunnels drop (iPhone), come
      back: one prompt for all of them (or the app-lock prompt only, if it is due). Cancel it:
      each session shows its password prompt, no further Face ID prompts.
- [ ] A drop and automatic reconnect while the app stays in the foreground, within 30 s of
      a check: no new prompt.
- [ ] No prompt appears while the app is in the background; one that is due shows after
      returning (and after the app lock, if that is showing).
- [ ] Settings › Security › "Forget remembered connection passwords": the next connect asks.
      Switching the setting from "On this device" to any other choice deletes the saved
      values; switching to Never forgets everything.
- [ ] Server sign-out (server list) forgets the in-memory values of that server; "Clear
      saved credentials", deleting the server, changing its address and "Sign out of all
      servers" forget the saved ones too.
- [ ] Diagnostics log: lines say "Answered 2 requested parameter(s) with remembered
      values", never a value. A backup file does not contain them (also with a passphrase).
- [ ] Demo, a joined session and a share link: no Remember box.

#### Prompt layout and keyboard

- [ ] iPhone portrait: the prompt is a centred card, not a bottom sheet. Tap the first
      field: the keyboard opens and the card glides to the middle of the space above it
      (no jump). Close the keyboard: it glides back.
- [ ] iPhone landscape with the keyboard up: the title, the focused field and Continue stay
      visible; the fields scroll inside the card.
- [ ] With the key bar set to Shown, or the text bar on, neither appears above the keyboard
      or under the card while the prompt is open; both come back after Continue.
- [ ] Android phone and a tablet: same card; the other sheets (More, Files, …) are still
      bottom sheets.

### Audio (AUD-1)

- [ ] RDP audio plays (play a sound on the remote). On iOS, audio starts after the first
      tap on the session if it was silent before.
- [ ] More > Sound off silences it at once; Sound on resumes without a burst of old audio.
      The choice is remembered for this connection after reconnecting.
- [ ] iOS silent switch: note whether remote audio follows it.
- [ ] Hiding the session (back to connections) or backgrounding the app stops the sound;
      coming back resumes it. Another app playing audio: note what happens.

### Files and printing (FIL-1, FIL-2)

- [ ] RDP with a shared drive (or SFTP): More > Files lists the drive, folders open,
      breadcrumbs and Up work, names with accents/emoji display correctly.
- [ ] Tap a file: it downloads with progress, then the share sheet opens (Save to Files /
      Drive / another app). Large file (≥ 50 MB): note the speed and memory use.
- [ ] Upload here: the OS picker (photos and files, several at once) uploads into the
      current folder with progress; the folder refreshes; Cancel stops a large upload (the
      remote keeps a partial file, expected).
- [ ] Connection with uploads disabled: the transfer fails with "Uploads are disabled by
      the administrator"; downloads disabled: "The server did not send the file" after 20 s.
- [ ] Connection without a filesystem: More > Files offers "Send file to remote"; the file
      appears where guacd puts it (RDP: the drive's upload folder).
- [ ] RDP printing enabled: print a page from Notepad; a "Print job" transfer appears and
      the share sheet offers Print / Save PDF. On Android, check that the share sheet can
      read the cached file (FileProvider paths).

### Clipboard panel (CLP-5)

- [ ] Copy on the remote: More > Clipboard shows it; Copy to device works.
- [ ] Type text in the panel, Send, then Ctrl+V on the remote pastes it. On SSH, Send then
      Ctrl+Shift+V (key bar / combos) or a right-click pastes it in the terminal.
- [ ] With `disable-paste` on the connection: Send does nothing on the remote; Type as
      keystrokes still works. With `disable-copy`: the panel says nothing was received.
- [ ] History lists the last items for this session only; it is empty after a reconnect of
      the app (memory only).

### Reconnect and lifecycle (DSP-9)

- [ ] Airplane mode on for 5 s while connected: "Waiting for the network…", then the session
      reconnects within a second or two of the network returning, without waiting out a
      backoff.
- [ ] Background the app for 30 s, return: the session is still there or reconnects at once
      on resume (the shell's grace timer decides when it is closed).
- [ ] Sign in to the same Windows account from another device: "Signed in elsewhere", no
      auto-retry. Idle timeout on the RDP host: "Session timed out". Admin disconnect:
      "Disconnected by the server". Sign out on the remote: "Session ended".

### Hidden sessions, thumbnails, keep-awake

- [ ] Back to connections (More > Back to connections, needed on iOS): the session stays
      connected; a hardware keyboard typing in the connection list sends nothing to the
      remote; returning re-fits the desktop correctly after a rotation while hidden.
- [ ] The connection list shows a recent thumbnail of the session.
- [ ] Keep screen awake: the screen stays on for 3 minutes on iOS and Android. Session info
      should show "on (native)" in the installed app (keep-awake plugin); in the mobile
      browser "on (screen wake lock)", "not supported in this WebView" or "refused by the
      system": record which, with the OS and WebView version.

### Toolbar

- [ ] Portrait and landscape: Pointer, Keyboard, Send, View, More reachable with one thumb;
      the collapsed handle sits on the right edge above the remote taskbar (bottom ~60 px
      stay uncovered).
- [ ] More > Ctrl+Alt+Del opens the Windows security screen (RDP); not offered on SSH.
- [ ] TalkBack / VoiceOver read every More tile, the transfer progress and the prompt
      fields with sensible labels.

## Notes to record

- Capacitor Keyboard resize mode in effect (does the WebView shrink when the keyboard
  opens?). The session handles both, but report which one the device used.
- Any keyboard app where Backspace or Enter misbehaves (name and version).

## Key sets, combo builder, incoming files (KEY-9, FIL-4)

Verified only in a desktop browser (demo desktop and the dev harness); check on the phone.

- [ ] Settings › Keys & combos › Key sets: duplicate "Terminal / Linux", rename it, add a
      text key (e.g. `| grep `) and a saved combo key; open an SSH connection: the Terminal
      set (or the app default you chose) is shown, and the text key types into the shell.
- [ ] Key bar switch button (right end): one tap moves to the next set and shows a toast;
      a long press opens the list. The choice is remembered for that connection after
      closing and reopening it; another connection keeps its own set.
- [ ] Session options › "Swipe sideways on the key bar to switch sets" on: a swipe left/right
      when the row is scrolled to its end switches the set; a swipe in the middle of a long
      row only scrolls it.
- [ ] Combo builder: Ctrl+K, pause 500 ms, Ctrl+C (Keep modifiers on) in a remote editor
      that uses chords (e.g. VS Code comment): the second chord arrives after the pause.
      Disconnecting or hiding the session during the pause leaves no key held.
- [ ] Combos saved by an older build still appear (combo menu › "Saved on this connection")
      and run; Save copies one to My combos.
- [ ] Export key sets (share sheet), then import the file on the other phone (Android ↔ iOS).
- [ ] RDP with a drive or printing: from the remote, push a file (e.g. save to the
      redirected download folder that guacd streams) and print a test page: the prompt names
      the file / says print job. Decline: the transfer stops on the server (no partial file
      on the phone). Accept: the share sheet opens. "Always decline" / "Always accept" skip
      the prompt.
- [ ] Session options › "Tap the desktop to hide the keyboard": Hide only hides the keyboard
      without clicking the remote; Hide and click hides it and clicks; Off only clicks.
- [ ] Android: rotate the phone while the soft keyboard is open: the toolbar layout follows
      the new orientation at once (not only after the keyboard closes).

## Re-test after the audit fixes (2026-11-21)

Not run on a device or a real server yet. Use a Windows RDP connection where the
administrator has **not** fixed width, height or DPI, then a VNC and an SSH connection.

**Quality and resolution (AUDIT #9, §4.4)** — note Session info › "Asked for" and "Remote
resolution" for each:

- [ ] iPhone (DPR 3), Quality Auto: expect about 1170 × 2532 @ 288 asked, ≈ 484 × 1055
      received (portrait; less if the toolbar is docked).
- [ ] Quality Best: ≈ 1168 × 2532 received; text is tiny at Fit; 1:1 is pixel-sharp.
- [ ] Quality Low: ≈ 388 × 844 received; Session info › Audio "off (not requested)"; the
      "Receiving now" rate is clearly lower than Auto on a moving desktop.
- [ ] Changing Quality mid-session shows "Reconnect to apply"; tapping it reconnects and the
      new size appears.
- [ ] Remote resolution 1920 × 1080 and Custom 1366 × 768: received as asked. Scale 200 %:
      roughly half the Auto pixel size, larger text.
- [ ] VNC: the size usually stays the server's own (as the helper text says). SSH: Best keeps
      the same text size as Auto.
- [ ] Sound "Off (not requested)": no audio and lower data rate; "Muted here": no audio but
      the data rate stays as with sound on.
- [ ] Session info › "Edit this connection" appears only for an account that may edit it,
      and opens the connection editor.

**1:1 and 100 % (AUDIT #6)**

- [ ] View › 1:1 on an iPhone with Quality Best: one remote pixel per device pixel (very
      small, sharp). View › 100 % (CSS pixels): three times larger.

**Combos with Shift (AUDIT #5)** — in Windows:

- [ ] Ctrl+Shift+T in a browser reopens a closed tab; Ctrl+T opens a new one.
- [ ] Ctrl+Shift+Esc opens Task Manager; Super+Shift+S opens the snipping bar;
      Alt+Shift+Tab steps backwards.
- [ ] Key bar: sticky Shift then "1" types "!"; sticky Shift then "a" types "A".
- [ ] iPad hardware keyboard with "Command key (⌘)" = Control: ⌘C / ⌘V copy and paste in
      Notepad; with "Windows key", ⌘ opens the Start menu.

**Background and resume (AUDIT #8)** — iPhone:

- [ ] Background for 5 s and return: the session is still there, no overlay.
- [ ] Background for 20 s and 70 s, return: at most a small "Reconnecting…" pill, no error
      overlay; zoom, pan position, pointer mode and key bar are as before.
- [ ] Settings › "Disconnect sessions after …" shows the iOS explanation (about 15 s).
- [ ] Android with "Keep sessions connected in the background" on: background for 2 min;
      the session is still connected on return (not reconnected).

**Picture in Picture (MUL-6, iOS, experimental)** — iPhone and iPad, setting off by default:

- [ ] Setting off (default): leaving the app shows no floating window, and More has no
      "Open picture in picture"; background behaviour is as above.
- [ ] Settings › Sessions › In the background › "Picture in picture" on for one connection:
      leave the app during a session: the remote screen appears in the floating window and
      follows the remote. Another connection, with the setting off, shows no window.
- [ ] More › "Open picture in picture" opens the window while the app is in front.
- [ ] Taps on the window do nothing on the remote (view only).
- [ ] With "Disconnect sessions after" at 1 min and "Sign out of servers after" at 1 min:
      keep the window open for 3 min, return: the session is still connected and the server
      still signed in. Close the window, wait past both times: they apply as usual.
- [ ] App lock on, "Lock after" 1 min: leave the app with the window open: the window closes
      when the lock falls due, and the lock screen is shown on return.
- [ ] Ending the session (from the server or Disconnect) closes the window.
- [ ] Remote sound while the window is prepared, with the silent switch on: note whether the
      sound now ignores the switch (AUD-1 says it respects it).
- [ ] Open the Demo desktop with the setting on and leave the app: the window appears (the
      App Review note relies on this).

- [ ] Administrator kills the session from Active Sessions: "Session ended", **no**
      automatic reconnect.

**View only, terminal, sharing, waking**

- [ ] View only (More › Input, or the toolbar button): taps, keys, scroll and Send do
      nothing remotely; the pill at the top turns it off.
- [ ] SSH: More › Terminal › Font size − / + changes the font; Colours cycles presets;
      with "Pinch to change the terminal font size" on, a pinch changes the font.
- [ ] More › Share this session: with a sharing profile set up, the link opens the
      session read-only in a desktop browser; without profiles, the sheet says so.
- [ ] A connection with Wake-on-LAN to a sleeping PC: after 8 s the overlay says "Still
      connecting… waking the computer?" and the session opens when the PC is up.
- [ ] "Send the device clipboard when the session connects" on: one paste prompt (iOS) at
      connect, not on every reconnect.

**Large downloads, microphone, shared sessions, resize (2026-11)** — iPhone and Android:

- [ ] RDP drive: download a file of 2 GB or more from Files. Progress counts up past 2 GB, the
      app's memory stays flat (Xcode / Android Studio memory gauge), and the file appears
      complete in Files › On My iPhone › OMG › Downloads (Android 11+: Files ›
      Documents › OpenMobileGuac; Android 8–10: Android/data/<app id>/files/Downloads). Its
      size and checksum match the original.
- [ ] Download the same file again: it is saved as "name (2).ext", nothing is overwritten.
- [ ] Transfers › Share on a finished download opens the share sheet with the file.
- [ ] Cancel a large download half way while the remote screen is changing (move a window):
      the row says Cancelled at once; about a minute later no `.omg-…part` file is left in
      Downloads; the session keeps working (copy text on the remote: the clipboard still
      arrives). Repeat with a still screen: the transfer may run to the end before the file is
      deleted (expected: guacd only stalls at the next frame); note how long it takes.
- [ ] Turn Wi-Fi off during a download: the row fails, no partial file remains. Kill the app
      during a download, start it again: no `.omg-…part` file remains.
- [ ] Settings › Files › Received files = "Share, keep no copy": the share sheet opens when
      the file is complete and nothing is added to Downloads.
- [ ] RDP print job: the share sheet opens to print; with "Save to Downloads" the PDF is also
      in Downloads.
- [ ] A server with a pinned self-signed certificate (SRV-8): the native stream download does
      not use the pinned-TLS path, so downloads fall back to in band. Check they still complete
      (slower: one round trip per 4 KB).
- [ ] RDP connection with "Enable audio input": More › Sound › Send microphone. The OS asks
      for the microphone once; the "Microphone on" pill shows; speech is heard in a remote
      recorder app. Tapping the pill stops it and the OS microphone indicator goes off.
- [ ] Same with audio input disabled on the connection: no OS prompt; a message explains the
      connection does not accept microphone input; the option turns itself off.
- [ ] Mic on, switch to another app: the OS indicator goes off; back in the session it comes
      back. Disconnect: it goes off.
- [ ] Deny the microphone permission: a message says so; the option turns off.
- [ ] Share the session (More › Share this session) and open the link in a desktop browser:
      the phone shows "Someone joined this session…" and a "1 viewer" pill; closing the browser
      tab shows "…left" and the pill disappears. A second signed-in user joining from the web
      client's Active Sessions shows their username.
- [ ] Admin: connection list header › Active sessions lists every session on the server with
      user, connection, start time and remote host; Join (after the confirmation) opens the
      other user's session next to yours, and their desktop is not resized; Disconnect ends it.
- [ ] Resize follows the view (new default): rotate the phone in an RDP session with
      `resize-method` display-update: the desktop is redrawn at the new size after about half a
      second. Open the soft keyboard: the desktop is not resized. Rotate with the keyboard up:
      the resize happens when the keyboard closes. With Remote resolution 1920 × 1080 nothing is
      resized. A connection where "Match device size" was turned off earlier stays off.
