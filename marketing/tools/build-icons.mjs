// App icon options (proposals) for Open Mobile Guac / OMG, drawn as geometric SVG.
// Letters are strokes, not a font, so they look the same everywhere.
//
//   node marketing/tools/build-icons.mjs && node marketing/tools/render.mjs brand/
//
// Rules kept by every option:
// - 1024 x 1024, full-bleed opaque background (iOS master: no transparency; iOS rounds the corners).
// - All key content inside the central 66 % (x and y 174..850) for Android adaptive icons.
// - Thick strokes, no detail smaller than about 3 % of the icon, so it reads at 60 px.
// - No Apache feather, no Apache Guacamole logo or its shapes, no lettering other than "OMG".
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { art, gradientDef } from './icon-art.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Which option the banners show (brand/banner-icon.svg). Change this, or replace that file.
const BANNER_ICON = 'icon-3'; // owner's choice (2026-11-21)
const bodies = {};
const out = (rel, s) => {
  const m = /brand\/(icon-\d)\.svg/.exec(rel);
  if (m) bodies[m[1]] = s;
  writeFileSync(join(root, rel), s);
  console.log('wrote', rel);
};
const svg = (body, title, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1024" height="1024" viewBox="0 0 1024 1024">
<title>${title}</title>
<defs>${defs}</defs>
${body}
</svg>
`;

/** "OMG" as round-capped strokes. x = left edge, cy = vertical centre, h = cap height. Width 3.3 h. */
export function omg(x, cy, h, sw, color) {
  const g = h * 0.17;
  const r = (h - sw) / 2;
  const top = cy - h / 2 + sw / 2, bot = cy + h / 2 - sw / 2;
  // O
  const ox = x + h / 2;
  // M
  const mx0 = x + h + g + sw / 2, mx1 = x + h + g + h * 0.96 - sw / 2, mxm = (mx0 + mx1) / 2;
  // G: open at the upper right, bar into the middle
  const gc = x + h + g + h * 0.96 + g + h / 2;
  const a = (-48 * Math.PI) / 180;
  const p1 = [gc + r * Math.cos(a), cy + r * Math.sin(a)];
  return `<g fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="${ox}" cy="${cy}" r="${r}"/>
    <path d="M${mx0} ${bot} V${top} L${mxm} ${cy + h * 0.14} L${mx1} ${top} V${bot}"/>
    <path d="M${p1[0].toFixed(1)} ${p1[1].toFixed(1)} A${r} ${r} 0 1 0 ${gc + r} ${cy} H${gc + r * 0.08}"/>
  </g>`;
}
const omgWidth = (h) => h * (1 + 0.17 + 0.96 + 0.17 + 1);

const grad = (id, a, b) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;

// ---------- 1: OMG lettering on the app's teal ----------
{
  const h = 172, w = omgWidth(h);
  out('brand/alternatives/icon-1.svg', svg(`<rect width="1024" height="1024" fill="url(#g1)"/>
  <circle cx="820" cy="190" r="420" fill="#ffffff" opacity="0.06"/>
  ${omg((1024 - w) / 2, 512, h, 48, '#ffffff')}`,
  'Icon option 1: OMG lettering', grad('g1', '#6fd6b6', '#1f6f5c')));
}

// ---------- 2: a screen with OMG inside ----------
{
  const h = 118, w = omgWidth(h);
  out('brand/alternatives/icon-2.svg', svg(`<rect width="1024" height="1024" fill="url(#g2)"/>
  <rect x="262" y="300" width="500" height="360" rx="56" fill="#0b1f1a" stroke="#5cc8a8" stroke-width="36"/>
  ${omg((1024 - w) / 2, 480, h, 32, '#eceef2')}
  <rect x="422" y="702" width="180" height="34" rx="17" fill="#5cc8a8"/>`,
  'Icon option 2: screen with OMG', grad('g2', '#1b2027', '#0f1115')));
}

// ---------- 3: screen + pointer with an avocado-half cue ----------
// A flat, symmetric avocado cross-section (lime flesh, round brown pit) drawn here, shown as
// the picture on a monitor with a pointer on top. No bowl, no chips, no face, no lettering.
{
  out('brand/icon-3.svg', svg(`<rect width="1024" height="1024" fill="url(#g3)"/>
  ${art(0.78)}`,
  'App icon (option 3): screen and pointer, avocado cue', gradientDef('g3')));
}

// Google Play store icon, 512 x 512 (Play applies its own mask).
writeFileSync(join(root, 'brand/play-icon-512.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 1024 1024">
<title>Google Play icon 512</title>
<defs>${gradientDef('g3')}</defs>
<rect width="1024" height="1024" fill="url(#g3)"/>
${art(0.78)}
</svg>
`);
console.log('wrote brand/play-icon-512.svg');

// ---------- 4: a key cap with OMG (the extra key bar is the app's signature) ----------
{
  const h = 118, w = omgWidth(h);
  out('brand/alternatives/icon-4.svg', svg(`<rect width="1024" height="1024" fill="url(#g4)"/>
  <rect x="257" y="326" width="510" height="410" rx="84" fill="#0b2a24" opacity="0.55"/>
  <rect x="257" y="296" width="510" height="410" rx="84" fill="#14453a"/>
  <rect x="283" y="312" width="458" height="346" rx="64" fill="url(#cap)"/>
  ${omg((1024 - w) / 2, 485, h, 34, '#0b3a2f')}`,
  'Icon option 4: OMG key cap',
  grad('g4', '#3c9f7c', '#1a4f43') + grad('cap', '#e9fbf3', '#b6ebd7')));
}

// ---------- banner icon: the chosen option with app-icon corners, as one swappable file ----------
{
  const src = bodies[BANNER_ICON];
  const inner = src.replace(/^[\s\S]*?<\/title>\n/, '').replace(/<\/svg>\s*$/, '');
  writeFileSync(
    join(root, 'brand/banner-icon.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
<!-- copy of ${BANNER_ICON}, clipped to app-icon corners; used by every banner -->
<clipPath id="bi"><rect width="1024" height="1024" rx="230"/></clipPath>
<g clip-path="url(#bi)">
${inner}</g>
</svg>
`,
  );
  console.log('wrote brand/banner-icon.svg from', BANNER_ICON);
}

// The comparison sheet of the four options (brand/alternatives/icon-options-sheet.png) was
// rendered when all four PNGs existed; it is kept as a record and no longer regenerated.
