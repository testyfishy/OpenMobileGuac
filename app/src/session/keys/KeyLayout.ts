/**
 * Key bar layout tokens and layout edits (KEY-7, KEY-9). Pure: no React, DOM or strings.
 *
 * A layout is a list of rows; each row is a list of string tokens:
 * - a canonical key name from `KEY_NAMES` (`Esc`, `F5`, `PageUp`, `RCtrl`, `AudioMute`…);
 * - `Ctrl`, `Alt`, `Shift`, `Super`, `AltGr`: sticky modifiers;
 * - `Fn`: shows / hides every row after the first;
 * - `combo:<text>`: an inline chord or sequence (`combo:Ctrl+Shift+T`, `parseCombo` syntax);
 * - `text:<string>`: types the literal text (`text:| grep `, `text:~/`);
 * - `saved:<id>`: runs a saved combo from the key library (see `ComboLibrary.ts`).
 */

import { KEY_NAMES, canonicalKeyName, formatCombo, parseCombo, type Modifier } from './KeyModel.ts';

export type KeyLayoutRows = readonly (readonly string[])[];

export const STICKY_TOKENS: readonly Modifier[] = ['Ctrl', 'Alt', 'Shift', 'Super', 'AltGr'];

export const MAX_ROWS = 6;
export const MAX_KEYS_PER_ROW = 40;
/** Longest literal text a key may type. */
export const MAX_TEXT_KEY = 200;

export const COMBO_PREFIX = 'combo:';
export const TEXT_PREFIX = 'text:';
export const SAVED_PREFIX = 'saved:';

const SAVED_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type KeyToken =
  | { readonly kind: 'key'; readonly name: string }
  | { readonly kind: 'modifier'; readonly mod: Modifier }
  | { readonly kind: 'fn' }
  | { readonly kind: 'combo'; readonly text: string }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'saved'; readonly id: string };

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
  if (token.startsWith(TEXT_PREFIX)) {
    const text = token.slice(TEXT_PREFIX.length);
    return text.length > 0 && [...text].length <= MAX_TEXT_KEY ? { kind: 'text', text } : null;
  }
  if (token.startsWith(SAVED_PREFIX)) {
    const id = token.slice(SAVED_PREFIX.length);
    return SAVED_ID.test(id) ? { kind: 'saved', id } : null;
  }
  const name = canonicalKeyName(token);
  return name !== null && name === token ? { kind: 'key', name } : null;
}

export function comboToken(text: string): string | null {
  const r = parseCombo(text);
  return r.ok ? `${COMBO_PREFIX}${formatCombo(r.combo)}` : null;
}

export function textToken(text: string): string | null {
  const t = `${TEXT_PREFIX}${text}`;
  return parseToken(t) ? t : null;
}

export function savedToken(id: string): string | null {
  const t = `${SAVED_PREFIX}${id}`;
  return parseToken(t) ? t : null;
}

/** Normalise stored rows: unknown tokens dropped, rows and row lengths capped. */
export function normalizeRows(raw: unknown): string[][] | null {
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

/** Rows to show: rows after the first only when Fn is on (if the first row has Fn). */
export function visibleRows(layout: KeyLayoutRows, fnOn: boolean): KeyLayoutRows {
  const [first, ...rest] = layout;
  if (!first) return [];
  if (!first.includes('Fn')) return layout;
  return fnOn ? [...rest, first] : [first];
}

export type KeyRowsEdit =
  | { readonly type: 'add'; readonly row: number; readonly token: string }
  | { readonly type: 'remove'; readonly row: number; readonly index: number }
  | { readonly type: 'move'; readonly row: number; readonly index: number; readonly delta: -1 | 1 }
  | { readonly type: 'move-row'; readonly row: number; readonly delta: -1 | 1 }
  | { readonly type: 'add-row' }
  | { readonly type: 'remove-row'; readonly row: number };

/** Apply an edit to a copy of `rows` (an empty layout gets one empty row first). */
export function editRows(rows: KeyLayoutRows, edit: KeyRowsEdit): string[][] {
  const out = rows.length > 0 ? rows.map((r) => [...r]) : [[]];
  const inRow = (r: number) => r >= 0 && r < out.length;
  switch (edit.type) {
    case 'add': {
      if (!inRow(edit.row) || parseToken(edit.token) === null) break;
      const row = out[edit.row];
      if (row && row.length < MAX_KEYS_PER_ROW) row.push(edit.token);
      break;
    }
    case 'remove': {
      out[edit.row]?.splice(edit.index, 1);
      break;
    }
    case 'move': {
      const row = out[edit.row];
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
      const a = out[edit.row];
      const b = out[j];
      if (!a || !b) break;
      out[edit.row] = b;
      out[j] = a;
      break;
    }
    case 'add-row':
      if (out.length < MAX_ROWS) out.push([]);
      break;
    case 'remove-row':
      if (inRow(edit.row) && out.length > 1) out.splice(edit.row, 1);
      break;
  }
  return out;
}

/** Named keys for pickers (all of `KEY_NAMES`). */
export function namedKeyTokens(): string[] {
  return [...KEY_NAMES];
}
