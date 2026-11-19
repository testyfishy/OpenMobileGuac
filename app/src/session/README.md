# session

Session-level logic: gesture recogniser, `PointerModel`, `KeyModel`, `Viewport`,
`RemoteDisplay`, `TextInputBridge`, clipboard bridge (see docs/SPEC.md §8.2).

The modules below are **pure TypeScript**: no React, Capacitor, DOM globals, timers or
imports from `src/vendor`. Time and input are injected, so every behaviour is unit-tested
(`*.test.ts` next to each module). The DOM/Capacitor glue lives in
[`src/ui/session/`](../ui/session/index.ts): mainly `SessionController.ts`, with tested
helpers such as `inputMapping.ts`, `layout.ts`, `settings.ts`, `keyBarLayout.ts` and
`clipboardText.ts` (clipboard streams). It only translates platform events into these plain
types and back.

| Module                          | SPEC                       | Role                                                                             |
| ------------------------------- | -------------------------- | -------------------------------------------------------------------------------- |
| `viewport/Viewport.ts`          | DSP-1, DSP-2, DSP-5        | Fit modes, zoom/pan with bounds, fling, remote ↔ screen mapping, `ensureVisible` |
| `gesture/GestureRecognizer.ts`  | PTR-1, PTR-2, PTR-7        | Pointer samples → semantic gestures (tap, tap-drag, long press, pan, pinch, …)   |
| `pointer/PointerModel.ts`       | PTR-1, PTR-2, PTR-3, PTR-7 | Gestures → remote mouse states, viewport commands, haptic hints                  |
| `pointer/TouchPassthrough.ts`   | PTR-6                      | Pointer samples → raw multi-touch contacts (`touch` instruction)                 |
| `keys/KeyModel.ts`              | KEY-2, KEY-3, KEY-4        | Keysyms, sticky modifiers, `typeText`, combos and presets                        |
| `keys/HardwareKeyboard.ts`      | KEY-6                      | Hardware keydown/keyup → key events (lazy Ctrl/Alt, AltGr, resync, repeat)       |
| `keys/TextInputDiff.ts`         | KEY-2, §8.4                | Hidden-field diff (live / commit-on-word), caret resync                          |
| `credentials/requiredParams.ts` | SRV-11 (proposed)          | `required` parameter names → prompt fields; answers to send on `argv` streams    |
| `transfer/TransferModel.ts`     | FIL-1, FIL-2 (proposed)    | Transfer list reducer, upload/download error text, print-job detection, names    |
| `transfer/directoryIndex.ts`    | FIL-1                      | Filesystem stream names, stream-index JSON listing parser, breadcrumbs           |
| `clipboard/ClipboardHistory.ts` | CLP-5                      | In-memory clipboard history for one session                                      |

## Data flow

```
Pointer Events (GestureLayer, DOM)
   │  {id, type, x, y, timeMs, pointerType}     hardware mouse / pen ──► handleHardwareMouse
   │                                            pointer lock ──► handleRelativeMouse
   │                                            touch mode ──► TouchPassthrough ──► sendTouchState
   ▼
GestureRecognizer.handle(e) / .tick(now)  ──►  Gesture[]
   │   (a second recogniser feeds the split layout's trackpad surface, always as trackpad)
   ▼
PointerModel.handle(gesture, viewport, mode?)  ──►  { mouse: MouseState[],
   │                                                  viewport: ViewportCommand[],
   │                                                  haptics: HapticHint[] }
   │        mouse ──► sendMouseState (runs with withShift are wrapped in Shift down/up)
   │        haptics ──► haptics plugin (PTR-4, if enabled)
   ▼
applyViewportCommands(viewport, commands)  ──►  new ViewportState

Soft keyboard (hidden field)
   input / composition / selection events
   ▼
diffTextInput(baseline, value, composing, {commit, flush}) ──► Backspaces + text
caretResync(value, selStart, selEnd, composing)            ──► Left presses + reset
   ▼
textInputKeyEvents(update, keyModel) ──► KeyEvent[] ──► sendKeyEvent(pressed, keysym)

Hardware keyboard (document keydown/keyup) ──► HardwareKeyboard.handle ──► KeyEvent[]
Key bar / combo menu / text input bar ──► KeyModel.tapModifier / pressKey / runCombo / typeText
```

Streams (see docs/protocol-notes.md §6): the UI glue in `ui/session/` installs
`onrequired`/`onargv` (`argv.ts`), `onfile`/`onfilesystem` (`transfers.ts`) and `onaudio`
(`audio.ts`) on each new client and detaches them on teardown. Downloads are acked in band
(first ack by the client, then one per blob), uploads start only after the server's first
ack, and audio mute drops that session's audio blobs (the AudioContext is shared).

Host loop responsibilities:

- After each recogniser call, schedule a `tick()` at the earliest `nextDeadline()` of both
  recognisers (long press, tap-drag release, held three-finger tap, tap-drag hold).
- On pointer-mode change (including touch support appearing/disappearing): reset the
  recogniser, lift touch contacts, `pointerModel.releaseAll()`, then
  `recognizer.setConfig({...gestureConfigFromSettings(s), ...pointerModel.recognizerOptions()})`.
- Before a click (tap, pending-tap press, mouse/pen button): flush commit-on-word text and
  press lazy hardware modifiers (`HardwareKeyboard.flush()`), so Ctrl+click works and text
  arrives before the click.
- On blur / hidden / disconnect: `HardwareKeyboard.releaseAll()`, `keyModel.releaseAll()`,
  `TouchPassthrough.releaseAll()`, both recognisers `reset()`, `pointerModel.releaseAll()`.

## Key decisions

- **Viewport.** `screen = remote × scale + offset`, `scale = baseScale(mode) × zoom`. The fit
  scale uses the safe area only; the soft keyboard shrinks the _visible_ area (pan bounds,
  `ensureVisible`) but never rescales the desktop. Zoom is stored relative to the mode.
- **No tap dead zone.** A stationary press released at any time before the long press
  fires is a tap (one, two or three fingers). Thresholds (long press, double-tap window,
  tap slop) are user settings with safe ranges (`INPUT_RANGES` in `ui/session/settings.ts`).
- **Trackpad tap latency: press early, release late.** The remote decides "double click"
  on the second button-down, and the trackpad pointer does not move between taps, so a
  design that sends a full click at once and presses again for a tap-and-a-half drag
  would make the remote see a double-click-drag (selects words, maximises a window when
  dragging its title bar). Instead, with `tapDrag` on (default), the first tap's
  **button-down is sent on release with zero delay** and only its button-up is held back
  for an adaptive window (starts at 180 ms; after three observed double taps it becomes
  1.5 × the user's largest recent gap, clamped to 150 ms … the double-tap window, 300 ms by
  default; a second tap after the window but inside the double-tap window is still a double
  click, it just cannot start a drag). What
  the remote receives:
  - single tap: down at once, up when the window ends (a normal click; press-reacting UI
    responds instantly, release-reacting UI after the window);
  - double tap: down, up (when the second finger lifts), down, up = a double click;
  - tap-and-a-half then move (or hold for 250 ms): down at the first lift, motion with the
    button held, up when the finger lifts = a plain single-click drag, never a double click;
  - a touch far away, a second finger, a cancel or a mode change: the up is sent at once.
    `tapDrag: false` (Input options) sends every tap as a complete click on release with no
    delay; drags then use a long press. Direct mode never holds anything back.
- **Long press in direct mode.** Only a haptic while held; the right click is sent on
  release. Moving after the long press becomes a left drag instead.
- **Direct one-finger drag.** When the whole desktop fits (`!canPan`), a one-finger drag is
  a left drag at once (touch-drag = drag). When zoomed in it pans the view (or drags, per
  the `directOneFinger` setting). Two-finger tap = right click and three-finger tap = middle
  click at the fingers' centroid, as in trackpad mode (there at the pointer).
- **Multi-finger double taps.** Two-finger taps fire at once; a second within the window
  is reported as `two-finger-double-tap` and ignored, so a hurried double tap never sends
  two right clicks. Three-finger taps are held for the window (middle click pastes on X11):
  a **three-finger double tap resets the zoom** (DSP-2), in both modes, with no middle click.
- **Scroll.** Two-finger travel accumulates into wheel notches (30 px). The gesture locks
  to its dominant axis after 8 px. Guacamole's mouse protocol has only vertical wheel
  bits, so horizontal notches are sent as Shift + wheel (most desktop apps scroll
  sideways), skipped if Shift is already held. Hardware `deltaX` does the same.
- **Trackpad motion** is in screen terms with an acceleration curve; the pointer is a float.
  If it is outside the visible area when an interaction starts (after a pinch), it is first
  moved to the nearest visible point.
- **Modifiers / Shift.** guacd sets Shift to match the keysym (RDP keymaps define digits as
  `-shift` and symbols as `+shift`; `guac_rdp_keyboard_send_defined_key`), so keysym "1"
  with Shift held still types "1". Sticky Shift therefore sends the US-layout shifted
  keysym ("!") with Shift held, and uppercase letters; Ctrl/Alt/Super chords send lowercase
  letters (Ctrl+Shift+T keeps an uppercase T).
- **Hardware keyboard.** The vendored `Guacamole.Keyboard` is not used because it also
  consumes `input`/composition events and would double-send the hidden field's text. Its
  modifier resync and AltGr handling are ported; Ctrl and Alt presses are lazy so that
  Windows AltGr (Ctrl + AltRight) and macOS Option characters never send a spurious
  Ctrl+Alt. Lock keys pass through (upstream 1.6.0 does not synchronise lock state).
- **IME / soft keyboard.** Live (incremental) diffing by default; "commit on word" holds
  a word until a boundary as a fallback. A caret moved inside the hidden field (iOS
  space-bar cursor) becomes Left presses and a field reset after 80 ms of quiet; a
  selection is collapsed back. The visible text input bar is the guaranteed fallback.
- **Touch pass-through (PTR-6).** Offered only after the server declares multi-touch
  (`client.onmultitouch`, as the web client's ManagedClient records it). Contacts are built
  as `Guacamole.Touch.State` by the host from Pointer Events (upstream `Touch.js` 1.6.0
  never dispatches `touchstart`); `force` is assigned after construction because the
  constructor turns 0 into 1. Pinch then goes to the remote, so zoom is on the toolbar.
