import { describe, expect, it } from 'vitest';
import {
  EMPTY_DRAFT,
  KEY_GROUPS,
  KEY_GROUP_KEYS,
  MAX_STEP_DELAY_MS,
  comboSchedule,
  draftFrom,
  draftToCombo,
  migrateLegacyCombos,
  normalizeComboList,
  normalizeSavedCombo,
  reduceComboDraft,
  stepsFromText,
  stepsToText,
  totalDelayMs,
  type ComboDraft,
  type ComboDraftAction,
  type ComboStep,
} from './ComboLibrary.ts';
import { KEYSYM, keysymForComboToken } from './KeyModel.ts';
import { parseToken } from './KeyLayout.ts';

const CTRL = KEYSYM.Control_L;
const ALT = KEYSYM.Alt_L;

describe('typed form ↔ steps', () => {
  it.each([
    ['Ctrl+Alt+Del', [{ keys: ['Ctrl', 'Alt', 'Delete'] }], 'Ctrl+Alt+Delete'],
    ['ctrl+k, ctrl+c', [{ keys: ['Ctrl', 'K'] }, { keys: ['Ctrl', 'C'] }], 'Ctrl+K, Ctrl+C'],
    ['Win', [{ keys: ['Super'] }], 'Super'],
    ['Ctrl++', [{ keys: ['Ctrl', 'Plus'] }], 'Ctrl+Plus'],
  ])('%s', (text, steps, canonical) => {
    const r = stepsFromText(text);
    expect(r).toEqual({ ok: true, steps });
    expect(stepsToText(steps)).toBe(canonical);
  });

  it('keeps pauses by step index when the text is edited', () => {
    const before: ComboStep[] = [{ keys: ['Ctrl', 'K'], delayMs: 200 }, { keys: ['Ctrl', 'C'] }];
    const r = stepsFromText('Ctrl+K, Ctrl+V', before);
    expect(r).toEqual({
      ok: true,
      steps: [{ keys: ['Ctrl', 'K'], delayMs: 200 }, { keys: ['Ctrl', 'V'] }],
    });
  });

  it('reports errors', () => {
    expect(stepsFromText('Ctrl+').ok).toBe(false);
    expect(stepsFromText('Hyper+X').ok).toBe(false);
  });
});

describe('stored combos', () => {
  it('old string entries keep loading (migration)', () => {
    expect(normalizeSavedCombo('Ctrl+Shift+Esc', 'legacy-0')).toEqual({
      id: 'legacy-0',
      name: 'Ctrl+Shift+Esc',
      steps: [{ keys: ['Ctrl', 'Shift', 'Esc'] }],
    });
    expect(normalizeSavedCombo('not a key', 'x')).toBeNull();
  });

  it('a list may mix both forms; ids are made unique', () => {
    const list = normalizeComboList([
      'Alt+Tab',
      { id: 'a', name: 'A', steps: [{ keys: ['F5'] }] },
      { id: 'a', name: 'A again', steps: [{ keys: ['F6'] }] },
      { id: 'bad', steps: [] },
    ]);
    expect(list.map((c) => c.id)).toEqual(['legacy-0', 'a', 'a-1']);
  });

  it('clamps pauses and drops bad keys', () => {
    const c = normalizeSavedCombo(
      {
        id: 'x',
        name: '',
        steps: [
          { keys: ['ctrl', 'nope', 'c'], delayMs: 10 ** 9 },
          { keys: ['F1'], delayMs: -5 },
        ],
      },
      'f',
    );
    expect(c).toEqual({
      id: 'x',
      name: 'Ctrl+C, F1',
      steps: [{ keys: ['Ctrl', 'C'], delayMs: MAX_STEP_DELAY_MS }, { keys: ['F1'] }],
    });
  });

  it('migrating legacy strings skips ones already saved', () => {
    const existing = normalizeComboList([
      { id: 'c1', name: 'Mine', steps: [{ keys: ['Alt', 'Tab'] }] },
    ]);
    const out = migrateLegacyCombos(existing, ['Alt+Tab', 'Ctrl+Alt+Del', 3]);
    expect(out.map((c) => c.name)).toEqual(['Mine', 'Ctrl+Alt+Delete']);
    // Repeating the migration adds nothing.
    expect(migrateLegacyCombos(out, ['Alt+Tab', 'Ctrl+Alt+Del'])).toEqual(out);
  });
});

describe('comboSchedule', () => {
  it('without pauses everything goes in one phase', () => {
    const p = comboSchedule([{ keys: ['Ctrl', 'K'] }, { keys: ['Ctrl', 'C'] }]);
    expect(p).toHaveLength(1);
    expect(p[0]?.events.map((e) => [e.keysym, e.pressed])).toEqual([
      [CTRL, true],
      [0x6b, true],
      [0x6b, false],
      [CTRL, false],
      [CTRL, true],
      [0x63, true],
      [0x63, false],
      [CTRL, false],
    ]);
  });

  it('a pause splits phases; every phase releases what it pressed', () => {
    const steps: ComboStep[] = [
      { keys: ['Alt', 'F4'], delayMs: 300 },
      { keys: ['Enter'], delayMs: 100 },
      { keys: ['Esc'], delayMs: 999 },
    ];
    const p = comboSchedule(steps);
    expect(p.map((x) => x.waitMs)).toEqual([300, 100, 0]);
    for (const phase of p) {
      const down = new Set<number>();
      for (const e of phase.events) {
        if (e.pressed) down.add(e.keysym);
        else down.delete(e.keysym);
      }
      expect(down.size).toBe(0);
    }
    // The last step's pause is not waited for.
    expect(totalDelayMs(steps)).toBe(400);
  });

  it('keys held by a locked modifier are not pressed again', () => {
    const p = comboSchedule([{ keys: ['Alt', 'Tab'] }], new Set([ALT]));
    expect(p[0]?.events.map((e) => e.keysym)).toEqual([KEYSYM.Tab, KEYSYM.Tab]);
  });
});

describe('tap-to-build editor', () => {
  const run = (actions: ComboDraftAction[], from: ComboDraft = EMPTY_DRAFT) =>
    actions.reduce(reduceComboDraft, from);

  it.each<[string, ComboDraftAction[], readonly ComboStep[]]>([
    ['a plain key', [{ type: 'key', key: 'F5' }], [{ keys: ['F5'] }]],
    [
      'modifiers apply to the next key only',
      [
        { type: 'toggle-mod', mod: 'Ctrl' },
        { type: 'toggle-mod', mod: 'Alt' },
        { type: 'key', key: 'Delete' },
        { type: 'key', key: 'x' },
      ],
      [{ keys: ['Ctrl', 'Alt', 'Delete'] }, { keys: ['X'] }],
    ],
    [
      'keep modifiers builds Ctrl+K, Ctrl+C',
      [
        { type: 'keep-mods', on: true },
        { type: 'toggle-mod', mod: 'Ctrl' },
        { type: 'key', key: 'K' },
        { type: 'key', key: 'C' },
      ],
      [{ keys: ['Ctrl', 'K'] }, { keys: ['Ctrl', 'C'] }],
    ],
    [
      'modifiers alone',
      [{ type: 'toggle-mod', mod: 'Super' }, { type: 'mods-step' }],
      [{ keys: ['Super'] }],
    ],
    [
      'modifier order is canonical',
      [
        { type: 'toggle-mod', mod: 'Shift' },
        { type: 'toggle-mod', mod: 'Ctrl' },
        { type: 'key', key: 'Esc' },
      ],
      [{ keys: ['Ctrl', 'Shift', 'Esc'] }],
    ],
    [
      'add a key into a step',
      [
        { type: 'key', key: 'Ctrl' },
        { type: 'key', key: 'T', into: 0 },
      ],
      [{ keys: ['Ctrl', 'T'] }],
    ],
    [
      'reorder, pause, remove',
      [
        { type: 'key', key: 'A' },
        { type: 'key', key: 'B' },
        { type: 'move-step', index: 1, delta: -1 },
        { type: 'delay', index: 0, ms: 250 },
        { type: 'key', key: 'C' },
        { type: 'remove-step', index: 2 },
      ],
      [{ keys: ['B'], delayMs: 250 }, { keys: ['A'] }],
    ],
    [
      'removing the last key of a step removes the step',
      [
        { type: 'key', key: 'A' },
        { type: 'remove-key', index: 0, key: 'A' },
      ],
      [],
    ],
    ['unknown keys are ignored', [{ type: 'key', key: 'Hyper' }], []],
    [
      'a zero pause clears it',
      [
        { type: 'key', key: 'A' },
        { type: 'delay', index: 0, ms: 300 },
        { type: 'delay', index: 0, ms: 0 },
      ],
      [{ keys: ['A'] }],
    ],
  ])('%s', (_name, actions, steps) => {
    expect(run(actions).steps).toEqual(steps);
  });

  it('mods clear after a key unless kept', () => {
    expect(
      run([
        { type: 'toggle-mod', mod: 'Ctrl' },
        { type: 'key', key: 'A' },
      ]).mods,
    ).toEqual([]);
  });

  it('names and saves; an empty draft cannot be saved', () => {
    expect(draftToCombo(EMPTY_DRAFT, 'c1')).toBeNull();
    const d = run([
      { type: 'name', name: 'Task manager' },
      { type: 'toggle-mod', mod: 'Ctrl' },
      { type: 'toggle-mod', mod: 'Shift' },
      { type: 'key', key: 'Esc' },
    ]);
    expect(draftToCombo(d, 'c1')).toEqual({
      id: 'c1',
      name: 'Task manager',
      steps: [{ keys: ['Ctrl', 'Shift', 'Esc'] }],
    });
    expect(draftToCombo({ ...d, name: ' ' }, 'c1')?.name).toBe('Ctrl+Shift+Esc');
    expect(draftFrom({ id: 'c1', name: 'n', steps: d.steps }).steps).toEqual(d.steps);
  });
});

describe('picker groups', () => {
  it('every offered key has a keysym and is a valid combo token', () => {
    for (const g of KEY_GROUPS) {
      for (const k of KEY_GROUP_KEYS[g]) {
        expect(keysymForComboToken(k), `${g} ${k}`).not.toBeNull();
        expect(parseToken(`combo:Ctrl+${k}`), `${g} ${k}`).not.toBeNull();
      }
    }
  });
});
