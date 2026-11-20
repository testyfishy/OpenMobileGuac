import { isSet, sameValue, withValue } from './formModel.ts';

/**
 * "Performance & quality" presets (docs/protocol-notes.md §8.6). A preset is nothing but
 * ordinary connection parameters; every name and value below exists in the Guacamole 1.6.0
 * protocol definitions (`guacamole-ext/.../protocols/rdp.json`, `vnc.json`). `""` means
 * "unset" (server default; for a BOOLEAN, off).
 *
 * Notes on the choices:
 * - RDP: guacd forces 32 bpp while the graphics pipeline (GFX) is on, which is the default.
 *   The low-bandwidth preset therefore sets `disable-gfx` too, or its `color-depth` would be
 *   ignored.
 * - RDP has no `enable-audio` in 1.6.0; audio is turned off with `disable-audio`.
 * - VNC `quality-level` / `compress-level` only affect encodings that use them (Tight).
 */

export type PresetId = 'best' | 'balanced' | 'low';
export const PRESET_IDS: readonly PresetId[] = ['best', 'balanced', 'low'];

type PresetTable = Readonly<Record<PresetId, Readonly<Record<string, string>>>>;

const RDP: PresetTable = {
  best: {
    'color-depth': '32',
    'force-lossless': 'true',
    'disable-gfx': '',
    'resize-method': 'display-update',
    'enable-wallpaper': 'true',
    'enable-theming': 'true',
    'enable-font-smoothing': 'true',
    'enable-full-window-drag': 'true',
    'enable-desktop-composition': 'true',
    'enable-menu-animations': 'true',
    'disable-bitmap-caching': '',
    'disable-offscreen-caching': '',
    'disable-glyph-caching': '',
    'disable-audio': '',
  },
  balanced: {
    'color-depth': '24',
    'force-lossless': '',
    'disable-gfx': '',
    'resize-method': 'display-update',
    'enable-wallpaper': '',
    'enable-theming': 'true',
    'enable-font-smoothing': 'true',
    'enable-full-window-drag': '',
    'enable-desktop-composition': '',
    'enable-menu-animations': '',
    'disable-bitmap-caching': '',
    'disable-offscreen-caching': '',
    'disable-glyph-caching': '',
    'disable-audio': '',
  },
  low: {
    'color-depth': '16',
    'force-lossless': '',
    'disable-gfx': 'true',
    'resize-method': 'display-update',
    'enable-wallpaper': '',
    'enable-theming': '',
    'enable-font-smoothing': '',
    'enable-full-window-drag': '',
    'enable-desktop-composition': '',
    'enable-menu-animations': '',
    'disable-bitmap-caching': '',
    'disable-offscreen-caching': '',
    'disable-glyph-caching': '',
    'disable-audio': 'true',
  },
};

const VNC: PresetTable = {
  best: {
    'color-depth': '32',
    'force-lossless': 'true',
    'quality-level': '9',
    'compress-level': '',
    'enable-audio': '',
  },
  balanced: {
    'color-depth': '24',
    'force-lossless': '',
    'quality-level': '',
    'compress-level': '',
    'enable-audio': '',
  },
  low: {
    'color-depth': '16',
    'force-lossless': '',
    'quality-level': '3',
    'compress-level': '9',
    'enable-audio': '',
  },
};

const PRESETS: Readonly<Record<string, PresetTable>> = { rdp: RDP, vnc: VNC };

/**
 * Parameters shown in the quick section, in order. Only those the server's schema lists are
 * shown (other versions may lack some).
 */
const QUICK_FIELDS: Readonly<Record<string, readonly string[]>> = {
  rdp: [
    'color-depth',
    'force-lossless',
    'disable-gfx',
    'resize-method',
    'enable-wallpaper',
    'enable-theming',
    'enable-font-smoothing',
    'enable-full-window-drag',
    'enable-desktop-composition',
    'enable-menu-animations',
    'disable-bitmap-caching',
    'disable-offscreen-caching',
    'disable-glyph-caching',
    'disable-audio',
  ],
  vnc: [
    'color-depth',
    'force-lossless',
    'quality-level',
    'compress-level',
    'cursor',
    'enable-audio',
  ],
};

export function hasPresets(protocol: string): boolean {
  return protocol in PRESETS;
}

export function quickFields(protocol: string, known: ReadonlySet<string>): string[] {
  return (QUICK_FIELDS[protocol] ?? []).filter((n) => known.has(n));
}

export function presetValues(protocol: string, preset: PresetId): Readonly<Record<string, string>> {
  return PRESETS[protocol]?.[preset] ?? {};
}

export interface ParameterChange {
  readonly name: string;
  /** Current value (`""` = unset). */
  readonly from: string;
  /** Value the preset sets (`""` = unset / off). */
  readonly to: string;
}

/**
 * Exactly the parameters a preset would change, in the preset's order. Parameters the
 * server's schema does not list are skipped (when `known` is given), so a preset never adds
 * a name the server does not understand.
 */
export function presetChanges(
  protocol: string,
  preset: PresetId,
  values: Readonly<Record<string, string>>,
  known?: ReadonlySet<string>,
): ParameterChange[] {
  const out: ParameterChange[] = [];
  for (const [name, to] of Object.entries(presetValues(protocol, preset))) {
    if (known && !known.has(name)) continue;
    const from = values[name] ?? '';
    if (!sameValue(from, to)) out.push({ name, from, to });
  }
  return out;
}

export function applyChanges(
  values: Readonly<Record<string, string>>,
  changes: readonly ParameterChange[],
): Record<string, string> {
  let next: Record<string, string> = { ...values };
  for (const c of changes) next = withValue(next, c.name, c.to);
  return next;
}

/** The preset whose values all match, if any (for the "current: Balanced" hint). */
export function matchingPreset(
  protocol: string,
  values: Readonly<Record<string, string>>,
  known?: ReadonlySet<string>,
): PresetId | undefined {
  if (!hasPresets(protocol)) return undefined;
  return PRESET_IDS.find((p) => presetChanges(protocol, p, values, known).length === 0);
}

/** Whether any quick-section parameter has a value (for "set vs default" summaries). */
export function anyQuickSet(protocol: string, values: Readonly<Record<string, string>>): boolean {
  return (QUICK_FIELDS[protocol] ?? []).some((n) => isSet(values[n]));
}
