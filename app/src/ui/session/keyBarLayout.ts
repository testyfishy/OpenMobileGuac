/**
 * Key bar layout helpers for the UI (KEY-7, KEY-9): labels and the token picker. The token
 * grammar and the pure edits live in `session/keys/KeyLayout.ts`; key sets in
 * `session/keys/KeySets.ts`.
 *
 * `null` (the legacy `keyBarLayout` setting) means "no per-connection layout".
 */

import type { SavedCombo } from '../../session/keys/ComboLibrary.ts';
import {
  COMBO_PREFIX,
  STICKY_TOKENS,
  editRows,
  normalizeRows,
  parseToken,
  savedToken,
  type KeyLayoutRows,
  type KeyRowsEdit,
} from '../../session/keys/KeyLayout.ts';
import { COMBO_PRESETS, KEY_NAMES, formatCombo } from '../../session/keys/KeyModel.ts';
import { BUILTIN_KEY_SETS } from '../../session/keys/KeySets.ts';
import { sessionStrings } from './sessionStrings.ts';

export {
  MAX_ROWS,
  MAX_KEYS_PER_ROW,
  STICKY_TOKENS,
  comboToken,
  parseToken,
  textToken,
  visibleRows,
  type KeyToken,
} from '../../session/keys/KeyLayout.ts';

export type KeyBarLayout = KeyLayoutRows;
export type KeyBarEdit = KeyRowsEdit | { readonly type: 'reset' };

/** The General set's rows (what the key bar showed before key sets). */
export const DEFAULT_KEY_BAR_LAYOUT: KeyBarLayout = BUILTIN_KEY_SETS[0]?.rows ?? [];

const LABELS: Readonly<Record<string, string>> = {
  Super: 'Win',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  Delete: 'Del',
  Insert: 'Ins',
  Backspace: '⌫',
  Enter: '⏎',
  Left: '←',
  Up: '↑',
  Down: '↓',
  Right: '→',
  PrintScreen: 'PrtSc',
  ScrollLock: 'ScrLk',
  CapsLock: 'Caps',
  NumLock: 'Num',
  Space: 'Space',
  Plus: '+',
  Comma: ',',
};

/** Label of a combo key name (`Super` → `Win`, `Comma` → `,`). */
export function keyCapLabel(name: string): string {
  return LABELS[name] ?? name;
}

/** Key caps in a canonical combo text: `Super+D` → `Win+D`. */
export function comboTextLabel(text: string): string {
  return text
    .split(', ')
    .map((step) => step.split('+').map(keyCapLabel).join('+'))
    .join(', ');
}

function shortText(text: string): string {
  const chars = [...text.replace(/\n/g, '⏎')];
  return chars.length > 12 ? `${chars.slice(0, 11).join('')}…` : chars.join('');
}

/** Short visible label for a token. `combos` resolves saved-combo keys. */
export function tokenLabel(token: string, combos: readonly SavedCombo[] = []): string {
  const t = parseToken(token);
  if (!t) return token;
  if (t.kind === 'combo') return comboTextLabel(t.text);
  if (t.kind === 'fn') return 'Fn';
  if (t.kind === 'text') return shortText(t.text);
  if (t.kind === 'saved') return combos.find((c) => c.id === t.id)?.name ?? '?';
  const name = t.kind === 'modifier' ? t.mod : t.name;
  return keyCapLabel(name);
}

/** Accessible name for a token (words for symbol caps such as arrows). */
export function tokenSpokenLabel(token: string, combos: readonly SavedCombo[] = []): string {
  const t = parseToken(token);
  if (!t) return token;
  const s = sessionStrings.keyBar;
  if (t.kind === 'combo') return s.combo(t.text);
  if (t.kind === 'fn') return s.spoken['Fn'] ?? 'Fn';
  if (t.kind === 'text') return s.typeText(t.text);
  if (t.kind === 'saved') {
    const c = combos.find((x) => x.id === t.id);
    return c ? s.combo(c.name) : s.missingCombo;
  }
  const name = t.kind === 'modifier' ? t.mod : t.name;
  return s.spoken[name] ?? name;
}

/** Normalise a stored legacy layout. Returns null for "none". */
export function normalizeKeyBarLayout(raw: unknown): string[][] | null {
  return normalizeRows(raw);
}

/** The layout to render (legacy helper: null → General). */
export function resolveKeyBarLayout(layout: KeyBarLayout | null | undefined): KeyBarLayout {
  return layout && layout.length > 0 ? layout : DEFAULT_KEY_BAR_LAYOUT;
}

/** Apply an edit (legacy helper). `reset` → null. */
export function editKeyBarLayout(
  layout: KeyBarLayout | null | undefined,
  edit: KeyBarEdit,
): string[][] | null {
  if (edit.type === 'reset') return null;
  return editRows(resolveKeyBarLayout(layout), edit);
}

/**
 * Everything the user can add from the picker: sticky modifiers, Fn, named keys, preset
 * combos, saved combos (as `saved:` keys) and legacy text combos.
 */
export function availableTokens(
  legacyCombos: readonly string[] = [],
  saved: readonly SavedCombo[] = [],
): string[] {
  const out: string[] = [...STICKY_TOKENS, 'Fn'];
  for (const name of KEY_NAMES) if (!out.includes(name)) out.push(name);
  for (const p of COMBO_PRESETS) {
    const t = `${COMBO_PREFIX}${formatCombo(p.combo)}`;
    if (!out.includes(t)) out.push(t);
  }
  for (const c of saved) {
    const t = savedToken(c.id);
    if (t !== null && !out.includes(t)) out.push(t);
  }
  for (const c of legacyCombos) {
    const p = parseToken(`${COMBO_PREFIX}${c}`);
    const t = p?.kind === 'combo' ? `${COMBO_PREFIX}${p.text}` : null;
    if (t !== null && !out.includes(t)) out.push(t);
  }
  return out;
}
