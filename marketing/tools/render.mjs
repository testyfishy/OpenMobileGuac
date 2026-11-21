// Render SVG sources to opaque PNGs at their exact pixel size with headless Edge.
//
//   node marketing/tools/render.mjs                 every .svg under banners/ and screenshots/
//   node marketing/tools/render.mjs social          only files whose path contains "social"
//
// The PNG is written next to its SVG. Size comes from the root <svg width= height=>.
import { launch, sleep } from './cdp.mjs';
import { toRgb, pngInfo } from './png.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const filters = args.filter((a) => !a.startsWith('--'));

const walk = (d) =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const svgs = [...walk(join(root, 'banners')), ...walk(join(root, 'screenshots')), ...walk(join(root, 'brand'))]
  .filter((p) => p.endsWith('.svg') && !/[\\/]alternatives[\\/]/.test(p))
  .filter((p) => !filters.length || filters.some((f) => p.replace(/\\/g, '/').includes(f)));

const b = await launch();
try {
  for (const p of svgs) {
    const head = readFileSync(p, 'utf8').slice(0, 600);
    const w = Number(/<svg[^>]*\swidth="(\d+)"/.exec(head)?.[1]);
    const h = Number(/<svg[^>]*\sheight="(\d+)"/.exec(head)?.[1]);
    if (!w || !h) {
      console.warn('skip (no width/height):', relative(root, p));
      continue;
    }
    await b.viewport(w, h, 1, false);
    await b.goto(pathToFileURL(p).href, 400);
    await b.eval('document.fonts ? document.fonts.ready.then(() => true) : true');
    await sleep(300);
    const out = p.replace(/\.svg$/, '.png');
    await b.shot(out);
    const rgb = toRgb(readFileSync(out));
    writeFileSync(out, rgb);
    const info = pngInfo(rgb);
    const ok = info.width === w && info.height === h ? '' : `  SIZE MISMATCH ${info.width}x${info.height}`;
    console.log(`${relative(root, out)}  ${w}x${h}  ${(rgb.length / 1024).toFixed(0)} KB${ok}`);
  }
} finally {
  await b.close();
}
