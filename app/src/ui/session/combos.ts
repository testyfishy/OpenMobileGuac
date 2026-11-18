/**
 * User-defined key combos (KEY-4): the list persisted as `settings.customCombos`, edited by
 * a small pure reducer. Entries are stored in canonical form (`formatCombo`).
 */

import { COMBO_PRESETS, formatCombo, parseCombo, type Combo } from '../../session/keys/KeyModel.ts';

export const MAX_CUSTOM_COMBOS = 30;

export type ComboListAction =
  | { readonly type: 'add'; readonly text: string }
  | { readonly type: 'remove'; readonly index: number }
  | { readonly type: 'move'; readonly index: number; readonly delta: -1 | 1 };

export type ComboListResult =
  | { readonly ok: true; readonly list: string[] }
  | { readonly ok: false; readonly error: string; readonly list: string[] };

/** Validate input text; returns the canonical form or an error. */
export function validateCombo(
  text: string,
): { ok: true; canonical: string } | { ok: false; error: string } {
  const r = parseCombo(text);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, canonical: formatCombo(r.combo) };
}

export function reduceComboList(list: readonly string[], action: ComboListAction): ComboListResult {
  const current = [...list];
  switch (action.type) {
    case 'add': {
      const v = validateCombo(action.text);
      if (!v.ok) return { ok: false, error: v.error, list: current };
      if (current.some((c) => sameCombo(c, v.canonical))) {
        return { ok: false, error: 'That combo is already in the list', list: current };
      }
      if (current.length >= MAX_CUSTOM_COMBOS) {
        return { ok: false, error: `At most ${MAX_CUSTOM_COMBOS} combos`, list: current };
      }
      return { ok: true, list: [...current, v.canonical] };
    }
    case 'remove': {
      if (action.index < 0 || action.index >= current.length) return { ok: true, list: current };
      current.splice(action.index, 1);
      return { ok: true, list: current };
    }
    case 'move': {
      const from = action.index;
      const to = from + action.delta;
      if (from < 0 || from >= current.length || to < 0 || to >= current.length) {
        return { ok: true, list: current };
      }
      const [item] = current.splice(from, 1);
      if (item !== undefined) current.splice(to, 0, item);
      return { ok: true, list: current };
    }
  }
}

function sameCombo(a: string, b: string): boolean {
  const pa = parseCombo(a);
  const pb = parseCombo(b);
  if (!pa.ok || !pb.ok) return a === b;
  return formatCombo(pa.combo) === formatCombo(pb.combo);
}

export interface ComboMenuEntry {
  readonly key: string;
  readonly label: string;
  readonly combo: Combo;
  /** Index into the custom list, or null for presets. */
  readonly customIndex: number | null;
}

/** Presets followed by valid custom combos (invalid stored entries are skipped). */
export function comboMenuEntries(custom: readonly string[]): ComboMenuEntry[] {
  const out: ComboMenuEntry[] = COMBO_PRESETS.map((p) => ({
    key: `preset:${p.id}`,
    label: p.label,
    combo: p.combo,
    customIndex: null,
  }));
  custom.forEach((text, i) => {
    const r = parseCombo(text);
    if (r.ok) {
      out.push({
        key: `custom:${i}:${text}`,
        label: formatCombo(r.combo),
        combo: r.combo,
        customIndex: i,
      });
    }
  });
  return out;
}
