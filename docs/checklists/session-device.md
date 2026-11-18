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
- [ ] The desktop does not shrink when the keyboard opens; the key bar sits right above the
      keyboard; the area near the pointer/last tap stays visible above it (DSP-5).
- [ ] Letters, digits and punctuation arrive correctly in a remote text editor, including a
      mixed-case password like `Ab3$xY9!`.
- [ ] Autocorrect, auto-capitalise and suggestions do not change what reaches the remote
      (type `teh`, `i`, `hello.` + space: the remote shows exactly that).
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

## Key bar and combos (KEY-3, KEY-4, KEY-5)

- [ ] Toolbar > Keys shows the key bar with the keyboard hidden, docked above the gesture
      bar / home indicator; the chevron hides it.
- [ ] Ctrl tap (one-shot, outlined) + `c` on the soft keyboard copies on the remote; Ctrl
      then turns off by itself.
- [ ] Shift double tap locks (filled); arrows extend a selection; third tap unlocks.
- [ ] Esc, Tab, arrows, Home, End, PgUp, PgDn, Del each work; Fn shows F1–F12 and the row
      scrolls sideways.
- [ ] Combos: Ctrl+Alt+Del, Alt+Tab, Win, Win+D, Ctrl+Shift+Esc each do the expected thing
      on a Windows remote (S1).
- [ ] Add a custom combo (e.g. `Ctrl+Shift+T`), reorder, delete; leave and reopen the
      connection: the list is remembered and the combo fires.

## Clipboard (CLP-1..CLP-4)

- [ ] iOS: no "Allow Paste" prompt appears when connecting, rotating or returning to the app
      (with auto-send off).
- [ ] Copy a URL on the phone, tap Paste, then Ctrl+V on the remote: the URL arrives (S2).
      iOS shows the paste prompt only now, after the tap.
- [ ] Long-press Paste (or Combos > Type clipboard): the text is typed on a connection with
      `disable-paste` set (CLP-3).
- [ ] Copy text on the remote: it lands on the phone clipboard (toast shown); with "remote to
      device" off it does not.
- [ ] Auto-send on foreground on: switch to another app, copy, come back: sent once, and a
      second return without a new copy does not resend.

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

## Connection state (DSP-9)

- [ ] Airplane mode for 5 s: "Reconnecting…" overlay, then the session resumes by itself.
- [ ] Wrong/removed connection: a readable error with Retry and Close.
- [ ] Exit (tap twice) returns to the connection list; the remote session is closed.

## Notes to record

- Capacitor Keyboard resize mode in effect (does the WebView shrink when the keyboard
  opens?). The session handles both, but report which one the device used.
- Any keyboard app where Backspace or Enter misbehaves (name and version).
