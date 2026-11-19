/**
 * User-editable key bar layout (KEY-7). Pure: no React or DOM.
 *
 * A layout is a list of rows; each row is a list of tokens:
 * - a canonical key name from `KEY_NAMES` (`Esc`, `F5`, `PageUp`, `RCtrl`, …): a plain key;
 * - `Ctrl`, `Alt`, `Shift`, `Super`, `AltGr`: sticky modifiers (tap = next key, tap again =
 *   locked, again = off);
 * - `Fn`: shows / hides every row after the first (rows after the first are always shown
 *   when the first row has no `Fn`);
 * - `combo:<text>`: runs a combo (`combo:Ctrl+Shift+T`, parsed by `parseCombo`).
 * `null` means the built-in layout. Stored layouts are normalised: unknown tokens are
 * dropped, rows and row lengths are capped.
 */

import {
  COMBO_PRESETS,
  KEY_NAMES,
  canonicalKeyName,
  formatCombo,
  parseCombo,
  type Modifier,
} from '../../session/keys/KeyModel.ts';
import { sessionStrings } from './sessionStrings.ts';

export type KeyBarLayout = readonly (readonly string[])[];

export const STICKY_TOKENS: readonly Modifier[] = ['Ctrl', 'Alt', 'Shift', 'Super', 'AltGr'];

export const DEFAULT_KEY_BAR_LAYOUT: KeyBarLayout = [
  [
    'Esc',
    'Tab',
    'Ctrl',
    'Alt',
    'Shift',
    'Super',
    'Left',
    'Up',
    'Down',
    'Right',
    'Home',
    'End',
    'PageUp',
    'PageDown',
    'Delete',
    'Fn',
  ],
  Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
];

export const MAX_ROWS = 6;
export const MAX_KEYS_PER_ROW = 40;

const COMBO_PREFIX = 'combo:';

export type KeyToken =
  | { readonly kind: 'key'; readonly name: string }
  | { readonly kind: 'modifier'; readonly mod: Modifier }
  | { readonly kind: 'fn' }
  | { readonly kind: 'combo'; readonly text: string };

/** Parse a token, or null if it is not valid. */
export function parseToken(token: string): KeyToken | null {
  if (typeof token !== 'string') return null;
  if (token === 'Fn') return { kind: 'fn' };
  if ((STICKY_TOKENS as readonly string[]).includes(token)) {
    return { kind: 'modifier', mod: token as Modifier };
  }
  if (token.startsWith(COMBO_PREFIX)) {
    const r = parseCombo(token.slice(COMBO_PREFIX.length));
    return r.ok ? { kind: 'combo', text: formatCombo(r.combo) } : null;
  }
  const name = canonicalKeyName(token);
  return name !== null && name === token ? { kind: 'key', name } : null;
}

export function comboToken(text: string): string | null {
  const r = parseCombo(text);
  return r.ok ? `${COMBO_PREFIX}${formatCombo(r.combo)}` : null;
}

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

/** Short visible label for a token. */
export function tokenLabel(token: string): string {
  const t = parseToken(token);
  if (!t) return token;
  if (t.kind === 'combo') return t.text;
  if (t.kind === 'fn') return 'Fn';
  const name = t.kind === 'modifier' ? t.mod : t.name;
  return LABELS[name] ?? name;
}

/**
 * Accessible name for a token (active session table: words for symbol caps such as arrows,
 * otherwise the key name).
 */
export function tokenSpokenLabel(token: string): string {
  const t = parseToken(token);
  if (!t) return token;
  const s = sessionStrings.keyBar;
  if (t.kind === 'combo') return s.combo(t.text);
  if (t.kind === 'fn') return s.spoken['Fn'] ?? 'Fn';
  const name = t.kind === 'modifier' ? t.mod : t.name;
  return s.spoken[name] ?? name;
}

/** Normalise a stored layout. Returns null for "use the built-in layout". */
export function normalizeKeyBarLayout(raw: unknown): string[][] | null {
  if (!Array.isArray(raw)) return null;
  const rows: string[][] = [];
  for (const row of raw.slice(0, MAX_ROWS)) {
    if (!Array.isArray(row)) continue;
    const tokens = row
      .filter((t): t is string => typeof t === 'string' && parseToken(t) !== null)
      .slice(0, MAX_KEYS_PER_ROW);
    rows.push(tokens);
  }
  if (rows.length === 0 || rows.every((r) => r.length === 0)) return null;
  return rows;
}

/** The layout to render. */
export function resolveKeyBarLayout(layout: KeyBarLayout | null | undefined): KeyBarLayout {
  return layout && layout.length > 0 ? layout : DEFAULT_KEY_BAR_LAYOUT;
}

/** Rows to show: rows after the first only when Fn is on (if the first row has Fn). */
export function visibleRows(layout: KeyBarLayout, fnOn: boolean): KeyBarLayout {
  const [first, ...rest] = layout;
  if (!first) return [];
  if (!first.includes('Fn')) return layout;
  return fnOn ? [...rest, first] : [first];
}

export type KeyBarEdit =
  | { readonly type: 'add'; readonly row: number; readonly token: string }
  | { readonly type: 'remove'; readonly row: number; readonly index: number }
  | { readonly type: 'move'; readonly row: number; readonly index: number; readonly delta: -1 | 1 }
  | { readonly type: 'move-row'; readonly row: number; readonly delta: -1 | 1 }
  | { readonly type: 'add-row' }
  | { readonly type: 'remove-row'; readonly row: number }
  | { readonly type: 'reset' };

/** Apply an edit. Returns the new layout (null = built-in after a reset). */
export function editKeyBarLayout(
  layout: KeyBarLayout | null | undefined,
  edit: KeyBarEdit,
): string[][] | null {
  if (edit.type === 'reset') return null;
  const rows = resolveKeyBarLayout(layout).map((r) => [...r]);
  const inRow = (r: number) => r >= 0 && r < rows.length;
  switch (edit.type) {
    case 'add': {
      if (!inRow(edit.row) || parseToken(edit.token) === null) break;
      const row = rows[edit.row];
      if (row && row.length < MAX_KEYS_PER_ROW) row.push(edit.token);
      break;
    }
    case 'remove': {
      rows[edit.row]?.splice(edit.index, 1);
      break;
    }
    case 'move': {
      const row = rows[edit.row];
      const j = edit.index + edit.delta;
      if (!row || edit.index < 0 || edit.index >= row.length || j < 0 || j >= row.length) break;
      const a = row[edit.index];
      const b = row[j];
      if (a === undefined || b === undefined) break;
      row[edit.index] = b;
      row[j] = a;
      break;
    }
    case 'move-row': {
      const j = edit.row + edit.delta;
      if (!inRow(edit.row) || !inRow(j)) break;
      const a = rows[edit.row];
      const b = rows[j];
      if (!a || !b) break;
      rows[edit.row] = b;
      rows[j] = a;
      break;
    }
    case 'add-row':
      if (rows.length < MAX_ROWS) rows.push([]);
      break;
    case 'remove-row':
      if (inRow(edit.row) && rows.length > 1) rows.splice(edit.row, 1);
      break;
  }
  return rows;
}

/** Everything the user can add: sticky modifiers, named keys, Fn, preset and saved combos. */
export function availableTokens(customCombos: readonly string[]): string[] {
  const out: string[] = [...STICKY_TOKENS, 'Fn'];
  for (const name of KEY_NAMES) if (!out.includes(name)) out.push(name);
  for (const p of COMBO_PRESETS) {
    const t = `${COMBO_PREFIX}${formatCombo(p.combo)}`;
    if (!out.includes(t)) out.push(t);
  }
  for (const c of customCombos) {
    const t = comboToken(c);
    if (t !== null && !out.includes(t)) out.push(t);
  }
  return out;
}
