# session

Session-level logic: gesture recogniser, `PointerModel`, `KeyModel`, `Viewport`,
`RemoteDisplay`, `TextInputBridge`, clipboard bridge (see docs/SPEC.md §8.2).

The modules below are **pure TypeScript**: no React, Capacitor, DOM globals, timers or
imports from `src/vendor`. Time and input are injected, so every behaviour is unit-tested
(`*.test.ts` next to each module). The DOM/Capacitor glue lives in
[`src/ui/session/`](../ui/session/index.ts): mainly `SessionController.ts`, with tested
helpers such as `inputMapping.ts`, `layout.ts` and `clipboardText.ts` (clipboard streams).
It only translates platform events into these plain types and back.

| Module                         | SPEC                       | Role                                                                             |
| ------------------------------ | -------------------------- | -------------------------------------------------------------------------------- |
| `viewport/Viewport.ts`         | DSP-1, DSP-2, DSP-5        | Fit modes, zoom/pan with bounds, fling, remote ↔ screen mapping, `ensureVisible` |
| `gesture/GestureRecognizer.ts` | PTR-1, PTR-2               | Pointer samples → semantic gestures (tap, long press, pan, pinch, …)             |
| `pointer/PointerModel.ts`      | PTR-1, PTR-2, PTR-3, PTR-7 | Gestures → remote mouse states, viewport commands, haptic hints                  |
| `keys/KeyModel.ts`             | KEY-2, KEY-3, KEY-4        | Keysyms, sticky modifiers, `typeText`, combos and presets                        |
| `keys/TextInputDiff.ts`        | KEY-2, §8.4                | Hidden-field diff: Backspaces + text to send, when to reset the sentinel         |

## Data flow

```
Pointer Events (GestureLayer, DOM)
   │  {id, type, x, y, timeMs, pointerType}            hardware mouse ──► mapHardwareMouse
   ▼                                                                     (bypasses gestures)
GestureRecognizer.handle(e) / .tick(now)  ──►  Gesture[]
   │
   ▼
PointerModel.handle(gesture, viewport)  ──►  { mouse: MouseState[],
   │                                            viewport: ViewportCommand[],
   │                                            haptics: HapticHint[] }
   │        mouse ──► Guacamole client sendMouseState (x, y, left, middle, right, up, down)
   │        haptics ──► haptics plugin (PTR-4, if enabled)
   ▼
applyViewportCommands(viewport, commands)  ──►  new ViewportState
   │        toCssTransform(state) ──► compositor transform on the display element
   │        stepFling(state, dt) on animation frames while isFlinging(state)
   ▼
next gesture uses the new viewport state

Soft keyboard (TextInputBridge, DOM)
   │  input / composition events
   ▼
diffTextInput(baseline, field.value, composing) ──► { backspaces, text, baseline, reset }
   │  (call on every input event AND on compositionend with composing = false)
   ▼
textInputKeyEvents(update, keyModel) ──► KeyEvent[] ──► client sendKeyEvent(pressed, keysym)

Key bar / combo menu ──► KeyModel.tapModifier / pressKey / runCombo ──► KeyEvent[]
```

Host loop responsibilities:

- After each recogniser call, schedule a `tick()` at `recognizer.nextDeadline()` (long
  press, deferred tap, double-tap-hold). Late ticks are fine: timers fire at their own
  deadlines and every event first fires timers due before it.
- On pointer-mode change: `pointerModel.setConfig({ mode })` (releases held buttons),
  `recognizer.reset()`, then `recognizer.setConfig(pointerModel.recognizerOptions())`.
- On rotation, fold, split-screen, safe-area or keyboard change: `relayout(viewport, …)`;
  after the keyboard opens, `ensureVisible` the pointer or focus point.
- On remote resize: `relayout(viewport, { remote })` and `pointerModel.handleRemoteResize`.
- On blur / disconnect: `keyModel.releaseAll()`, `pointerModel.releaseAll()`.

## Key decisions

- **Viewport.** `screen = remote × scale + offset`, `scale = baseScale(mode) × zoom`. The fit
  scale uses the safe area only; the soft keyboard shrinks the _visible_ area (pan bounds,
  `ensureVisible`) but never rescales the desktop. Zoom is stored relative to the mode, so
  an un-zoomed view re-fits after rotation. Min zoom = whole remote visible or the mode's
  base, whichever is smaller; max = 8× (configurable). Content smaller than the view is
  centred; larger content is clamped so no empty space shows; overflowing axes start
  top-left on reset. Fling decays exponentially, so its result does not depend on frame
  timing.
- **Tap latency.** Direct mode emits taps on release with no delay; a double tap is "tap +
  one more click" on the first tap's pixel, which the remote OS sees as a double click.
  Trackpad mode must know whether a tap is the start of double-tap-and-hold (drag), so a
  single tap is held back for up to the double-tap window (300 ms default). It is flushed
  early as soon as the ambiguity resolves (second touch elsewhere, second finger).
- **Long press in direct mode.** Only a haptic fires while held; the right click is sent on
  release. Moving after the long press becomes a left drag instead, without a stray context
  menu.
- **Two fingers.** Two/three-finger tap if every finger stays within slop and all lift
  within `tapMaxMs`. Otherwise span change vs centroid travel decides pinch vs two-finger
  pan, and the decision is locked for the gesture. A finger landing mid-pan ends the pan
  (no fling) and can only become pinch/two-finger pan. After any finger lifts from a
  multi-finger gesture nothing else fires until all fingers are up.
- **Scroll.** Two-finger travel accumulates into wheel notches (`scrollStepPx`, default
  30 px); each notch is a press + release of `up`/`down`. Natural direction by default.
  Guacamole's mouse state has no horizontal wheel, so horizontal travel is ignored.
- **Trackpad motion** is in screen terms (divided by the viewport scale), with a smooth
  acceleration curve, and the pointer is kept as a float so slow nudges accumulate.
- **Modifiers.** One-shot modifiers wrap the next key; locked modifiers are held down on the
  remote until unlocked. ASCII letters are sent lowercase under Ctrl/Alt/Super and
  uppercase under Shift, because guacd adjusts Shift to match the keysym.
- **IME.** Composition is diffed incrementally (Android keyboards compose every Latin
  word); `composition: 'commit'` is available. The field is never reset mid-composition.
