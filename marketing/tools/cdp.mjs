// Minimal Chrome DevTools Protocol driver for headless Microsoft Edge (or Chrome).
// Uses only Node's built-in fetch/WebSocket (Node 22+). No npm dependencies.
//
// EDGE env var overrides the browser path.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findBrowser() {
  if (process.env.EDGE) return process.env.EDGE;
  const { existsSync } = await import('node:fs');
  const hit = DEFAULT_EDGE.find((p) => existsSync(p));
  if (!hit) throw new Error('Set EDGE to the path of msedge.exe / chrome');
  return hit;
}

/**
 * Launch a headless browser with a throwaway profile and return a small driver.
 * `clock`: "HH:MM" freezes the page's wall-clock offset so on-screen clocks show that time.
 */
export async function launch({ port = 9300 + Math.floor(Math.random() * 600), clock } = {}) {
  const profile = join(tmpdir(), `omg-marketing-${process.pid}-${port}`);
  mkdirSync(profile, { recursive: true });
  const proc = spawn(
    await findBrowser(),
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-sync',
      '--mute-audio',
      '--allow-file-access-from-files',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  let targets = [];
  for (let i = 0; i < 75; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      if (targets.some((t) => t.type === 'page')) break;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('browser did not start');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(JSON.stringify(msg.error)));
      else res(msg.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params }));
    });

  const b = {
    send,
    sleep,
    async viewport(width, height, dpr = 1, mobile = false) {
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: dpr,
        mobile,
        screenOrientation:
          width > height
            ? { type: 'landscapePrimary', angle: 90 }
            : { type: 'portraitPrimary', angle: 0 },
      });
      if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    },
    /** Render with a transparent page background (for PNGs that need alpha). */
    async transparent(on = true) {
      await send('Emulation.setDefaultBackgroundColorOverride', on ? { color: { r: 0, g: 0, b: 0, a: 0 } } : {});
    },
    async colorScheme(dark) {
      await send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }],
      });
    },
    async goto(url, settle = 2500) {
      await send('Page.navigate', { url });
      await sleep(settle);
    },
    async eval(expr) {
      const r = await send('Runtime.evaluate', {
        expression: expr,
        awaitPromise: true,
        returnByValue: true,
      });
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    },
    /** Click the first visible button-like element whose aria-label or text matches. */
    async click(text, wait = 900, timeout = 8000) {
      const t0 = Date.now();
      let ok = false;
      while (!ok && Date.now() - t0 < timeout) {
        ok = await b.eval(`(() => {
        const t = ${JSON.stringify(text)};
        const els = [...document.querySelectorAll('button,a,[role=button],[role=tab],[role=menuitem],[role=option],[role=switch],[role=radio]')]
          .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
        const label = e => (e.getAttribute('aria-label') || '').trim();
        const m = els.find(e => label(e) === t || e.textContent.trim() === t)
          || els.find(e => label(e).startsWith(t) || e.textContent.trim().startsWith(t));
        if (!m) return false; m.click(); return true; })()`);
        if (!ok) await sleep(250);
      }
      if (!ok) throw new Error('not found: ' + text);
      await sleep(wait);
    },
    async tryClick(text, wait) {
      try {
        await b.click(text, wait);
        return true;
      } catch {
        return false;
      }
    },
    async shot(path, format = 'png', quality = 90) {
      const r = await send('Page.captureScreenshot', format === 'jpeg' ? { format, quality, captureBeyondViewport: false } : { format, captureBeyondViewport: false });
      writeFileSync(path, Buffer.from(r.data, 'base64'));
    },
    async close() {
      try {
        await Promise.race([send('Browser.close'), sleep(1500)]);
      } catch {
        /* already gone */
      }
      await sleep(600);
      try {
        proc.kill();
      } catch {
        /* already gone */
      }
      await sleep(300);
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {
        /* locked: harmless temp dir */
      }
    },
  };
  await send('Page.enable');
  await send('Runtime.enable');
  if (clock) {
    const [hh, mm] = clock.split(':').map(Number);
    // Shift the page clock by a constant offset so the local time reads `clock`.
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        const R = Date; const t = new R(); t.setHours(${hh}, ${mm}, 0, 0);
        const off = t.getTime() - R.now();
        class D extends R { constructor(...a) { a.length ? super(...a) : super(R.now() + off); } static now() { return R.now() + off; } }
        globalThis.Date = D; })();`,
    });
  }
  return b;
}
