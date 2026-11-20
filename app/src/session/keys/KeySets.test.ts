import { describe, expect, it } from 'vitest';
import { normalizeComboList, type SavedCombo } from './ComboLibrary.ts';
import { parseToken } from './KeyLayout.ts';
import {
  BUILTIN_KEY_SETS,
  DEFAULT_KEY_LIBRARY,
  EMPTY_KEY_LIBRARY,
  GENERAL_SET_ID,
  LEGACY_SET_ID,
  MAX_KEY_SETS,
  TERMINAL_SET_ID,
  combosUsedBy,
  exportKeys,
  findSet,
  mergeImportedKeys,
  migrateLegacyLibrary,
  normalizeKeyLibrary,
  parseKeysFile,
  reduceKeyLibrary,
  resolveActiveKeySet,
  stepSet,
  switchableSets,
  type KeyLibrary,
} from './KeySets.ts';

const lib = (over: Partial<KeyLibrary> = {}): KeyLibrary => ({ ...EMPTY_KEY_LIBRARY, ...over });
const mine = { id: 'user-mine', name: 'Mine', rows: [['Esc', 'text:ls -la']] };
const combo: SavedCombo = { id: 'c1', name: 'Lock', steps: [{ keys: ['Super', 'L'] }] };

describe('built-in key sets', () => {
  it('ship the six templates with only valid tokens', () => {
    expect(BUILTIN_KEY_SETS.map((s) => s.id)).toEqual([
      'builtin:general',
      'builtin:windows',
      'builtin:terminal',
      'builtin:mac',
      'builtin:editing',
      'builtin:function',
    ]);
    for (const s of BUILTIN_KEY_SETS) {
      for (const row of s.rows)
        for (const t of row) expect(parseToken(t), `${s.id} ${t}`).not.toBeNull();
    }
  });

  it('the terminal set has the shell keys', () => {
    const t = findSet(EMPTY_KEY_LIBRARY, TERMINAL_SET_ID)?.rows.flat() ?? [];
    for (const k of [
      'combo:Ctrl+C',
      'combo:Ctrl+D',
      'combo:Ctrl+Z',
      'Tab',
      'Esc',
      'text:|',
      'text:~',
      'text:/',
    ]) {
      expect(t).toContain(k);
    }
  });

  it('new installs use the terminal set for terminal protocols', () => {
    expect(DEFAULT_KEY_LIBRARY.protocolDefaults).toEqual({
      ssh: TERMINAL_SET_ID,
      telnet: TERMINAL_SET_ID,
      kubernetes: TERMINAL_SET_ID,
    });
  });
});

describe('resolveActiveKeySet', () => {
  const library = lib({ sets: [mine], protocolDefaults: { ssh: TERMINAL_SET_ID } });
  const cases: [string, Parameters<typeof resolveActiveKeySet>[0], string, string][] = [
    ['fallback', { library }, GENERAL_SET_ID, 'fallback'],
    ['app default', { library, defaultSet: 'builtin:windows' }, 'builtin:windows', 'app'],
    [
      'protocol beats app',
      { library, protocol: 'SSH', defaultSet: 'builtin:windows' },
      TERMINAL_SET_ID,
      'protocol',
    ],
    [
      'connection beats protocol',
      { library, protocol: 'ssh', connectionSet: 'user-mine' },
      'user-mine',
      'connection',
    ],
    [
      'legacy layout beats protocol',
      { library, protocol: 'ssh', legacyLayout: [['F1']] },
      LEGACY_SET_ID,
      'legacy',
    ],
    [
      'connection beats legacy',
      { library, legacyLayout: [['F1']], connectionSet: 'builtin:mac' },
      'builtin:mac',
      'connection',
    ],
    [
      'connection can pick legacy',
      { library, legacyLayout: [['F1']], connectionSet: LEGACY_SET_ID },
      LEGACY_SET_ID,
      'legacy',
    ],
    [
      'deleted connection set falls through',
      { library, connectionSet: 'user-gone', defaultSet: 'builtin:mac' },
      'builtin:mac',
      'app',
    ],
    [
      'unknown protocol default ignored',
      { library: lib({ protocolDefaults: { vnc: 'user-gone' } }), protocol: 'vnc' },
      GENERAL_SET_ID,
      'fallback',
    ],
  ];
  it.each(cases)('%s', (_name, input, id, source) => {
    const r = resolveActiveKeySet(input);
    expect(r.set.id).toBe(id);
    expect(r.source).toBe(source);
  });
});

describe('reduceKeyLibrary', () => {
  it('creates from a template, renames, moves and deletes user sets', () => {
    let l = lib();
    const r = reduceKeyLibrary(l, { type: 'create', name: 'Ops', from: BUILTIN_KEY_SETS[2] });
    expect(r.createdId).toBe('user-ops');
    l = r.library;
    expect(l.sets[0]?.rows).toEqual(BUILTIN_KEY_SETS[2]?.rows);
    l = reduceKeyLibrary(l, { type: 'create', name: 'Ops' }).library;
    expect(l.sets.map((s) => s.id)).toEqual(['user-ops', 'user-ops1']);
    expect(l.sets[1]?.rows).toEqual([[]]);
    l = reduceKeyLibrary(l, { type: 'rename', id: 'user-ops1', name: '  Blank  ' }).library;
    expect(l.sets[1]?.name).toBe('Blank');
    l = reduceKeyLibrary(l, { type: 'move', id: 'user-ops1', delta: -1 }).library;
    expect(l.sets.map((s) => s.id)).toEqual(['user-ops1', 'user-ops']);
    l = reduceKeyLibrary(l, { type: 'protocol-default', protocol: 'rdp', id: 'user-ops' }).library;
    l = reduceKeyLibrary(l, { type: 'delete', id: 'user-ops' }).library;
    expect(l.sets.map((s) => s.id)).toEqual(['user-ops1']);
    // A deleted set is no longer a protocol default.
    expect(l.protocolDefaults).toEqual({});
  });

  it('edits rows of a user set; built-ins are read-only', () => {
    let l = lib({ sets: [mine] });
    l = reduceKeyLibrary(l, {
      type: 'edit-rows',
      id: 'user-mine',
      edit: { type: 'add', row: 0, token: 'F5' },
    }).library;
    expect(l.sets[0]?.rows).toEqual([['Esc', 'text:ls -la', 'F5']]);
    const r = reduceKeyLibrary(l, {
      type: 'edit-rows',
      id: GENERAL_SET_ID,
      edit: { type: 'add-row' },
    });
    expect(r.refused).toBe('read-only');
    expect(reduceKeyLibrary(l, { type: 'delete', id: GENERAL_SET_ID }).refused).toBe('read-only');
  });

  it('refuses beyond the set limit', () => {
    let l = lib();
    for (let i = 0; i < MAX_KEY_SETS; i++)
      l = reduceKeyLibrary(l, { type: 'create', name: `S${i}` }).library;
    expect(reduceKeyLibrary(l, { type: 'create', name: 'one more' }).refused).toBe('limit');
  });

  it('hides built-ins from the switcher and steps through sets with wrap-around', () => {
    let l = lib({ sets: [mine] });
    l = reduceKeyLibrary(l, { type: 'hide-builtin', id: 'builtin:function', hidden: true }).library;
    const sets = switchableSets(l);
    expect(sets.map((s) => s.id)).toEqual([
      'user-mine',
      'builtin:general',
      'builtin:windows',
      'builtin:terminal',
      'builtin:mac',
      'builtin:editing',
    ]);
    expect(stepSet(sets, 'builtin:editing', 1).id).toBe('user-mine');
    expect(stepSet(sets, 'user-mine', -1).id).toBe('builtin:editing');
    expect(stepSet(sets, 'not-there', 1).id).toBe('user-mine');
  });

  it('saves, reorders and deletes combos', () => {
    let l = lib();
    l = reduceKeyLibrary(l, { type: 'save-combo', combo }).library;
    l = reduceKeyLibrary(l, {
      type: 'save-combo',
      combo: { ...combo, id: 'c2', name: 'Two' },
    }).library;
    l = reduceKeyLibrary(l, {
      type: 'save-combo',
      combo: { ...combo, name: 'Lock screen' },
    }).library;
    expect(l.combos.map((c) => c.name)).toEqual(['Lock screen', 'Two']);
    l = reduceKeyLibrary(l, { type: 'move-combo', id: 'c2', delta: -1 }).library;
    expect(l.combos.map((c) => c.id)).toEqual(['c2', 'c1']);
    l = reduceKeyLibrary(l, { type: 'delete-combo', id: 'c2' }).library;
    expect(l.combos.map((c) => c.id)).toEqual(['c1']);
  });
});

describe('normalizeKeyLibrary', () => {
  it('drops bad sets, ids and tokens; accepts legacy string combos', () => {
    const n = normalizeKeyLibrary({
      sets: [
        { id: 'user-a', name: 'A', rows: [['Esc', 'bogus', 'saved:c1']] },
        { id: 'user-a', name: 'dup', rows: [['Tab']] },
        { id: 'builtin:general', name: 'not mine', rows: [['Tab']] },
        { id: 'user-b', name: '', rows: 'x' },
      ],
      combos: [
        'Ctrl+Alt+Del',
        { id: 'c1', name: 'Lock', steps: [{ keys: ['Super', 'l'], delayMs: 99999 }] },
        7,
      ],
      protocolDefaults: { ssh: 'user-a', 'Bad Proto': 'user-a', rdp: 42 },
      hiddenBuiltIns: ['builtin:mac', 'builtin:mac', 'nope'],
    });
    expect(n.sets).toEqual([
      { id: 'user-a', name: 'A', rows: [['Esc', 'saved:c1']] },
      { id: 'user-b', name: 'Key set', rows: [[]] },
    ]);
    expect(n.combos.map((c) => c.name)).toEqual(['Ctrl+Alt+Delete', 'Lock']);
    expect(n.combos[1]?.steps).toEqual([{ keys: ['Super', 'L'], delayMs: 5000 }]);
    expect(n.protocolDefaults).toEqual({ ssh: 'user-a' });
    expect(n.hiddenBuiltIns).toEqual(['builtin:mac']);
  });

  it('a missing or broken library is the default one', () => {
    expect(normalizeKeyLibrary(undefined)).toEqual(DEFAULT_KEY_LIBRARY);
    expect(normalizeKeyLibrary('x')).toEqual(DEFAULT_KEY_LIBRARY);
  });
});

describe('migration from settings before key sets', () => {
  it('an app-wide custom layout becomes "My key bar" and the default set', () => {
    const m = migrateLegacyLibrary([['Esc', 'combo:Ctrl+C', 'junk']], ['Ctrl+Shift+T', 'Alt+F4']);
    expect(m.defaultSet).toBe('user-my-key-bar');
    expect(m.library.sets).toEqual([
      { id: 'user-my-key-bar', name: 'My key bar', rows: [['Esc', 'combo:Ctrl+C']] },
    ]);
    expect(m.library.combos.map((c) => c.name)).toEqual(['Ctrl+Shift+T', 'Alt+F4']);
    // The migrated layout was what terminal sessions used too: no protocol default.
    expect(m.library.protocolDefaults).toEqual({});
  });

  it('only combos: default library plus the combos', () => {
    const m = migrateLegacyLibrary(null, ['Ctrl+K, Ctrl+C']);
    expect(m.defaultSet).toBeUndefined();
    expect(m.library.protocolDefaults).toEqual(DEFAULT_KEY_LIBRARY.protocolDefaults);
    expect(m.library.combos[0]?.steps).toEqual([{ keys: ['Ctrl', 'K'] }, { keys: ['Ctrl', 'C'] }]);
  });
});

describe('import / export', () => {
  it('round-trips sets and combos; saved-combo keys follow the new combo ids', () => {
    const source = lib({
      sets: [{ id: 'user-x', name: 'Shared', rows: [['Esc', 'saved:c1']] }],
      combos: [combo],
    });
    const file = exportKeys(source);
    expect(file.format).toBe('openmobileguac-keys');
    const parsed = parseKeysFile(JSON.stringify(file));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // The target already has a combo "c1" and a set named "Shared".
    const target = lib({
      sets: [{ id: 'user-shared', name: 'Shared', rows: [['Tab']] }],
      combos: [{ ...combo, name: 'Other' }],
    });
    const m = mergeImportedKeys(target, parsed);
    expect(m.addedSets).toBe(1);
    expect(m.addedCombos).toBe(1);
    const added = m.library.sets[1];
    expect(added?.name).toBe('Shared (2)');
    const newId = m.library.combos[1]?.id;
    expect(newId).not.toBe('c1');
    expect(added?.rows).toEqual([['Esc', `saved:${newId}`]]);
    expect(added && combosUsedBy(added)).toEqual([newId]);
  });

  it('exporting chosen sets also takes the combos they use', () => {
    const l = lib({
      sets: [mine, { id: 'user-y', name: 'Y', rows: [['saved:c1']] }],
      combos: [combo, { ...combo, id: 'c9' }],
    });
    const f = exportKeys(l, { sets: ['user-y'], combos: [] });
    expect(f.sets.map((s) => s.name)).toEqual(['Y']);
    expect(f.combos.map((c) => c.id)).toEqual(['c1']);
  });

  it.each([
    ['not json', '{', 'json'],
    ['other format', JSON.stringify({ format: 'x', version: 1 }), 'format'],
    ['newer version', JSON.stringify({ format: 'openmobileguac-keys', version: 99 }), 'version'],
    [
      'empty',
      JSON.stringify({ format: 'openmobileguac-keys', version: 1, sets: [], combos: [] }),
      'empty',
    ],
  ])('rejects %s', (_n, text, error) => {
    expect(parseKeysFile(text)).toEqual({ ok: false, error });
  });

  it('dropped saved-combo keys whose combo is not in the file', () => {
    const parsed = parseKeysFile(
      JSON.stringify({
        format: 'openmobileguac-keys',
        version: 1,
        sets: [{ name: 'S', rows: [['saved:zz', 'F1']] }],
      }),
    );
    if (!parsed.ok) throw new Error('parse');
    const m = mergeImportedKeys(lib(), { sets: parsed.sets, combos: normalizeComboList([]) });
    expect(m.library.sets[0]?.rows).toEqual([['F1']]);
  });
});
