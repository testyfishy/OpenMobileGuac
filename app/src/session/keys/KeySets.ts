/**
 * Named key sets for the extra key bar, the user's key library (sets + saved combos +
 * per-protocol defaults) and its import/export format (KEY-9). Pure.
 *
 * Built-in sets are read-only templates (ids `builtin:*`); the user duplicates one to edit
 * it. User sets have ids `user-*`. The active set of a session is resolved by
 * `resolveActiveKeySet`: the connection's remembered choice, then a legacy per-connection
 * layout (`keyBarLayout`, from before key sets), then the protocol default, then the app
 * default, then General.
 */

import { MAX_SAVED_COMBOS, normalizeComboList, uniqueId, type SavedCombo } from './ComboLibrary.ts';
import {
  MAX_KEYS_PER_ROW,
  MAX_ROWS,
  SAVED_PREFIX,
  editRows,
  normalizeRows,
  parseToken,
  type KeyLayoutRows,
  type KeyRowsEdit,
} from './KeyLayout.ts';

export interface KeySet {
  readonly id: string;
  readonly name: string;
  readonly rows: KeyLayoutRows;
}

export interface KeyLibrary {
  /** The user's own sets, in the user's order. */
  readonly sets: readonly KeySet[];
  readonly combos: readonly SavedCombo[];
  /** Protocol (lower case) → set id used when a connection has not chosen one. */
  readonly protocolDefaults: Readonly<Record<string, string>>;
  /** Built-in sets left out of the in-session switcher. */
  readonly hiddenBuiltIns: readonly string[];
}

export const MAX_KEY_SETS = 40;
export const MAX_SET_NAME = 40;
export const GENERAL_SET_ID = 'builtin:general';
export const TERMINAL_SET_ID = 'builtin:terminal';
/** Pseudo set for a per-connection layout stored before key sets existed. */
export const LEGACY_SET_ID = 'legacy:layout';
export const TERMINAL_PROTOCOLS = ['ssh', 'telnet', 'kubernetes'] as const;

const F = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `F${from + i}`);

/** Built-in templates. Names are English fallbacks; the UI shows translated names. */
export const BUILTIN_KEY_SETS: readonly KeySet[] = [
  {
    id: GENERAL_SET_ID,
    name: 'General',
    rows: [
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
      F(1, 12),
    ],
  },
  {
    id: 'builtin:windows',
    name: 'Windows',
    rows: [
      [
        'Super',
        'Ctrl',
        'Alt',
        'Shift',
        'Esc',
        'Tab',
        'combo:Ctrl+Alt+Delete',
        'combo:Alt+Tab',
        'combo:Super+D',
        'combo:Super+E',
        'combo:Super+R',
        'combo:Super+L',
        'combo:Alt+F4',
        'combo:Ctrl+Shift+Esc',
        'PrintScreen',
        'Fn',
      ],
      ['Left', 'Up', 'Down', 'Right', 'Home', 'End', 'PageUp', 'PageDown', 'Delete', ...F(1, 12)],
    ],
  },
  {
    id: TERMINAL_SET_ID,
    name: 'Terminal / Linux',
    rows: [
      [
        'Esc',
        'Tab',
        'Ctrl',
        'Alt',
        'combo:Ctrl+C',
        'combo:Ctrl+D',
        'combo:Ctrl+Z',
        'combo:Ctrl+L',
        'combo:Ctrl+R',
        'text:|',
        'text:~',
        'text:/',
        'text:-',
        'Left',
        'Up',
        'Down',
        'Right',
        'Fn',
      ],
      [
        'combo:Ctrl+A',
        'combo:Ctrl+E',
        'combo:Ctrl+U',
        'combo:Ctrl+W',
        'combo:Ctrl+Shift+C',
        'combo:Ctrl+Shift+V',
        'text:\\',
        'text:&&',
        'text:>',
        'text:$',
        'text:*',
        'Home',
        'End',
        'PageUp',
        'PageDown',
        ...F(1, 10),
      ],
    ],
  },
  {
    id: 'builtin:mac',
    name: 'macOS remote',
    rows: [
      [
        'Super',
        'Alt',
        'Ctrl',
        'Shift',
        'Esc',
        'Tab',
        'combo:Super+Space',
        'combo:Super+Tab',
        'combo:Super+Q',
        'combo:Super+W',
        'combo:Super+C',
        'combo:Super+V',
        'combo:Super+Z',
        'Left',
        'Up',
        'Down',
        'Right',
        'Fn',
      ],
      ['Home', 'End', 'PageUp', 'PageDown', 'Delete', ...F(1, 12)],
    ],
  },
  {
    id: 'builtin:editing',
    name: 'Editing / navigation',
    rows: [
      [
        'Ctrl',
        'Shift',
        'Alt',
        'Left',
        'Up',
        'Down',
        'Right',
        'Home',
        'End',
        'PageUp',
        'PageDown',
        'Backspace',
        'Delete',
        'Insert',
        'Enter',
        'combo:Ctrl+Z',
        'combo:Ctrl+Y',
        'combo:Ctrl+A',
        'combo:Ctrl+X',
        'combo:Ctrl+C',
        'combo:Ctrl+V',
        'combo:Ctrl+F',
        'combo:Ctrl+S',
      ],
    ],
  },
  {
    id: 'builtin:function',
    name: 'Function keys',
    rows: [
      ['Esc', 'Ctrl', 'Alt', 'Shift', ...F(1, 12), 'Fn'],
      [...F(13, 24), 'PrintScreen', 'ScrollLock', 'Pause', 'Insert', 'NumLock', 'CapsLock'],
    ],
  },
];

export const BUILTIN_SET_IDS: readonly string[] = BUILTIN_KEY_SETS.map((s) => s.id);

export function isBuiltInSet(id: string): boolean {
  return BUILTIN_SET_IDS.includes(id);
}

export const EMPTY_KEY_LIBRARY: KeyLibrary = {
  sets: [],
  combos: [],
  protocolDefaults: {},
  hiddenBuiltIns: [],
};

/** New installs: terminal protocols start on the Terminal set. */
export const DEFAULT_KEY_LIBRARY: KeyLibrary = {
  ...EMPTY_KEY_LIBRARY,
  protocolDefaults: Object.fromEntries(TERMINAL_PROTOCOLS.map((p) => [p, TERMINAL_SET_ID])),
};

const SET_ID = /^(builtin:[a-z]+|user-[A-Za-z0-9_-]{1,60})$/;
const PROTOCOL = /^[a-z][a-z0-9-]{0,31}$/;

export function isKeySetId(v: unknown): v is string {
  return typeof v === 'string' && (SET_ID.test(v) || v === LEGACY_SET_ID);
}

function cleanName(v: unknown, fallback: string): string {
  const s = typeof v === 'string' ? v.trim().slice(0, MAX_SET_NAME) : '';
  return s || fallback;
}

/** Normalise a stored library. Unknown fields and bad entries are dropped. */
export function normalizeKeyLibrary(raw: unknown): KeyLibrary {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return DEFAULT_KEY_LIBRARY;
  const r = raw as Record<string, unknown>;
  const sets: KeySet[] = [];
  const ids = new Set<string>();
  if (Array.isArray(r['sets'])) {
    for (const s of r['sets'] as unknown[]) {
      if (sets.length >= MAX_KEY_SETS) break;
      if (typeof s !== 'object' || s === null) continue;
      const o = s as Record<string, unknown>;
      const id = o['id'];
      if (typeof id !== 'string' || !id.startsWith('user-') || !SET_ID.test(id) || ids.has(id)) {
        continue;
      }
      ids.add(id);
      sets.push({
        id,
        name: cleanName(o['name'], 'Key set'),
        rows: normalizeRows(o['rows']) ?? [[]],
      });
    }
  }
  const protocolDefaults: Record<string, string> = {};
  const pd = r['protocolDefaults'];
  if (typeof pd === 'object' && pd !== null && !Array.isArray(pd)) {
    for (const [p, id] of Object.entries(pd as Record<string, unknown>)) {
      if (PROTOCOL.test(p) && isKeySetId(id) && id !== LEGACY_SET_ID) protocolDefaults[p] = id;
    }
  }
  const hidden = Array.isArray(r['hiddenBuiltIns'])
    ? (r['hiddenBuiltIns'] as unknown[]).filter(
        (x, i, a): x is string => typeof x === 'string' && isBuiltInSet(x) && a.indexOf(x) === i,
      )
    : [];
  return {
    sets,
    combos: normalizeComboList(r['combos']),
    protocolDefaults,
    hiddenBuiltIns: hidden,
  };
}

/** A built-in or user set by id (legacy and unknown ids: undefined). */
export function findSet(lib: KeyLibrary, id: string): KeySet | undefined {
  return BUILTIN_KEY_SETS.find((s) => s.id === id) ?? lib.sets.find((s) => s.id === id);
}

/** Sets offered by the in-session switcher: the user's, then the visible built-ins. */
export function switchableSets(lib: KeyLibrary, extra?: KeySet): KeySet[] {
  const out: KeySet[] = [];
  if (extra) out.push(extra);
  out.push(...lib.sets);
  for (const s of BUILTIN_KEY_SETS) if (!lib.hiddenBuiltIns.includes(s.id)) out.push(s);
  return out.length > 0 ? out : [BUILTIN_KEY_SETS[0] as KeySet];
}

/** The set `delta` steps from `currentId` in the switcher order (wrapping). */
export function stepSet(sets: readonly KeySet[], currentId: string, delta: number): KeySet {
  const i = sets.findIndex((s) => s.id === currentId);
  const n = sets.length;
  const j = i < 0 ? 0 : (((i + delta) % n) + n) % n;
  return sets[j] ?? (BUILTIN_KEY_SETS[0] as KeySet);
}

export type ActiveSetSource = 'connection' | 'legacy' | 'protocol' | 'app' | 'fallback';

export interface ActiveSetInput {
  readonly library: KeyLibrary;
  /** The connection's own choice (only when the connection stores one). */
  readonly connectionSet?: string | undefined;
  /** A pre-key-sets layout from the connection or server layer (`keyBarLayout`). */
  readonly legacyLayout?: KeyLayoutRows | null | undefined;
  readonly protocol?: string | undefined;
  /** The app (or server) default `keySet`. */
  readonly defaultSet?: string | undefined;
  /** Translated name for the legacy pseudo set. */
  readonly legacyName?: string;
}

export function legacySet(rows: KeyLayoutRows, name = 'Custom layout'): KeySet {
  return { id: LEGACY_SET_ID, name, rows };
}

export function resolveActiveKeySet(input: ActiveSetInput): {
  set: KeySet;
  source: ActiveSetSource;
} {
  const lib = input.library;
  const legacy =
    input.legacyLayout && input.legacyLayout.length > 0
      ? legacySet(input.legacyLayout, input.legacyName)
      : undefined;
  if (input.connectionSet) {
    if (input.connectionSet === LEGACY_SET_ID && legacy) return { set: legacy, source: 'legacy' };
    const s = findSet(lib, input.connectionSet);
    if (s) return { set: s, source: 'connection' };
  }
  if (legacy) return { set: legacy, source: 'legacy' };
  const proto = (input.protocol ?? '').toLowerCase();
  const pd = proto ? lib.protocolDefaults[proto] : undefined;
  const ps = pd ? findSet(lib, pd) : undefined;
  if (ps) return { set: ps, source: 'protocol' };
  const ds = input.defaultSet ? findSet(lib, input.defaultSet) : undefined;
  if (ds) return { set: ds, source: 'app' };
  return { set: BUILTIN_KEY_SETS[0] as KeySet, source: 'fallback' };
}

// ---- Library edits ---------------------------------------------------------------------

export type KeyLibraryAction =
  /** New user set: a copy of `from` (any set, including the legacy one) or blank. */
  | { readonly type: 'create'; readonly name: string; readonly from?: KeySet }
  | { readonly type: 'rename'; readonly id: string; readonly name: string }
  | { readonly type: 'delete'; readonly id: string }
  | { readonly type: 'move'; readonly id: string; readonly delta: -1 | 1 }
  | { readonly type: 'edit-rows'; readonly id: string; readonly edit: KeyRowsEdit }
  | { readonly type: 'set-rows'; readonly id: string; readonly rows: KeyLayoutRows }
  | { readonly type: 'protocol-default'; readonly protocol: string; readonly id: string | null }
  | { readonly type: 'hide-builtin'; readonly id: string; readonly hidden: boolean }
  | { readonly type: 'save-combo'; readonly combo: SavedCombo }
  | { readonly type: 'delete-combo'; readonly id: string }
  | { readonly type: 'move-combo'; readonly id: string; readonly delta: -1 | 1 };

export interface KeyLibraryResult {
  readonly library: KeyLibrary;
  /** Id of a set created by `create`. */
  readonly createdId?: string;
  /** Refused (limit reached, read-only set). */
  readonly refused?: 'limit' | 'read-only';
}

function moveBy<T>(list: readonly T[], index: number, delta: number): T[] {
  const out = [...list];
  const j = index + delta;
  if (index < 0 || index >= out.length || j < 0 || j >= out.length) return out;
  const [x] = out.splice(index, 1);
  if (x !== undefined) out.splice(j, 0, x);
  return out;
}

function slug(name: string): string {
  const s = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return s || 'set';
}

export function newSetId(name: string, lib: KeyLibrary): string {
  return uniqueId(`user-${slug(name)}`, new Set(lib.sets.map((s) => s.id)), true);
}

export function reduceKeyLibrary(lib: KeyLibrary, a: KeyLibraryAction): KeyLibraryResult {
  const userIndex = (id: string) => lib.sets.findIndex((s) => s.id === id);
  const editUser = (id: string, f: (s: KeySet) => KeySet): KeyLibraryResult => {
    const i = userIndex(id);
    if (i < 0) return { library: lib, refused: 'read-only' };
    return { library: { ...lib, sets: lib.sets.map((s, j) => (j === i ? f(s) : s)) } };
  };
  switch (a.type) {
    case 'create': {
      if (lib.sets.length >= MAX_KEY_SETS) return { library: lib, refused: 'limit' };
      const name = cleanName(a.name, a.from?.name ?? 'Key set');
      const id = newSetId(name, lib);
      const rows = a.from ? a.from.rows.map((r) => [...r]) : [[]];
      return { library: { ...lib, sets: [...lib.sets, { id, name, rows }] }, createdId: id };
    }
    case 'rename':
      return editUser(a.id, (s) => ({ ...s, name: cleanName(a.name, s.name) }));
    case 'delete': {
      if (userIndex(a.id) < 0) return { library: lib, refused: 'read-only' };
      const protocolDefaults = Object.fromEntries(
        Object.entries(lib.protocolDefaults).filter(([, id]) => id !== a.id),
      );
      return { library: { ...lib, sets: lib.sets.filter((s) => s.id !== a.id), protocolDefaults } };
    }
    case 'move':
      return { library: { ...lib, sets: moveBy(lib.sets, userIndex(a.id), a.delta) } };
    case 'edit-rows':
      return editUser(a.id, (s) => ({ ...s, rows: editRows(s.rows, a.edit) }));
    case 'set-rows':
      return editUser(a.id, (s) => ({ ...s, rows: normalizeRows(a.rows) ?? [[]] }));
    case 'protocol-default': {
      const p = a.protocol.toLowerCase();
      if (!PROTOCOL.test(p)) return { library: lib };
      const rest = Object.fromEntries(
        Object.entries(lib.protocolDefaults).filter(([k]) => k !== p),
      );
      const next = a.id === null || !findSet(lib, a.id) ? rest : { ...rest, [p]: a.id };
      return { library: { ...lib, protocolDefaults: next } };
    }
    case 'hide-builtin': {
      if (!isBuiltInSet(a.id)) return { library: lib };
      const rest = lib.hiddenBuiltIns.filter((x) => x !== a.id);
      return { library: { ...lib, hiddenBuiltIns: a.hidden ? [...rest, a.id] : rest } };
    }
    case 'save-combo': {
      const i = lib.combos.findIndex((c) => c.id === a.combo.id);
      if (i >= 0) {
        return { library: { ...lib, combos: lib.combos.map((c, j) => (j === i ? a.combo : c)) } };
      }
      if (lib.combos.length >= MAX_SAVED_COMBOS) return { library: lib, refused: 'limit' };
      return { library: { ...lib, combos: [...lib.combos, a.combo] } };
    }
    case 'delete-combo':
      return { library: { ...lib, combos: lib.combos.filter((c) => c.id !== a.id) } };
    case 'move-combo': {
      const i = lib.combos.findIndex((c) => c.id === a.id);
      return { library: { ...lib, combos: moveBy(lib.combos, i, a.delta) } };
    }
  }
}

export function newComboId(lib: KeyLibrary): string {
  return uniqueId('c', new Set(lib.combos.map((c) => c.id)));
}

/**
 * The library from settings saved before key sets existed: an app-wide custom key bar
 * becomes the user set "My key bar" (and the app default), app-wide custom combos become
 * saved combos. Terminal protocols keep using the migrated layout (no protocol default).
 */
export function migrateLegacyLibrary(
  legacyLayout: unknown,
  legacyCombos: unknown,
): { library: KeyLibrary; defaultSet?: string } {
  const rows = normalizeRows(legacyLayout);
  const combos = normalizeComboList(Array.isArray(legacyCombos) ? legacyCombos : []);
  if (!rows) return { library: { ...DEFAULT_KEY_LIBRARY, combos } };
  const set: KeySet = { id: 'user-my-key-bar', name: 'My key bar', rows };
  return { library: { ...EMPTY_KEY_LIBRARY, sets: [set], combos }, defaultSet: set.id };
}

// ---- Import / export -------------------------------------------------------------------

export const KEYS_FORMAT = 'openmobileguac-keys';
export const KEYS_VERSION = 1;

export interface KeysFile {
  readonly format: typeof KEYS_FORMAT;
  readonly version: number;
  readonly sets: readonly { name: string; rows: KeyLayoutRows }[];
  readonly combos: readonly SavedCombo[];
}

/** Export file for some or all user sets and combos (combos used by the sets included). */
export function exportKeys(
  lib: KeyLibrary,
  pick: { sets?: readonly string[]; combos?: readonly string[] } = {},
): KeysFile {
  const sets = lib.sets.filter((s) => !pick.sets || pick.sets.includes(s.id));
  const used = new Set<string>();
  for (const s of sets) {
    for (const row of s.rows) {
      for (const t of row) if (t.startsWith(SAVED_PREFIX)) used.add(t.slice(SAVED_PREFIX.length));
    }
  }
  const combos = lib.combos.filter(
    (c) => (pick.combos ? pick.combos.includes(c.id) : true) || used.has(c.id),
  );
  return {
    format: KEYS_FORMAT,
    version: KEYS_VERSION,
    sets: sets.map((s) => ({ name: s.name, rows: s.rows })),
    combos,
  };
}

export type KeysParseResult =
  | { readonly ok: true; readonly sets: KeySet[]; readonly combos: SavedCombo[] }
  | { readonly ok: false; readonly error: 'json' | 'format' | 'version' | 'empty' };

export function parseKeysFile(text: string): KeysParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, error: 'json' };
  }
  if (
    typeof raw !== 'object' ||
    raw === null ||
    (raw as { format?: unknown }).format !== KEYS_FORMAT
  ) {
    return { ok: false, error: 'format' };
  }
  const r = raw as Record<string, unknown>;
  const v = r['version'];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > KEYS_VERSION) {
    return { ok: false, error: 'version' };
  }
  const sets: KeySet[] = [];
  if (Array.isArray(r['sets'])) {
    (r['sets'] as unknown[]).slice(0, MAX_KEY_SETS).forEach((s, i) => {
      if (typeof s !== 'object' || s === null) return;
      const o = s as Record<string, unknown>;
      const rows = normalizeRows(o['rows']);
      if (rows) sets.push({ id: `import-${i}`, name: cleanName(o['name'], 'Key set'), rows });
    });
  }
  const combos = normalizeComboList(r['combos']);
  if (sets.length === 0 && combos.length === 0) return { ok: false, error: 'empty' };
  return { ok: true, sets, combos };
}

/**
 * Add imported sets and combos to the library. Everything gets fresh ids (nothing is
 * overwritten); `saved:` keys in imported sets follow their combos' new ids. Same-named
 * sets get a numbered name. Stops at the limits.
 */
export function mergeImportedKeys(
  lib: KeyLibrary,
  imported: { sets: readonly KeySet[]; combos: readonly SavedCombo[] },
): { library: KeyLibrary; addedSets: number; addedCombos: number } {
  let next = lib;
  const idMap = new Map<string, string>();
  let addedCombos = 0;
  for (const c of imported.combos) {
    if (next.combos.length >= MAX_SAVED_COMBOS) break;
    const id = newComboId(next);
    idMap.set(c.id, id);
    next = { ...next, combos: [...next.combos, { ...c, id }] };
    addedCombos++;
  }
  let addedSets = 0;
  for (const s of imported.sets) {
    if (next.sets.length >= MAX_KEY_SETS) break;
    const rows = s.rows
      .map((row) =>
        row
          .map((t) => {
            if (!t.startsWith(SAVED_PREFIX)) return t;
            const id = idMap.get(t.slice(SAVED_PREFIX.length));
            return id ? `${SAVED_PREFIX}${id}` : null;
          })
          .filter((t): t is string => t !== null && parseToken(t) !== null)
          .slice(0, MAX_KEYS_PER_ROW),
      )
      .slice(0, MAX_ROWS);
    const names = new Set(next.sets.map((x) => x.name));
    let name = s.name;
    const base = s.name.slice(0, MAX_SET_NAME - 6);
    for (let n = 2; names.has(name) && n < 1000; n++) name = `${base} (${n})`;
    const r = reduceKeyLibrary(next, { type: 'create', name, from: { ...s, rows } });
    next = r.library;
    addedSets++;
  }
  return { library: next, addedSets, addedCombos };
}

/** Saved-combo ids used by a set's keys. */
export function combosUsedBy(set: KeySet): string[] {
  const out: string[] = [];
  for (const row of set.rows) {
    for (const t of row) {
      const p = parseToken(t);
      if (p?.kind === 'saved' && !out.includes(p.id)) out.push(p.id);
    }
  }
  return out;
}
