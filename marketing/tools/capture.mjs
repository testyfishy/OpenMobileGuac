// Real captures of the app (built-in Demo only) for the store screenshots.
//
//   cd app && npx vite --port 5377 --strictPort      (in another terminal)
//   node marketing/tools/capture.mjs                  (APP_URL defaults to http://127.0.0.1:5377/)
//
// Writes marketing/screenshots/raw/*.jpg (JPEG quality 90, to keep the repo small). Only the Demo server and built-in screens are used:
// no real server, no personal data. The demo desktop clock is pinned to 09:41.
import { launch, sleep } from './cdp.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'screenshots', 'raw');
mkdirSync(OUT, { recursive: true });
const APP = process.env.APP_URL || 'http://127.0.0.1:5377/';
const only = process.argv.slice(2);

const openDemo = async (b) => {
  await b.goto(APP);
  await b.tryClick('Skip');
  await b.click('Demo');
  await b.click('Connect to Demo desktop', 4000);
};
const sheet = async (b, ...labels) => {
  for (const l of labels) await b.click(l, 900);
};
const scrollToHeading = (b, text, offset) =>
  b.eval(`(() => {
    const h = [...document.querySelectorAll('h2,h3')].find(e => e.textContent.trim() === ${JSON.stringify(text)});
    h.scrollIntoView({ block: 'start' });
    let p = h.parentElement; while (p && p.scrollHeight <= p.clientHeight) p = p.parentElement;
    if (p) p.scrollTop -= ${offset};
    return true; })()`);

// [name, setup]: each scene runs in a fresh browser profile, so the onboarding is skipped
// first and no session from an earlier scene is open.
const scenes = {
  onboarding: async (b) => {
    await b.goto(APP);
    await b.click('Next', 800);
  },
  session: async (b) => openDemo(b),
  keys: async (b) => {
    await openDemo(b);
    await b.click('Show extra keys');
  },
  keysets: async (b) => {
    await openDemo(b);
    await sheet(b, 'More actions', 'Switch key set');
  },
  combos: async (b) => {
    await openDemo(b);
    await sheet(b, 'More actions', 'Key combos');
  },
  view: async (b) => {
    await openDemo(b);
    await sheet(b, 'View mode and zoom');
  },
  more: async (b) => {
    await openDemo(b);
    await sheet(b, 'More actions');
  },
  gestures: async (b) => {
    await b.goto(APP);
    await b.tryClick('Skip');
    await b.click('Settings');
    await scrollToHeading(b, 'Gestures', 6);
    await sleep(1200); // let the gesture animations reach a visible frame
  },
};

const devices = [
  // iPhone 6.9": 430 x 932 CSS px at 3x = 1290 x 2796
  { id: 'iphone', w: 430, h: 932, dpr: 3, scenes: ['session', 'keys', 'keysets', 'view', 'more', 'gestures'] },
  // iPhone landscape: 2796 x 1290
  { id: 'iphone-land', w: 932, h: 430, dpr: 3, scenes: ['session', 'keys'] },
  // iPad 13": 1032 x 1376 CSS px at 2x = 2064 x 2752
  { id: 'ipad', w: 1032, h: 1376, dpr: 2, scenes: ['session', 'keys', 'more', 'gestures'] },
];

// A fresh browser profile per scene, so no session or dialog carries over between scenes.
for (const d of devices) {
  for (const s of d.scenes) {
    const name = `${d.id}-${s}`;
    if (only.length && !only.includes(name)) continue;
    const b = await launch({ clock: '09:41' });
    try {
      await b.viewport(d.w, d.h, d.dpr, true);
      await b.colorScheme(true);
      await scenes[s](b);
      await b.shot(join(OUT, `${name}.jpg`), 'jpeg', 90);
      console.log('captured', name);
    } catch (e) {
      console.error(name, e.message);
    } finally {
      await b.close();
    }
  }
}
