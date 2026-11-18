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

## Developer harness

Run `npm run dev` and open `/src/demo/dev/harness.html` (options: `?w=&h=`, `?id=`,
`?noImageDecoder`). Nothing links to it, so it is not part of the production build.
