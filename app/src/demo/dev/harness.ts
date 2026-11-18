/**
 * Developer harness: the real `Guacamole.Client` against `DemoTunnel` in a browser.
 * Run `npm run dev` and open `/src/demo/dev/harness.html`. Query options:
 * `?w=1280&h=800` initial size in device pixels, `?dpi=288` the `GUAC_DPI` sent (default
 * 96, so 1:1), `?id=demo-desktop-1024` connection variant,
 * `?noImageDecoder` to force the data-URI image path used where `ImageDecoder` is missing
 * (older iOS WebKit).
 */
import Guacamole from '../../vendor/guacamole-common-js/index.js';
import { readTextStream, writeTextStream } from '../../ui/session/clipboardText.ts';
import { DemoTunnel } from '../DemoTunnel.ts';

const params = new URLSearchParams(location.search);
if (params.has('noImageDecoder')) Reflect.deleteProperty(window, 'ImageDecoder');

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const logEl = $('log');
const log = (msg: string) => {
  logEl.textContent = `${new Date().toISOString().slice(11, 23)} ${msg}\n` + logEl.textContent;
};

const tunnel = new DemoTunnel();
const client = new Guacamole.Client(tunnel);
const display = client.getDisplay();
const container = $('display');
container.appendChild(display.getElement());

const states = ['IDLE', 'CONNECTING', 'WAITING', 'CONNECTED', 'DISCONNECTING', 'DISCONNECTED'];
client.onstatechange = (s) => {
  $('state').textContent = states[s] ?? String(s);
  log(`client state ${states[s] ?? s}`);
};
tunnel.onstatechange = (s) => log(`tunnel state ${s}`);
client.onname = (name) => log(`name: ${name}`);
client.onerror = (status) => log(`client error ${status.code}: ${status.message ?? ''}`);
tunnel.onerror = (status) => log(`tunnel error ${status.code}: ${status.message ?? ''}`);
let syncs = 0;
client.onsync = () => {
  syncs++;
  if (syncs % 50 === 1) log(`sync #${syncs}`);
};

// Remote cursor: use it as the local CSS cursor, as the web client does.
const mouse = new Guacamole.Mouse(display.getElement());
display.oncursor = (canvas, x, y) => {
  mouse.setCursor(canvas, x, y);
};
mouse.onEach(['mousedown', 'mouseup', 'mousemove'], (e) => {
  container.focus();
  client.sendMouseState((e as Guacamole.Mouse.Event).state, true);
});

const keyboard = new Guacamole.Keyboard(container);
keyboard.onkeydown = (keysym) => {
  client.sendKeyEvent(1, keysym);
  return false;
};
keyboard.onkeyup = (keysym) => client.sendKeyEvent(0, keysym);

client.onclipboard = (stream, mimetype) => {
  readTextStream(stream, (text) => {
    $('remote-clip').textContent = text;
    log(`clipboard from remote (${mimetype}): ${JSON.stringify(text)}`);
  });
};

$('send-clip').onclick = () => {
  const text = $<HTMLTextAreaElement>('clip').value;
  writeTextStream(client.createClipboardStream('text/plain'), text);
  log(`clipboard to remote: ${JSON.stringify(text)}`);
  container.focus();
};
$('resize').onclick = () => client.sendSize(1024, 700);
$('disconnect').onclick = () => client.disconnect();

const w = Number(params.get('w') ?? 1280);
const h = Number(params.get('h') ?? 800);
const id = params.get('id') ?? 'demo-desktop';
const dpi = Number(params.get('dpi') ?? 96);
client.connect(
  `GUAC_ID=${encodeURIComponent(id)}&GUAC_WIDTH=${w}&GUAC_HEIGHT=${h}&GUAC_DPI=${dpi}`,
);
container.focus();

// For inspection from the devtools console.
Object.assign(window, { demo: { client, tunnel, display } });
