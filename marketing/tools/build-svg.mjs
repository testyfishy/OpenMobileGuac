// Generates the hand-written SVG sources for the banners and the store screenshot frames.
// Everything is drawn here (no fonts, images or artwork downloaded); the only bitmaps used are
// the real app captures in screenshots/raw/, referenced by relative path.
//
//   node marketing/tools/build-svg.mjs && node marketing/tools/render.mjs
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- palette (from app/src/index.css) ----------
export const C = {
  ink: '#0f1115', // dark background (--omg-bg, dark)
  surface: '#181b21', // dark surface
  border: '#2e333d',
  text: '#eceef2',
  muted: '#a2a9b6',
  mint: '#5cc8a8', // accent, dark theme
  mintInk: '#06231b', // text on mint
  teal: '#1f6f5c', // accent, light theme
  paper: '#f5f6f8', // light background
  paperText: '#15171c',
  paperMuted: '#5b6270',
  selected: '#e2f0eb',
  deep: '#0b2a24', // deep teal used for gradients (derived)
};
const FONT = "'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Roboto, Arial, sans-serif";
const MONO = "ui-monospace, 'SF Mono', Consolas, Menlo, monospace";

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------- brand mark (proposal) ----------
// A rounded tile with a screen, a pointer and the docked toolbar row: "a desktop you can touch".
export function mark(x, y, s, { tile = true } = {}) {
  const k = s / 100;
  return `<g transform="translate(${x} ${y}) scale(${k})">
    ${tile ? `<rect width="100" height="100" rx="23" fill="url(#markGrad)"/>` : ''}
    <rect x="20" y="24" width="60" height="42" rx="7" fill="none" stroke="#ffffff" stroke-width="6.5"/>
    <rect x="32" y="74" width="36" height="6.5" rx="3.25" fill="#ffffff"/>
    <path transform="translate(-3 -6)" d="M52 36 L52 60 L57.5 54.5 L61.5 63.5 L66 61.5 L62 52.8 L69.5 52.5 Z" fill="${C.mintInk}" stroke="#ffffff" stroke-width="3.2" stroke-linejoin="round"/>
  </g>`;
}
const markDefs = `<linearGradient id="markGrad" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#6fd6b6"/><stop offset="1" stop-color="${C.teal}"/></linearGradient>`;

// ---------- stylised phone with a generic remote desktop ----------
function wallpaperDefs(id) {
  return `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#173c4c"/><stop offset="0.55" stop-color="#2c6f72"/><stop offset="1" stop-color="#86c9ac"/></linearGradient>`;
}

function textLines(x, y, w, n, gap = 14, color = '#c9ced8') {
  let s = '';
  for (let i = 0; i < n; i++) {
    const lw = w * [0.92, 0.78, 0.86, 0.55, 0.7, 0.9][i % 6];
    s += `<rect x="${x}" y="${y + i * gap}" width="${lw}" height="6" rx="3" fill="${color}"/>`;
  }
  return s;
}

function windowBox(x, y, w, h, title, accent, body) {
  return `<g>
    <rect x="${x}" y="${y + 3}" width="${w}" height="${h}" rx="8" fill="#000" opacity="0.18"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="#f4f6f9"/>
    <path d="M${x} ${y + 8} a8 8 0 0 1 8 -8 h${w - 16} a8 8 0 0 1 8 8 v18 h-${w} z" fill="${accent}"/>
    <circle cx="${x + 14}" cy="${y + 13}" r="3.5" fill="#ffffff" opacity="0.85"/>
    <text x="${x + 24}" y="${y + 17.5}" font-family="${FONT}" font-size="11" font-weight="600" fill="#ffffff">${esc(title)}</text>
    <rect x="${x + w - 20}" y="${y + 7}" width="12" height="12" rx="2" fill="none" stroke="#ffffff" stroke-opacity="0.8" stroke-width="1.4"/>
    ${body}
  </g>`;
}

function pointer(x, y, s = 1) {
  return `<path transform="translate(${x} ${y}) scale(${s})" d="M0 0 L0 22 L5.5 16.8 L9.4 25.6 L13.2 24 L9.4 15.4 L16.6 15.2 Z" fill="#ffffff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/>`;
}

// Small line icons for the toolbar (24-unit box)
const ICON = {
  touch: '<path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5a1.5 1.5 0 0 1 3 0V12m0-1a1.5 1.5 0 0 1 3 0v3.5c0 3.5-2.5 6-6 6s-5.2-1.6-6.6-4L4 14a1.4 1.4 0 0 1 2.3-1.5L9 15"/>',
  keyboard: '<rect x="3" y="6.5" width="18" height="11" rx="2"/><path d="M6.5 10h1M10 10h1M13.5 10h1M17 10h.5M8 14h8"/>',
  keys: '<rect x="3" y="8" width="5" height="8" rx="1.5"/><rect x="9.5" y="8" width="5" height="8" rx="1.5"/><rect x="16" y="8" width="5" height="8" rx="1.5"/>',
  paste: '<rect x="6" y="4.5" width="12" height="16" rx="2"/><path d="M12 9v6m-3-3 3 3 3-3"/>',
  view: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><rect x="8.5" y="9" width="7" height="6" rx="1"/>',
  more: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><path d="M16.75 13.5v6.5M13.5 16.75H20"/>',
};
function icon(name, x, y, s, color) {
  return `<g transform="translate(${x} ${y}) scale(${s / 24})" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</g>`;
}

const TOOLBAR = [
  ['touch', 'Touch'],
  ['keyboard', 'Keyboard'],
  ['keys', 'Keys'],
  ['paste', 'Paste'],
  ['view', 'View'],
  ['more', 'More'],
];

// Desktop scene in portrait screen units (390 x 844)
function screenPortrait(wp) {
  const W = 390, H = 844;
  const keyY = 726, barY = 774;
  let keys = '';
  const labels = ['Esc', 'Tab', 'Ctrl', 'Alt', 'Shift', '←', '→'];
  let kx = 8;
  for (const l of labels) {
    const kw = l.length > 2 ? 50 : 40;
    keys += `<rect x="${kx}" y="${keyY + 7}" width="${kw}" height="34" rx="8" fill="#262b35"/>
      <text x="${kx + kw / 2}" y="${keyY + 29}" text-anchor="middle" font-family="${FONT}" font-size="13" font-weight="600" fill="${C.text}">${l}</text>`;
    kx += kw + 6;
  }
  let bar = '';
  TOOLBAR.forEach(([ic, l], i) => {
    const cx = 32 + i * 65.2;
    const active = ic === 'keys';
    if (active) bar += `<rect x="${cx - 30}" y="${barY + 5}" width="60" height="58" rx="12" fill="${C.mint}"/>`;
    const col = active ? C.mintInk : '#d7dbe2';
    bar += icon(ic, cx - 11, barY + 12, 22, col);
    bar += `<text x="${cx}" y="${barY + 51}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="${col}">${l}</text>`;
  });
  return `
    <rect width="${W}" height="${H}" fill="url(#${wp})"/>
    <circle cx="350" cy="560" r="180" fill="#ffffff" opacity="0.05"/>
    <circle cx="40" cy="700" r="120" fill="#ffffff" opacity="0.04"/>
    <rect width="${W}" height="40" fill="#11151b"/>
    <rect x="12" y="10" width="54" height="20" rx="10" fill="${C.mint}"/>
    <text x="39" y="24.5" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="700" fill="${C.mintInk}">Remote</text>
    <rect x="78" y="8" width="70" height="24" rx="4" fill="#2a303a"/>
    <rect x="96" y="18" width="34" height="5" rx="2.5" fill="#c9ced8"/>
    <rect x="154" y="8" width="70" height="24" rx="4" fill="#1d222a"/>
    <rect x="172" y="18" width="34" height="5" rx="2.5" fill="#7c8492"/>
    <text x="374" y="25" text-anchor="end" font-family="${FONT}" font-size="12" fill="#d7dbe2">09:41</text>
    ${windowBox(16, 62, 358, 300, 'Notes', '#2f6094', `
      <rect x="28" y="100" width="334" height="180" rx="3" fill="#ffffff" stroke="#3d78c8" stroke-width="1.5"/>
      ${textLines(38, 114, 300, 6, 16, '#9aa3b2')}
      <rect x="38" y="212" width="1.6" height="14" fill="#222"/>
      <rect x="28" y="296" width="80" height="7" rx="3.5" fill="#55606f"/>
      <rect x="28" y="316" width="150" height="6" rx="3" fill="#b4bbc7"/>
      <rect x="290" y="296" width="72" height="7" rx="3.5" fill="#b4bbc7"/>`)}
    ${windowBox(40, 390, 318, 260, 'Files', '#3c4a5c', `
      ${[0, 1, 2, 3, 4, 5]
        .map(
          (i) => `<rect x="54" y="${428 + i * 34}" width="18" height="15" rx="3" fill="${['#e9b949', '#5aa3e8', '#e9b949', '#9b8cf0', '#5cc8a8', '#e98a5a'][i]}"/>
          <rect x="82" y="${433 + i * 34}" width="${[150, 110, 170, 90, 130, 120][i]}" height="6" rx="3" fill="#7c8492"/>
          <rect x="300" y="${433 + i * 34}" width="44" height="6" rx="3" fill="#c3c9d3"/>`,
        )
        .join('')}`)}
    ${pointer(250, 230, 1.1)}
    <rect y="${keyY}" width="${W}" height="48" fill="#14171d"/>
    ${keys}
    <rect y="${barY}" width="${W}" height="${H - barY}" fill="#181b21"/>
    <rect y="${barY}" width="${W}" height="1" fill="#2e333d"/>
    ${bar}`;
}

// Landscape screen units (844 x 390): key column left, toolbar column right (the app's defaults)
function screenLandscape(wp) {
  const W = 844, H = 390;
  let keys = '';
  ['Esc', 'Tab', 'Ctrl', 'Alt', 'Shift', 'Win', '←'].forEach((l, i) => {
    keys += `<rect x="7" y="${8 + i * 53}" width="46" height="45" rx="9" fill="#262b35"/>
      <text x="30" y="${36 + i * 53}" text-anchor="middle" font-family="${FONT}" font-size="12" font-weight="600" fill="${C.text}">${l}</text>`;
  });
  let bar = '';
  ['touch', 'keyboard', 'keys', 'paste', 'view', 'more'].forEach((ic, i) => {
    const cy = 30 + i * 62;
    const active = ic === 'keys';
    if (active) bar += `<rect x="${W - 54}" y="${cy - 24}" width="48" height="48" rx="11" fill="${C.mint}"/>`;
    bar += icon(ic, W - 41, cy - 11, 22, active ? C.mintInk : '#d7dbe2');
  });
  const dx = 60, dw = W - 120;
  return `
    <rect width="${W}" height="${H}" fill="url(#${wp})"/>
    <circle cx="${dx + dw - 80}" cy="300" r="150" fill="#ffffff" opacity="0.05"/>
    <rect x="${dx}" width="${dw}" height="30" fill="#11151b"/>
    <rect x="${dx + 10}" y="7" width="54" height="17" rx="8.5" fill="${C.mint}"/>
    <text x="${dx + 37}" y="19.5" text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="700" fill="${C.mintInk}">Remote</text>
    <rect x="${dx + 76}" y="6" width="70" height="19" rx="4" fill="#2a303a"/>
    <rect x="${dx + 94}" y="14" width="34" height="4" rx="2" fill="#c9ced8"/>
    <text x="${dx + dw - 12}" y="20" text-anchor="end" font-family="${FONT}" font-size="11" fill="#d7dbe2">09:41</text>
    ${windowBox(dx + 18, 46, 340, 316, 'Notes', '#2f6094', `
      <rect x="${dx + 30}" y="84" width="316" height="200" rx="3" fill="#ffffff" stroke="#3d78c8" stroke-width="1.5"/>
      ${textLines(dx + 40, 98, 280, 7, 16, '#9aa3b2')}
      <rect x="${dx + 30}" y="300" width="90" height="7" rx="3.5" fill="#55606f"/>
      <rect x="${dx + 30}" y="320" width="170" height="6" rx="3" fill="#b4bbc7"/>`)}
    ${windowBox(dx + 376, 46, 330, 230, 'Files', '#3c4a5c', `
      ${[0, 1, 2, 3, 4]
        .map(
          (i) => `<rect x="${dx + 390}" y="${84 + i * 36}" width="18" height="15" rx="3" fill="${['#e9b949', '#5aa3e8', '#9b8cf0', '#5cc8a8', '#e98a5a'][i]}"/>
          <rect x="${dx + 418}" y="${89 + i * 36}" width="${[150, 110, 170, 90, 130][i]}" height="6" rx="3" fill="#7c8492"/>
          <rect x="${dx + 640}" y="${89 + i * 36}" width="44" height="6" rx="3" fill="#c3c9d3"/>`,
        )
        .join('')}`)}
    ${pointer(dx + 520, 300, 1.05)}
    <rect width="${dx}" height="${H}" fill="#14171d"/>
    ${keys}
    <rect x="${W - 60}" width="60" height="${H}" fill="#181b21"/>
    <rect x="${W - 60}" width="1" height="${H}" fill="#2e333d"/>
    ${bar}`;
}

let uid = 0;
/** Generic phone outline (drawn here, not from any vendor artwork). x,y top-left; w = outer width. */
export function phone(x, y, w, { landscape = false, shadow = true, content } = {}) {
  const id = `ph${++uid}`;
  const sw = landscape ? 844 : 390, sh = landscape ? 390 : 844; // screen units
  const bez = 14; // bezel in screen units
  const ow = sw + bez * 2, oh = sh + bez * 2;
  const k = w / ow;
  const r = 62;
  return `<g transform="translate(${x} ${y}) scale(${k})">
    <defs>${wallpaperDefs(id + 'wp')}
      <clipPath id="${id}c"><rect x="${bez}" y="${bez}" width="${sw}" height="${sh}" rx="${r - bez}"/></clipPath>
      <filter id="${id}s" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${landscape ? 22 : 26}"/></filter></defs>
    ${shadow ? `<rect x="10" y="${landscape ? 30 : 40}" width="${ow - 20}" height="${oh - 20}" rx="${r}" fill="#000" opacity="0.45" filter="url(#${id}s)"/>` : ''}
    <rect width="${ow}" height="${oh}" rx="${r}" fill="#07080a"/>
    <rect x="1.5" y="1.5" width="${ow - 3}" height="${oh - 3}" rx="${r - 1.5}" fill="none" stroke="#3a404b" stroke-width="3"/>
    <g clip-path="url(#${id}c)"><g transform="translate(${bez} ${bez})">${content ?? (landscape ? screenLandscape(id + 'wp') : screenPortrait(id + 'wp'))}</g></g>
  </g>`;
}
export const phoneHeight = (w, landscape) => (landscape ? (w * 418) / 872 : (w * 872) / 418);

// ---------- text helpers ----------
function lines(x, y, arr, { size, weight = 700, fill, lh = 1.12, anchor = 'start', family = FONT, ls = 0 }) {
  return arr
    .map((l, i) => {
      const parts = Array.isArray(l) ? l : [[l, fill]];
      const tspans = parts.map(([t, f]) => `<tspan fill="${f}">${esc(t)}</tspan>`).join('');
      return `<text x="${x}" y="${y + i * size * lh}" text-anchor="${anchor}" font-family="${family}" font-size="${size}" font-weight="${weight}" letter-spacing="${ls}">${tspans}</text>`;
    })
    .join('\n');
}

function pill(x, y, label, { dark = true, size = 20 } = {}) {
  const w = label.length * size * 0.56 + size * 1.4;
  const h = size * 1.9;
  return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${dark ? '#ffffff' : C.teal}" fill-opacity="${dark ? 0.07 : 0.08}" stroke="${dark ? '#ffffff' : C.teal}" stroke-opacity="${dark ? 0.16 : 0.28}"/>
    <text x="${x + w / 2}" y="${y + h * 0.66}" text-anchor="middle" font-family="${FONT}" font-size="${size}" font-weight="600" fill="${dark ? C.text : C.teal}">${esc(label)}</text></g>`;
}
const pillW = (label, size = 20) => label.length * size * 0.56 + size * 1.4;
function pills(x, y, labels, opts) {
  let s = '', cx = x;
  for (const l of labels) {
    s += pill(cx, y, l, opts);
    cx += pillW(l, opts?.size) + (opts?.size ?? 20) * 0.6;
  }
  return s;
}

// The app icon in banners is ONE external file: brand/banner-icon.svg (a 100 x 100 viewBox
// tile). To swap the icon, replace that file (for example with a copy of brand/icon-3.svg)
// and re-render. Every banner and the privacy cards reference it inside <g id="app-icon">.
function appIcon(x, y, s, rel = '../') {
  const href = rel + 'brand/banner-icon.svg';
  return `<g id="app-icon"><image x="${x}" y="${y}" width="${s}" height="${s}" href="${href}" xlink:href="${href}"/></g>`;
}

// Wordmark: the OMG icon (the mark) followed by the name "Open Mobile Guac".
function wordmark(x, y, s, { dark = true, rel = '../' } = {}) {
  return `${appIcon(x, y, s, rel)}
    <text x="${x + s * 1.24}" y="${y + s * 0.67}" font-family="${FONT}" font-size="${s * 0.5}" font-weight="700" letter-spacing="${-s * 0.004}" fill="${dark ? C.text : C.paperText}">Open Mobile Guac</text>`;
}

// The requirement line, always visible: "Requires your own Apache Guacamole server".
const REQUIRES = 'Requires your own Apache Guacamole server';
function reqBadge(x, y, size, { dark = true, text = REQUIRES } = {}) {
  const h = size * 2.1, w = text.length * size * 0.5 + size * 3.2;
  const col = dark ? C.mint : C.teal;
  return `<g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${col}" fill-opacity="${dark ? 0.12 : 0.1}" stroke="${col}" stroke-opacity="0.7" stroke-width="${size * 0.08}"/>
    <circle cx="${x + size * 1.15}" cy="${y + h / 2}" r="${size * 0.5}" fill="none" stroke="${col}" stroke-width="${size * 0.11}"/>
    <rect x="${x + size * 1.095}" y="${y + h / 2 - size * 0.06}" width="${size * 0.11}" height="${size * 0.32}" rx="${size * 0.05}" fill="${col}"/>
    <circle cx="${x + size * 1.15}" cy="${y + h / 2 - size * 0.22}" r="${size * 0.07}" fill="${col}"/>
    <text x="${x + size * 1.95}" y="${y + h * 0.66}" font-family="${FONT}" font-size="${size}" font-weight="600" fill="${col}">${esc(text)}</text>
  </g>`;
}

// ---------- backgrounds ----------
function bgDark(w, h, id = 'bg', dots = true) {
  return `<defs>
    <radialGradient id="${id}g1" cx="0.78" cy="0.35" r="0.65"><stop offset="0" stop-color="#1c5a4b" stop-opacity="0.95"/><stop offset="1" stop-color="${C.ink}" stop-opacity="0"/></radialGradient>
    <radialGradient id="${id}g2" cx="0.05" cy="1" r="0.6"><stop offset="0" stop-color="#173c4c" stop-opacity="0.7"/><stop offset="1" stop-color="${C.ink}" stop-opacity="0"/></radialGradient>
    <pattern id="${id}dots" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.3" fill="#ffffff" opacity="0.06"/></pattern>
  </defs>
  <rect width="${w}" height="${h}" fill="${C.ink}"/>
  <rect width="${w}" height="${h}" fill="url(#${id}g1)"/>
  ${dots ? `<rect width="${w}" height="${h}" fill="url(#${id}g2)"/>` : ""}
  ${dots ? `<rect width="${w}" height="${h}" fill="url(#${id}dots)"/>` : ""}`;
}
function bgLight(w, h, id = 'bg') {
  return `<defs>
    <linearGradient id="${id}l" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbfcfd"/><stop offset="1" stop-color="#dcefe7"/></linearGradient>
    <radialGradient id="${id}g1" cx="0.8" cy="0.45" r="0.55"><stop offset="0" stop-color="${C.mint}" stop-opacity="0.35"/><stop offset="1" stop-color="${C.mint}" stop-opacity="0"/></radialGradient>
    <pattern id="${id}grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="${C.teal}" stroke-opacity="0.07"/></pattern>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#${id}l)"/>
  <rect width="${w}" height="${h}" fill="url(#${id}grid)"/>
  <rect width="${w}" height="${h}" fill="url(#${id}g1)"/>`;
}

const svg = (w, h, body, title) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<title>${esc(title)}</title>
<defs>${markDefs}</defs>
${body}
</svg>
`;

const out = (rel, content) => {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
  console.log('wrote', rel);
};

// ---------- copy ----------
const HEAD = (fill, accent) => [[['Your remote desktop,', fill]], [['made for ', fill], ['touch.', accent]]];
const FACTS = ['Free & open source', 'No account', 'No tracking'];
const URL = 'github.com/testyfishy/OpenMobileGuac';
const UNOFFICIAL = 'Unofficial. Not affiliated with or endorsed by the Apache Software Foundation.';

// ===== brand =====
// The banner icon (brand/banner-icon.svg) is written by build-icons.mjs.

// ===== banners: concept A ("Midnight"), with a light variant of the README hero =====
function social() {
  const W = 1280, H = 640;
  return svg(W, H, `${bgDark(W, H)}
    ${wordmark(72, 52, 72)}
    ${lines(72, 258, HEAD(C.text, C.mint), { size: 62, fill: C.text, ls: -0.6 })}
    ${reqBadge(72, 370, 22)}
    ${pills(72, 462, FACTS, { size: 19 })}
    <text x="72" y="592" font-family="${FONT}" font-size="20" font-weight="600" fill="${C.mint}">${URL}</text>
    ${phone(890, 38, 272, {})}`, 'OMG (OpenMobileGuac) social preview');
}
out('banners/social-preview-1280x640.svg', social());

function hero(dark) {
  const W = 1600, H = 600;
  const m = dark ? C.muted : C.paperMuted;
  return svg(W, H, `${dark ? bgDark(W, H) : bgLight(W, H)}
    ${wordmark(90, 52, 76, { dark })}
    ${lines(90, 250, HEAD(dark ? C.text : C.paperText, dark ? C.mint : C.teal), { size: 66, fill: C.text, ls: -0.66 })}
    ${reqBadge(90, 368, 24, { dark })}
    ${pills(90, 462, ['Free & open source', 'iOS and Android', 'No account', 'No tracking'], { dark, size: 19 })}
    <text x="90" y="560" font-family="${FONT}" font-size="15" fill="${m}">${esc(UNOFFICIAL)}</text>
    ${phone(1090, 50, 236, {})}${phone(1230, 310, 330, { landscape: true })}`, `OMG (OpenMobileGuac) README hero, ${dark ? 'dark' : 'light'}`);
}
out('banners/readme-hero-dark-1600x600.svg', hero(true));
out('banners/readme-hero-light-1600x600.svg', hero(false));

out('banners/play-feature-graphic-1024x500.svg', svg(1024, 500, `${bgDark(1024, 500)}
  ${wordmark(56, 44, 68)}
  ${lines(56, 212, HEAD(C.text, C.mint), { size: 50, fill: C.text, ls: -0.5 })}
  ${reqBadge(56, 300, 17)}
  <text x="56" y="384" font-family="${FONT}" font-size="20" fill="${C.muted}">Free and open source. No account, no tracking.</text>
  ${phone(590, 150, 400, { landscape: true })}`, 'OMG (OpenMobileGuac) Play feature graphic'));

out('banners/link-card-1200x628.svg', svg(1200, 628, `${bgDark(1200, 628)}
  ${wordmark(64, 48, 72)}
  ${lines(64, 252, HEAD(C.text, C.mint), { size: 60, fill: C.text, ls: -0.6 })}
  ${reqBadge(64, 362, 21)}
  ${pills(64, 452, FACTS, { size: 18 })}
  <text x="64" y="578" font-family="${FONT}" font-size="19" font-weight="600" fill="${C.mint}">${URL}</text>
  ${phone(848, 56, 268)}`, 'OMG (OpenMobileGuac) link card'));

out('banners/square-1080x1080.svg', svg(1080, 1080, `${bgDark(1080, 1080)}
  ${wordmark(80, 70, 88)}
  ${lines(80, 300, HEAD(C.text, C.mint), { size: 70, fill: C.text, ls: -0.7 })}
  ${reqBadge(80, 430, 27)}
  ${pills(80, 522, FACTS, { size: 22 })}
  ${phone(190, 610, 700, { landscape: true })}
  <text x="540" y="1040" text-anchor="middle" font-family="${FONT}" font-size="22" font-weight="600" fill="${C.mint}">${URL}</text>`, 'OMG (OpenMobileGuac) square'));

// header 1500x500: bottom-left kept clear for a profile avatar
out('banners/header-1500x500.svg', svg(1500, 500, `${bgDark(1500, 500)}
  ${wordmark(90, 56, 70)}
  ${lines(90, 222, [[['Your remote desktop, made for ', C.text], ['touch.', C.mint]]], { size: 48, fill: C.text, ls: -0.5 })}
  ${reqBadge(90, 256, 20)}
  ${pills(90, 330, FACTS, { size: 17 })}
  ${phone(950, 300, 365, { landscape: true })}
  ${phone(1345, 24, 128)}`, 'OMG (OpenMobileGuac) header'));

// ===== store screenshots =====
// Each frame: brand background, caption on top, the real capture inside a drawn phone outline.
function captureInPhone(x, y, w, href, { landscape = false, rw, rh, tablet = false }) {
  // rw/rh: raw capture size (px). Screen rect keeps the capture's aspect ratio.
  const bez = w * 0.028;
  const sw = w - bez * 2;
  const sh = sw * (rh / rw);
  const oh = sh + bez * 2;
  const r = tablet ? w * 0.045 : landscape ? oh * 0.12 : w * 0.13;
  const id = `cap${++uid}`;
  return {
    h: oh,
    svg: `<g>
    <defs><clipPath id="${id}"><rect x="${x + bez}" y="${y + bez}" width="${sw}" height="${sh}" rx="${r - bez}"/></clipPath>
      <filter id="${id}s" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${w * 0.03}"/></filter></defs>
    <rect x="${x + w * 0.03}" y="${y + w * 0.06}" width="${w * 0.94}" height="${oh * 0.97}" rx="${r}" fill="#000" opacity="0.5" filter="url(#${id}s)"/>
    <rect x="${x}" y="${y}" width="${w}" height="${oh}" rx="${r}" fill="#07080a"/>
    <rect x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${oh - 4}" rx="${r - 2}" fill="none" stroke="#3a404b" stroke-width="4"/>
    <image x="${x + bez}" y="${y + bez}" width="${sw}" height="${sh}" href="${href}" xlink:href="${href}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>
  </g>`,
  };
}

const RAW = {
  iphone: [1290, 2796],
  'iphone-land': [2796, 1290],
  ipad: [2064, 2752],
};

// [file, raw capture, caption lines (accent word marked with *), kicker]
const IPHONE = [
  ['01-session', 'iphone-session', ['Your remote desktop,', 'made for *touch*'], '!Requires your own Apache Guacamole server'],
  ['02-keys', 'iphone-keys', ['Esc, Ctrl, Alt and', 'arrows, *one tap* away'], 'Extra key bar, with or without the keyboard'],
  ['03-landscape', 'STACK', ['Turn sideways for', 'the *full height*'], 'Toolbar and keys move to the sides'],
  ['04-keysets', 'iphone-keysets', ['Key sets for *every*', '*kind* of desktop'], 'Windows, macOS, Linux terminal, or your own'],
  ['05-gestures', 'iphone-gestures', ['Every gesture', '*explained*'], 'Animated, with switches to turn gestures off'],
  ['06-view', 'iphone-view', ['Fit, zoom or', '*pixel-perfect* 1:1'], 'Remembered for each connection'],
  ['07-more', 'iphone-more', ['Every option', 'is *a setting*'], 'Pointer, keyboard, toolbar, clipboard, sound'],
];

function caption(x, y, arr, size, color, accent, anchor = 'middle') {
  return arr
    .map((l, i) => {
      const parts = l.split('*').map((t, j) => `<tspan fill="${j % 2 ? accent : color}">${esc(t)}</tspan>`).join('');
      return `<text x="${x}" y="${y + i * size * 1.14}" text-anchor="${anchor}" font-family="${FONT}" font-size="${size}" font-weight="700" letter-spacing="${-size * 0.01}">${parts}</text>`;
    })
    .join('\n');
}

function storeFrame({ W, H, raw, rawKey, cap, kicker, phoneW, capSize, kickSize, capY, landscape = false, rel, tablet = false }) {
  const [rw, rh] = RAW[rawKey] ?? RAW['iphone-land'];
  if (raw === 'STACK') {
    const kickY0 = capY + capSize * 1.14 * (cap.length - 1) + kickSize * 2.1;
    const pw = W * 0.9, px0 = (W - pw) / 2;
    const ah = pw * 1290 / 2796 + pw * 0.056; const gap = kickSize * 3.2; const top = kickY0 + kickSize * 1.2; const y1 = top + (H - top - 2 * ah - gap) * 0.3;
    const a = captureInPhone(px0, y1, pw, rel + 'raw/iphone-land-keys.jpg', { landscape: true, rw: 2796, rh: 1290 });
    const y2 = y1 + a.h + gap;
    const b2 = captureInPhone(px0, y2, pw, rel + 'raw/iphone-land-session.jpg', { landscape: true, rw: 2796, rh: 1290 });
    return svg(W, H, `${bgDark(W, H, 'bg', false)}
    ${caption(W / 2, capY, cap, capSize, C.text, C.mint)}
    <text x="${W / 2}" y="${kickY0}" text-anchor="middle" font-family="${FONT}" font-size="${kickSize}" fill="${C.muted}">${esc(kicker)}</text>
    ${a.svg}
    <text x="${W / 2}" y="${y2 - kickSize * 0.9}" text-anchor="middle" font-family="${FONT}" font-size="${kickSize * 0.85}" fill="${C.muted}">Key column hidden: even more desktop</text>
    ${b2.svg}`, 'store screenshot');
  }
  const href = `${rel}raw/${raw}.jpg`;
  const px = (W - phoneW) / 2;
  const kickY = capY + capSize * 1.14 * (cap.length - 1) + kickSize * 2.1;
  const py = kickY + kickSize * 2.2;
  const p = captureInPhone(px, py, phoneW, href, { landscape, rw, rh, tablet });
  return svg(W, H, `${bgDark(W, H, 'bg', false)}
    ${caption(W / 2, capY, cap, capSize, C.text, C.mint)}
    <text x="${W / 2}" y="${kickY}" text-anchor="middle" font-family="${FONT}" font-size="${kickSize}" font-weight="${kicker.startsWith('!') ? 600 : 400}" fill="${kicker.startsWith('!') ? C.mint : C.muted}">${esc(kicker.replace(/^!/, ''))}</text>
    ${p.svg}`, 'store screenshot');
}

// iPhone 6.9" portrait 1290 x 2796
for (const [file, raw, cap, kicker] of IPHONE) {
  const land = raw.includes('land');
  out(
    `screenshots/iphone-6.9/${file}.svg`,
    storeFrame({
      W: 1290, H: 2796, raw, rawKey: land ? 'iphone-land' : 'iphone', cap, kicker,
      phoneW: land ? 1180 : 1010, capSize: 104, kickSize: 44, capY: 250, landscape: land, rel: '../',
    }),
  );
}
// privacy card (typographic, no capture)
function privacyCard(W, H, s, lock = 'Face ID, Touch ID or device passcode.') {
  const items = [
    ['No account', 'The app talks only to the servers you add.'],
    ['No ads, no tracking', 'No analytics, ad or tracking SDKs.'],
    ['Your keychain', 'Saved passwords stay in secure storage.'],
    ['App lock', lock],
    ['Open source', 'GPL-3.0. Read it, build it yourself.'],
  ];
  const x = W * 0.12;
  let rows = '';
  items.forEach(([t, d], i) => {
    const y = 660 * s + i * Math.min(300 * s, (H - 520 * s - 660 * s) / 5);
    rows += `<circle cx="${x + 34 * s}" cy="${y - 16 * s}" r="${34 * s}" fill="${C.mint}" opacity="0.16"/>
      <path transform="translate(${x + 14 * s} ${y - 36 * s}) scale(${1.65 * s})" d="M6 13l5 5 13-13" fill="none" stroke="${C.mint}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="${x + 100 * s}" y="${y}" font-family="${FONT}" font-size="${64 * s}" font-weight="700" fill="${C.text}">${esc(t)}</text>
      <text x="${x + 100 * s}" y="${y + 70 * s}" font-family="${FONT}" font-size="${40 * s}" fill="${C.muted}">${esc(d)}</text>`;
  });
  return svg(W, H, `${bgDark(W, H, 'bg', false)}
    ${caption(W / 2, 250 * s, ['Private by', '*design*'], 104 * s, C.text, C.mint)}
    ${rows}
    ${appIcon(W / 2 - 80 * s, H - 420 * s, 160 * s, '../../')}
    <text x="${W / 2}" y="${H - 190 * s}" text-anchor="middle" font-family="${FONT}" font-size="${44 * s}" font-weight="600" fill="${C.text}">Free. No paid tier.</text>
    <text x="${W / 2}" y="${H - 120 * s}" text-anchor="middle" font-family="${FONT}" font-size="${32 * s}" fill="${C.muted}">${URL}</text>`, 'store screenshot: privacy');
}
out('screenshots/iphone-6.9/08-privacy.svg', privacyCard(1290, 2796, 1));

// iPhone 6.9" landscape option 2796 x 1290
out('screenshots/iphone-6.9-landscape/01-landscape.svg', (() => {
  const W = 2796, H = 1290;
  const p = captureInPhone(1060, 222, 1620, '../raw/iphone-land-keys.jpg', { landscape: true, rw: 2796, rh: 1290 });
  return svg(W, H, `${bgDark(W, H, 'bg', false)}
    ${caption(120, 470, ['Turn sideways', 'for the *full height*'], 110, C.text, C.mint, 'start')}
    <text x="120" y="720" font-family="${FONT}" font-size="46" fill="${C.muted}">Toolbar and keys move to the sides,</text>
    <text x="120" y="782" font-family="${FONT}" font-size="46" fill="${C.muted}">leaving the whole height for the desktop.</text>
    ${p.svg}`, 'store screenshot landscape');
})());

// iPad 13" 2064 x 2752
const IPAD = [
  ['01-session', 'ipad-session', ['Your remote desktop,', 'made for *touch*'], '!Requires your own Apache Guacamole server'],
  ['02-keys', 'ipad-keys', ['Esc, Ctrl, Alt and', 'arrows, *one tap* away'], 'Extra key bar, with or without the keyboard'],
  ['03-more', 'ipad-more', ['Every option', 'is *a setting*'], 'Pointer, keyboard, toolbar, clipboard, sound'],
  ['04-gestures', 'ipad-gestures', ['Every gesture', '*explained*'], 'Animated, with switches to turn gestures off'],
];
for (const [file, raw, cap, kicker] of IPAD) {
  out(
    `screenshots/ipad-13/${file}.svg`,
    storeFrame({ W: 2064, H: 2752, raw, rawKey: 'ipad', cap, kicker, phoneW: 1640, capSize: 118, kickSize: 50, capY: 230, rel: '../', tablet: true }),
  );
}
out('screenshots/ipad-13/05-privacy.svg', privacyCard(2064, 2752, 1.2));

// Google Play phone 1080 x 1920
for (const [file, raw, cap, kicker] of IPHONE) {
  const land = raw.includes('land');
  out(
    `screenshots/play-phone/${file}.svg`,
    storeFrame({
      W: 1080, H: 1920, raw, rawKey: land ? 'iphone-land' : 'iphone', cap, kicker,
      phoneW: land ? 1000 : 640, capSize: 76, kickSize: 32, capY: 160, landscape: land, rel: '../',
    }),
  );
}
out('screenshots/play-phone/08-privacy.svg', privacyCard(1080, 1920, 0.72, 'Fingerprint, face unlock or device PIN.'));
