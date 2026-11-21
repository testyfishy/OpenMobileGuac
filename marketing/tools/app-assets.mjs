// Writes the app's own icon, splash and favicon files from the chosen icon (option 3,
// tools/icon-art.mjs). Every PNG is rendered from vector at the exact pixel size of the file it
// replaces (read from that file first), so nothing is resampled and the sizes cannot drift.
//
//   node marketing/tools/app-assets.mjs
//
// iOS app icon and all splash images: opaque RGB (no alpha, no rounded corners: iOS masks it).
// Android legacy/round launcher icons, adaptive foreground and monochrome: RGBA.
import { launch, sleep } from './cdp.mjs';
import { toRgb, pngInfo } from './png.mjs';
import { art, mono, gradientDef, GREEN_MID } from './icon-art.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const app = (p) => join(repo, 'app', p);
const RES = app('android/app/src/main/res');

const doc = (w, h, body, defs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${gradientDef('g')}${defs}</defs>${body}</svg>`;
// The 1024 picture placed in a square of side s centred in w x h.
const placed = (w, h, s, inner) => `<svg x="${(w - s) / 2}" y="${(h - s) / 2}" width="${s}" height="${s}" viewBox="0 0 1024 1024">${inner}</svg>`;

const kinds = {
  // full-bleed square, opaque
  iosIcon: (w, h) => doc(w, h, `<rect width="${w}" height="${h}" fill="url(#g)"/>${placed(w, h, w, art(0.78))}`),
  // brand-coloured splash with the picture centred
  splash: (w, h, s) => doc(w, h, `<rect width="${w}" height="${h}" fill="url(#g)"/>${placed(w, h, s, art(1))}`),
  // legacy square launcher icon: rounded tile with a small margin, transparent outside
  legacy: (w) => {
    const m = w * 0.04, t = w - 2 * m;
    return doc(w, w, `<rect x="${m}" y="${m}" width="${t}" height="${t}" rx="${t * 0.2}" fill="url(#g)"/>${placed(w, w, t, art(0.78))}`);
  },
  round: (w) => {
    const m = w * 0.04, t = w - 2 * m;
    return doc(w, w, `<circle cx="${w / 2}" cy="${w / 2}" r="${t / 2}" fill="url(#g)"/>${placed(w, w, t, art(0.7))}`);
  },
  // adaptive foreground: picture inside the 66 dp safe circle of the 108 dp canvas
  foreground: (w) => doc(w, w, placed(w, w, w, art(0.64))),
  monochrome: (w) => doc(w, w, placed(w, w, w, mono(0.64))),
};

const jobs = [];
const job = (path, kind, { alpha = false, sizeFrom = path, splashScale } = {}) => {
  if (!existsSync(sizeFrom)) throw new Error('missing ' + sizeFrom);
  const { width, height } = pngInfo(readFileSync(sizeFrom));
  jobs.push({ path, kind, alpha, width, height, splashScale });
};

// iOS
job(app('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'), 'iosIcon');
for (const f of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'])
  job(app('ios/App/App/Assets.xcassets/Splash.imageset/' + f), 'splash', { splashScale: 0.26 });

// Android
for (const d of readdirSync(RES)) {
  const dir = join(RES, d);
  if (d.startsWith('mipmap-') && d !== 'mipmap-anydpi-v26') {
    job(join(dir, 'ic_launcher.png'), 'legacy', { alpha: true });
    job(join(dir, 'ic_launcher_round.png'), 'round', { alpha: true });
    job(join(dir, 'ic_launcher_foreground.png'), 'foreground', { alpha: true });
    job(join(dir, 'ic_launcher_monochrome.png'), 'monochrome', { alpha: true, sizeFrom: join(dir, 'ic_launcher_foreground.png') });
  }
  if (d.startsWith('drawable') && existsSync(join(dir, 'splash.png')))
    job(join(dir, 'splash.png'), 'splash', { splashScale: 0.42 });
}

const tmp = mkdtempSync(join(tmpdir(), 'omg-assets-'));
const b = await launch();
try {
  let i = 0;
  for (const j of jobs) {
    const svgText =
      j.kind === 'splash'
        ? kinds.splash(j.width, j.height, Math.min(j.width, j.height) * j.splashScale)
        : kinds[j.kind](j.width, j.height);
    const f = join(tmp, `a${i++}.svg`);
    writeFileSync(f, svgText);
    await b.transparent(j.alpha);
    await b.viewport(j.width, j.height, 1, false);
    await b.goto(pathToFileURL(f).href, 300);
    await sleep(150);
    await b.shot(j.path);
    let buf = readFileSync(j.path);
    if (!j.alpha) {
      buf = toRgb(buf);
      writeFileSync(j.path, buf);
    }
    const info = pngInfo(buf);
    const ok = info.width === j.width && info.height === j.height;
    console.log(`${ok ? 'ok ' : 'BAD'} ${info.width}x${info.height} ct${info.colorType} ${j.path.slice(repo.length + 1)}`);
    if (!ok) process.exitCode = 1;
  }
} finally {
  await b.close();
  rmSync(tmp, { recursive: true, force: true });
}

// Adaptive icon background colour (the template references @color/ic_launcher_background).
const bgXml = join(RES, 'values/ic_launcher_background.xml');
writeFileSync(
  bgXml,
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${GREEN_MID.toUpperCase()}</color>\n</resources>\n`,
);
// Adaptive icon XML: same layers as the template, plus a monochrome layer (Android 13 themed icons).
for (const f of ['ic_launcher.xml', 'ic_launcher_round.xml'])
  writeFileSync(
    join(RES, 'mipmap-anydpi-v26', f),
    `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@color/ic_launcher_background"/>\n    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>\n</adaptive-icon>\n`,
  );
// Web favicon: the icon with app-icon corners.
writeFileSync(
  app('public/favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><defs>${gradientDef('g')}<clipPath id="c"><rect width="1024" height="1024" rx="230"/></clipPath></defs><g clip-path="url(#c)"><rect width="1024" height="1024" fill="url(#g)"/>${art(0.78)}</g></svg>\n`,
);
console.log('wrote ic_launcher_background.xml, mipmap-anydpi-v26/*.xml, public/favicon.svg');
