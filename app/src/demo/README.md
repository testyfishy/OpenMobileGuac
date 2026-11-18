# demo

An interactive demo server that runs inside the app: a simulated remote desktop behind a
tunnel. Store reviewers can try every session control without access to a private server,
developers can run the session UI with no Guacamole server, and it contains no personal data.

```ts
import Guacamole from '../vendor/guacamole-common-js/index.js';
import { DemoTunnel } from './demo';

const client = new Guacamole.Client(new DemoTunnel());
client.connect('GUAC_ID=demo-desktop&GUAC_WIDTH=1280&GUAC_HEIGHT=800');
```

`createDemoSessionTransport()` returns a core `SessionTransport` (`kind: 'replay'`,
`demo: true`). `DEMO_SERVER_PROFILE`, `DEMO_AUTH_SESSION` and `DEMO_CONNECTION_TREE` let the
UI list a built-in "Demo server" (base URL `https://demo.invalid`) with three connections:
`demo-desktop` (follows the requested size), `demo-desktop-1024` and `demo-desktop-1920`
(fixed sizes).

## How it works

- `DemoTunnel` implements core's `TunnelLike`. `connect` goes `CONNECTING` synchronously;
  on the next tick it reports a UUID, goes `OPEN`, and the server sends `name`, cursor
  images, layers and a first frame ending in `sync`. By default every instruction is
  encoded to wire format and parsed back in both directions (`wire: true`).
- `DemoServer` (`server.ts`) acts as guacd. It handles `mouse`, `key`, `size`, `sync`,
  `clipboard`/`blob`/`end` (acknowledging each blob), `disconnect` and `nop`, and rejects
  `file`, `pipe`, `audio`, `argv` and `put` streams with an error `ack`. Its output uses
  `size`, `move`, `shade`, `rect`, `cfill`, `img`/`blob`/`end` (PNG tiles of at most
  256 px), `copy` (list scrolling), `cursor`, `clipboard` and `sync`. Input is coalesced into
  frames of at most one per 16 ms. A clock tick each second repaints the taskbar clock.
- `DemoDesktop` (`desktop.ts`) is pure state: window manager, widgets, text model and
  input state machine. Each window is its own layer, so dragging one costs a `move`.
- Painting goes through the small `Painter` interface (`paintDesktop.ts`, `cursors.ts`).
  `canvasRenderer.ts` implements it on a detached `<canvas>` with `toDataURL`, and falls back
  to `OffscreenCanvas.convertToBlob` when there is no `document`. Tests use
  `createStubRenderer()` from `testing.ts`.
- **High DPI** (`scale.ts`). The app requests the desktop in device pixels and sends
  `GUAC_DPI` = 96 × devicePixelRatio. `demo-desktop` uses scale = clamp(dpi / 96, 1, 4)
  (lowered if the logical desktop would fall below 320 × 240) and keeps it for the session.
  `DemoDesktop` works in logical pixels (device ÷ scale, rounded up). The server multiplies
  everything it sends (layer sizes, `move`, tiles, cursors) by the scale and the renderer
  paints at that scale, so the UI keeps its normal size and stays crisp. Layer 0 is exactly
  the requested size. Incoming `mouse` coordinates are divided back; `size` re-lays out at
  the same scale. Scroll `copy` is used only at integer scales (fractional scales repaint).
  The fixed-size variants always use scale 1.

## The desktop

A gradient wallpaper, a taskbar with window buttons and a clock, and three windows:

- **Notes**: a text area with a caret. It supports typing (including Unicode keysyms),
  Enter, Backspace, Delete, arrows, Home and End, plus Ctrl+A, C, X and V. Copy and cut send
  the text to the device as a clipboard stream. Clipboard text from the device is stored,
  pasted by Ctrl+V, and shown on the "Clipboard:" line.
- **Input test**: shows live pointer coordinates, the buttons held, the last click type
  (left, right, middle or double), wheel notch counts, the last key with modifiers, and the
  keys held. It also has 12 px checkboxes, a draggable box and a wheel-scrolled list.
- **About this demo**: small text (9, 8 and 7 px) and a 1 px detail pattern for zoom tests.

Windows drag by their title bar and close with ×; the taskbar reopens them. Right-click the
wallpaper for a menu, which closes on the next click.

The taskbar runs along the **top** of the desktop, so the app's session toolbar (docked at
the bottom of the screen) never covers it.

Window layouts adapt to the desktop size (`desktopLayout` and `Arrangement` in
`desktop.ts`):

- **cascade**, below 592 logical pixels wide (a phone in portrait, e.g. 375 × 812): windows
  take the full width, their contents reflow (Input test stacks its drag area above the
  list, About puts the detail target under the text, the taskbar shortens its labels) and
  they cascade straight down with Notes on top, so each fits on screen and every title bar
  shows.
- **row**, from 1128 wide (e.g. 1280 × 800, 1366 × 1024): Notes and Input test side by side
  at their classic sizes, About below Notes.
- **stack**, medium width and tall enough (e.g. 800 × 1200): the three windows one above
  the other.
- **columns**, medium width but too short to stack (landscape phones such as 640 × 360, 667 × 375,
  812 × 375, 932 × 430, and tablets such as 1024 × 768): Notes and Input test in two equal
  columns, shortened to fit, with Input test's drag area and list side by side. Nothing
  overlaps. About goes below Notes when Notes can shrink enough; otherwise it starts closed
  and opens from the taskbar over the columns in its wide, short layout. It comes back by
  itself when a later size has room for it.

On short desktops the Notes text area and the Input test panels shrink to fit.

## Developer harness

Run `npm run dev` and open `/src/demo/dev/harness.html` (options: `?w=&h=` in device
pixels, `?dpi=` for `GUAC_DPI`, `?id=`, `?noImageDecoder`). Nothing links to it, so it is not part of the production build.
