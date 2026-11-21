// The chosen app icon (option 3): a monitor with a pointer, showing a flat avocado-half
// cross-section, on an avocado-green gradient. Shared by build-icons.mjs (marketing) and
// app-assets.mjs (the app's own icon, splash and favicon files).
//
// All coordinates are in a 1024 x 1024 box centred on (512, 512); `art(scale)` scales the
// picture about the centre so callers can fit it to a safe zone.

export const GREEN_LIGHT = '#5f8f2e';
export const GREEN_DARK = '#2a4d1a';
export const GREEN_MID = '#44702a'; // solid stand-in for the gradient (Android adaptive background)

const PEAR =
  'M512 300 C566 300 590 362 612 420 C642 498 630 606 512 606 C394 606 382 498 412 420 C434 362 458 300 512 300 Z';
const POINTER = 'M0 0 L0 22 L5.5 16.8 L9.4 25.6 L13.2 24 L9.4 15.4 L16.6 15.2 Z';

/** Linear gradient definition with the given id. */
export const gradientDef = (id) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${GREEN_LIGHT}"/><stop offset="1" stop-color="${GREEN_DARK}"/></linearGradient>`;

/** The full-colour picture (no background). scale 0.78 = the store icon. */
export function art(scale = 0.78, cx = 512, cy = 512) {
  return `<g transform="translate(${cx} ${cy}) scale(${scale}) translate(-512 -512)">
  <rect x="184" y="214" width="656" height="476" rx="64" fill="#24401a" stroke="#f3f7e8" stroke-width="40"/>
  <path d="${PEAR}" fill="#4f7d24"/>
  <path d="${PEAR}" fill="#c9e37a" transform="translate(512 460) scale(0.84) translate(-512 -460)"/>
  <circle cx="512" cy="500" r="62" fill="#7a4a26"/>
  <path transform="translate(560 470) scale(5.4)" d="${POINTER}" fill="#ffffff" stroke="#24401a" stroke-width="1.6" stroke-linejoin="round"/>
  <rect x="392" y="752" width="240" height="42" rx="21" fill="#f3f7e8"/>
  </g>`;
}

/** One-colour silhouette for Android 13 themed icons (white on transparent). */
export function mono(scale = 0.62, color = '#ffffff') {
  return `<g transform="translate(512 512) scale(${scale}) translate(-512 -512)">
  <rect x="184" y="214" width="656" height="476" rx="64" fill="none" stroke="${color}" stroke-width="48"/>
  <path d="${PEAR} M438.7 504.4 a73.3 73.3 0 1 0 146.6 0 a73.3 73.3 0 1 0 -146.6 0 Z" fill="${color}" fill-rule="evenodd" transform="translate(512 460) scale(0.9) translate(-512 -460)"/>
  <rect x="392" y="752" width="240" height="46" rx="23" fill="${color}"/>
  </g>`;
}
