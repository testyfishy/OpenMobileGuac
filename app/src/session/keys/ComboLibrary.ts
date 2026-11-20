/**
 * Saved key combos (KEY-4, KEY-9): an ordered list of STEPS, each step one chord (keys
 * pressed in order, released in reverse), with an optional pause after it. Pure.
 *
 * Both editors edit this model: the typed form (`Ctrl+K, Ctrl+C`, `parseCombo` syntax) maps
 * to the steps one to one (pauses are kept by step index when the text is edited), and the
 * tap-to-build editor edits the steps directly through `reduceComboDraft`.
 *
 * Old stored combos are plain strings (`settings.customCombos`); `normalizeSavedCombo`
 * accepts both forms, so they keep loading and running.
 */

import {
  MODIFIERS,
  comboEvents,
  formatCombo,
  keysymForComboToken,
  parseCombo,
  type Chord,
  type Combo,
  type KeyEvent,
  type Modifier,
} from './KeyModel.ts';

export interface ComboStep {
  /** Canonical combo tokens (`Ctrl`, `Alt`, `K`, `F5`, `Plus`…). */
  readonly keys: readonly string[];
  /** Pause after this step before the next one (ms). */
  readonly delayMs?: number;
}

export interface SavedCombo {
  readonly id: string;
  readonly name: string;
  readonly steps: readonly ComboStep[];
}

export const MAX_SAVED_COMBOS = 60;
export const MAX_COMBO_STEPS = 32;
export const MAX_CHORD_KEYS = 6;
export const MAX_STEP_DELAY_MS = 5000;
export const MAX_COMBO_NAME = 40;
/** Delay choices offered by the editors (ms). */
export const STEP_DELAY_CHOICES = [0, 50, 100, 250, 500, 1000, 2000] as const;

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function isComboId(v: unknown): v is string {
  return typeof v === 'string' && ID.test(v);
}

/** Canonical form of one token, or null (same rules as `parseCombo`). */
export function canonicalComboKey(token: string): string | null {
  const r = parseCombo(token === '+' ? 'Plus' : token === ',' ? 'Comma' : token);
  if (!r.ok || r.combo.steps.length !== 1) return null;
  const chord = r.combo.steps[0];
  return chord && chord.length === 1 ? (chord[0] ?? null) : null;
}

function clampDelay(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return undefined;
  return Math.min(MAX_STEP_DELAY_MS, Math.round(v));
}

function normalizeStep(raw: unknown): ComboStep | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r['keys'])) return null;
  const keys: string[] = [];
  for (const k of r['keys'] as unknown[]) {
    if (typeof k !== 'string') continue;
    const c = canonicalComboKey(k);
    if (c !== null && !keys.includes(c) && keys.length < MAX_CHORD_KEYS) keys.push(c);
  }
  if (keys.length === 0) return null;
  const delayMs = clampDelay(r['delayMs']);
  return delayMs === undefined ? { keys } : { keys, delayMs };
}

/** Steps from the typed form, or an error message (English, from `parseCombo`). */
export function stepsFromText(
  text: string,
  keepDelaysFrom: readonly ComboStep[] = [],
): { ok: true; steps: ComboStep[] } | { ok: false; error: string } {
  const r = parseCombo(text);
  if (!r.ok) return { ok: false, error: r.error };
  if (r.combo.steps.length > MAX_COMBO_STEPS) {
    return { ok: false, error: `At most ${MAX_COMBO_STEPS} steps` };
  }
  return {
    ok: true,
    steps: r.combo.steps.map((chord, i) => {
      const delayMs = keepDelaysFrom[i]?.delayMs;
      const keys = chord.slice(0, MAX_CHORD_KEYS);
      return delayMs ? { keys, delayMs } : { keys };
    }),
  };
}

/** The typed form of the steps (pauses are not part of the text). */
export function stepsToText(steps: readonly ComboStep[]): string {
  return formatCombo(toCombo(steps));
}

export function toCombo(steps: readonly ComboStep[]): Combo {
  return { steps: steps.map((s) => s.keys as Chord) };
}

/**
 * A stored entry: an object `{ id, name, steps }`, or a legacy string (`"Ctrl+Alt+Del"`)
 * which becomes a combo named after its text. `fallbackId` names legacy entries.
 */
export function normalizeSavedCombo(raw: unknown, fallbackId: string): SavedCombo | null {
  if (typeof raw === 'string') {
    const s = stepsFromText(raw);
    if (!s.ok || s.steps.length === 0) return null;
    return { id: fallbackId, name: stepsToText(s.steps).slice(0, MAX_COMBO_NAME), steps: s.steps };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = isComboId(r['id']) ? r['id'] : fallbackId;
  const steps = Array.isArray(r['steps'])
    ? (r['steps'] as unknown[])
        .map(normalizeStep)
        .filter((s): s is ComboStep => s !== null)
        .slice(0, MAX_COMBO_STEPS)
    : [];
  if (steps.length === 0) return null;
  const nameRaw = typeof r['name'] === 'string' ? r['name'].trim() : '';
  const name = (nameRaw || stepsToText(steps)).slice(0, MAX_COMBO_NAME);
  return { id, name, steps };
}

/** Normalise a stored list (objects or legacy strings), dropping bad and duplicate ids. */
export function normalizeComboList(raw: unknown): SavedCombo[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedCombo[] = [];
  const ids = new Set<string>();
  (raw as unknown[]).forEach((entry, i) => {
    if (out.length >= MAX_SAVED_COMBOS) return;
    let c = normalizeSavedCombo(entry, `legacy-${i}`);
    if (!c) return;
    if (ids.has(c.id)) c = { ...c, id: uniqueId(`${c.id}-`, ids) };
    ids.add(c.id);
    out.push(c);
  });
  return out;
}

/**
 * Old `customCombos` strings → saved combos, skipping ones already in `existing` (same
 * steps). Deterministic ids (`legacy-N`) so a repeated migration does not duplicate.
 */
export function migrateLegacyCombos(
  existing: readonly SavedCombo[],
  legacy: readonly unknown[],
): SavedCombo[] {
  const out = [...existing];
  const ids = new Set(out.map((c) => c.id));
  legacy.forEach((entry, i) => {
    if (typeof entry !== 'string' || out.length >= MAX_SAVED_COMBOS) return;
    const c = normalizeSavedCombo(entry, uniqueId(`legacy-${i}`, ids, true));
    if (!c) return;
    const text = stepsToText(c.steps);
    if (out.some((o) => stepsToText(o.steps) === text)) return;
    ids.add(c.id);
    out.push(c);
  });
  return out;
}

/** `base` if unused (when `tryBase`), else `base` + a counter. */
export function uniqueId(base: string, used: ReadonlySet<string>, tryBase = false): string {
  if (tryBase && !used.has(base)) return base;
  for (let n = 1; ; n++) {
    const id = `${base}${n}`.slice(0, 64);
    if (!used.has(id)) return id;
  }
}

// ---- Running ---------------------------------------------------------------------------

export interface ComboPhase {
  readonly events: KeyEvent[];
  /** Wait after these events before the next phase (ms). */
  readonly waitMs: number;
}

/**
 * The key events per step and the pauses between them. Each step presses and releases its
 * chord within its own phase, so stopping between phases never leaves a key held. Steps
 * without a pause are merged into the previous phase (sent in one go).
 */
export function comboSchedule(
  steps: readonly ComboStep[],
  held: ReadonlySet<number> = new Set(),
): ComboPhase[] {
  const out: { events: KeyEvent[]; waitMs: number }[] = [];
  let cur: { events: KeyEvent[]; waitMs: number } = { events: [], waitMs: 0 };
  steps.forEach((s, i) => {
    cur.events.push(...comboEvents({ steps: [s.keys as Chord] }, held));
    const last = i === steps.length - 1;
    if (s.delayMs && !last) {
      cur.waitMs = s.delayMs;
      out.push(cur);
      cur = { events: [], waitMs: 0 };
    }
  });
  if (cur.events.length > 0 || out.length === 0) out.push(cur);
  return out;
}

export function totalDelayMs(steps: readonly ComboStep[]): number {
  return steps.slice(0, -1).reduce((n, s) => n + (s.delayMs ?? 0), 0);
}

// ---- Tap-to-build editor ---------------------------------------------------------------

export interface ComboDraft {
  readonly name: string;
  readonly steps: readonly ComboStep[];
  /** Modifiers toggled for the next key tap (cleared after it). */
  readonly mods: readonly Modifier[];
  /** Modifiers stay on after a key tap (for Ctrl+K, Ctrl+C style sequences). */
  readonly keepMods: boolean;
}

export const EMPTY_DRAFT: ComboDraft = { name: '', steps: [], mods: [], keepMods: false };

export function draftFrom(c: SavedCombo | null): ComboDraft {
  return c ? { name: c.name, steps: c.steps, mods: [], keepMods: false } : EMPTY_DRAFT;
}

export type ComboDraftAction =
  | { readonly type: 'toggle-mod'; readonly mod: Modifier }
  | { readonly type: 'keep-mods'; readonly on: boolean }
  /** Tap a key: append a step `[...mods, key]` (or add it to step `into`). */
  | { readonly type: 'key'; readonly key: string; readonly into?: number }
  /** Append a step of the toggled modifiers alone (e.g. `Super`). */
  | { readonly type: 'mods-step' }
  | { readonly type: 'remove-step'; readonly index: number }
  | { readonly type: 'move-step'; readonly index: number; readonly delta: -1 | 1 }
  | { readonly type: 'remove-key'; readonly index: number; readonly key: string }
  | { readonly type: 'delay'; readonly index: number; readonly ms: number }
  | { readonly type: 'name'; readonly name: string }
  | { readonly type: 'text'; readonly steps: readonly ComboStep[] }
  | { readonly type: 'clear' };

function orderChord(keys: readonly string[]): string[] {
  const mods = MODIFIERS.filter((m) => keys.includes(m));
  return [...mods, ...keys.filter((k) => !(MODIFIERS as readonly string[]).includes(k))];
}

export function reduceComboDraft(d: ComboDraft, a: ComboDraftAction): ComboDraft {
  switch (a.type) {
    case 'toggle-mod':
      return {
        ...d,
        mods: d.mods.includes(a.mod) ? d.mods.filter((m) => m !== a.mod) : [...d.mods, a.mod],
      };
    case 'keep-mods':
      return { ...d, keepMods: a.on };
    case 'key': {
      const key = canonicalComboKey(a.key);
      if (key === null || keysymForComboToken(key) === null) return d;
      const mods = d.keepMods ? d.mods : [];
      if (a.into !== undefined) {
        const step = d.steps[a.into];
        if (!step || step.keys.includes(key) || step.keys.length >= MAX_CHORD_KEYS) return d;
        const steps = d.steps.map((s, i) =>
          i === a.into ? { ...s, keys: orderChord([...s.keys, key]) } : s,
        );
        return { ...d, steps, mods };
      }
      if (d.steps.length >= MAX_COMBO_STEPS) return d;
      const keys = orderChord([...d.mods.filter((m) => m !== key), key]).slice(0, MAX_CHORD_KEYS);
      return { ...d, steps: [...d.steps, { keys }], mods };
    }
    case 'mods-step': {
      if (d.mods.length === 0 || d.steps.length >= MAX_COMBO_STEPS) return d;
      return {
        ...d,
        steps: [...d.steps, { keys: orderChord(d.mods) }],
        mods: d.keepMods ? d.mods : [],
      };
    }
    case 'remove-step':
      return { ...d, steps: d.steps.filter((_, i) => i !== a.index) };
    case 'move-step': {
      const j = a.index + a.delta;
      if (a.index < 0 || a.index >= d.steps.length || j < 0 || j >= d.steps.length) return d;
      const steps = [...d.steps];
      const x = steps[a.index];
      const y = steps[j];
      if (!x || !y) return d;
      steps[a.index] = y;
      steps[j] = x;
      return { ...d, steps };
    }
    case 'remove-key': {
      const steps = d.steps
        .map((s, i) => (i === a.index ? { ...s, keys: s.keys.filter((k) => k !== a.key) } : s))
        .filter((s) => s.keys.length > 0);
      return { ...d, steps };
    }
    case 'delay': {
      const ms = clampDelay(a.ms);
      const steps = d.steps.map((s, i) => {
        if (i !== a.index) return s;
        return ms === undefined ? { keys: s.keys } : { keys: s.keys, delayMs: ms };
      });
      return { ...d, steps };
    }
    case 'name':
      return { ...d, name: a.name.slice(0, MAX_COMBO_NAME) };
    case 'text':
      return { ...d, steps: a.steps.slice(0, MAX_COMBO_STEPS) };
    case 'clear':
      return { ...d, steps: [], mods: [] };
  }
}

/** The draft as a combo to save, or null when it has no steps. */
export function draftToCombo(d: ComboDraft, id: string): SavedCombo | null {
  if (d.steps.length === 0) return null;
  const name = d.name.trim() || stepsToText(d.steps);
  return { id, name: name.slice(0, MAX_COMBO_NAME), steps: d.steps };
}

// ---- Key picker groups -----------------------------------------------------------------

export type KeyGroup = 'letters' | 'digits' | 'symbols' | 'navigation' | 'editing' | 'function';

export const KEY_GROUPS: readonly KeyGroup[] = [
  'letters',
  'digits',
  'symbols',
  'navigation',
  'editing',
  'function',
];

/**
 * Keys per picker group. All are verified to have keysyms (`keysymForComboToken`). Media
 * keys (XF86Audio*) are not offered: guacd's RDP keymaps (guacamole-server 1.6.0
 * `rdp/keymaps/base.keymap`) define no XF86 keysyms, so they would do nothing over RDP.
 */
export const KEY_GROUP_KEYS: Readonly<Record<KeyGroup, readonly string[]>> = {
  letters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
  digits: '0123456789'.split(''),
  symbols: [
    '`',
    '-',
    '=',
    '[',
    ']',
    '\\',
    ';',
    "'",
    'Comma',
    '.',
    '/',
    'Plus',
    '*',
    '|',
    '~',
    '!',
    '@',
    '#',
    '$',
    '%',
    '^',
    '&',
    '_',
    '?',
    ':',
    '"',
    '<',
    '>',
    '(',
    ')',
    '{',
    '}',
    'Space',
  ],
  navigation: ['Left', 'Up', 'Down', 'Right', 'Home', 'End', 'PageUp', 'PageDown', 'Tab', 'Esc'],
  editing: [
    'Enter',
    'Backspace',
    'Delete',
    'Insert',
    'PrintScreen',
    'Pause',
    'Menu',
    'CapsLock',
    'NumLock',
    'ScrollLock',
    'SysRq',
  ],
  function: Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
};
