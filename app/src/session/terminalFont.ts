/**
 * Terminal font size and colour scheme for SSH, telnet and Kubernetes sessions (AUDIT §4,
 * DWService parity #4). Pure.
 *
 * guacamole-server 1.6.0 registers `color-scheme`, `font-name` and `font-size` as argv
 * parameters for these protocols (`ssh/client.c` 82-84, `telnet/client.c` 87-89,
 * `kubernetes/client.c` 134-136) with `GUAC_ARGV_OPTION_ECHO` and without ONCE, so a
 * non-read-only user may change them any number of times during the session; the new value
 * is echoed to every user. `font-size` is an integer in points (≤ 0 is ignored, default 12;
 * applied at the session DPI). `color-scheme` takes a preset name or a custom
 * `foreground: …; background: …` list (`terminal/color-scheme.c`).
 */

export const TERMINAL_PROTOCOLS: ReadonlySet<string> = new Set(['ssh', 'telnet', 'kubernetes']);

export const FONT_SIZE_MIN = 6;
export const FONT_SIZE_MAX = 48;
export const FONT_SIZE_DEFAULT = 12;

/** guacd's preset colour schemes (`terminal/color-scheme.h`). */
export const COLOR_SCHEMES = ['gray-black', 'black-white', 'green-black', 'white-black'] as const;
export type ColorScheme = (typeof COLOR_SCHEMES)[number];

/** The font size the server reported, or the default when unknown or not a number. */
export function parseFontSize(value: string | undefined): number {
  const n = value === undefined ? NaN : Number.parseInt(value.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : FONT_SIZE_DEFAULT;
}

function clamp(n: number): number {
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(n)));
}

/** − / + buttons: one point per step. */
export function stepFontSize(current: number, delta: number): number {
  return clamp(current + delta);
}

/** Pinch: the size scaled by the pinch ratio since the fingers landed. */
export function fontSizeAfterPinch(current: number, totalScale: number): number {
  if (!Number.isFinite(totalScale) || totalScale <= 0) return clamp(current);
  return clamp(current * totalScale);
}

/** The next preset after the current scheme (a custom scheme starts again at the first). */
export function nextColorScheme(current: string | undefined): ColorScheme {
  const i = COLOR_SCHEMES.indexOf((current ?? '') as ColorScheme);
  return COLOR_SCHEMES[(i + 1) % COLOR_SCHEMES.length] ?? 'gray-black';
}
