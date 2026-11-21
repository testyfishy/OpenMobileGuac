import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { InputMenu } from '../session/InputMenu.tsx';
import {
  DEFAULT_SESSION_SETTINGS,
  INPUT_RANGES,
  LEGACY_SESSION_KEYS,
  normalizeSessionSettings,
  type ResolvedSessionSettings,
} from '../session/settings.ts';
import { SETTING_DESCRIPTORS, type SettingDescriptor } from '../session/settingsSchema.ts';
import { SettingsPageBody } from './SettingsPageBody.tsx';
import {
  APP_ITEMS,
  ROUTE_ITEMS,
  SETTINGS_CATEGORIES,
  SETTINGS_PAGES,
  appItemText,
  placedSessionKeys,
  routeItemText,
  searchSettings,
  sessionItemText,
  type SearchContext,
  type SettingsPageId,
} from './settingsCatalog.ts';
import { setActiveLocale } from '../strings.ts';
import {
  DEFAULT_APP_SETTINGS,
  demoVisible,
  diffFromDefaults,
  mergeSessionSettings,
  overriddenKeys,
  parseAppSettings,
  removeConnectionKeys,
  sanitizeSessionPatch,
  settingsFromBackup,
} from './settingsModel.ts';

const LEGACY: readonly string[] = LEGACY_SESSION_KEYS;
/** Every field with a control (the legacy key-bar fields are read for migration only). */
const KEYS = Object.keys(DEFAULT_SESSION_SETTINGS)
  .filter((k) => !LEGACY.includes(k))
  .sort();

/** A valid value different from the built-in default, for each control kind. */
function nonDefault(d: SettingDescriptor): unknown {
  const def = DEFAULT_SESSION_SETTINGS[d.key];
  switch (d.control) {
    case 'switch':
      return !def;
    case 'choice':
      return d.options.find((o) => o !== def);
    case 'range':
      return INPUT_RANGES[d.key][1] === def ? INPUT_RANGES[d.key][0] : INPUT_RANGES[d.key][1];
    case 'list':
      return d.editor === 'toolbar' ? ['files', 'keyboard'] : 'builtin:terminal';
  }
}

const CTX: SearchContext = { values: DEFAULT_SESSION_SETTINGS, biometryLabel: 'Face ID' };

/** One Settings sub-page, app items stubbed with their marker only. */
function renderPage(page: SettingsPageId): string {
  return renderToStaticMarkup(
    <SettingsPageBody
      page={page}
      values={DEFAULT_SESSION_SETTINGS}
      changed={new Set()}
      onChange={() => undefined}
      onEditList={() => undefined}
      renderApp={() => <span />}
      onResetKeys={() => undefined}
    />,
  );
}

function keysIn(html: string): string[] {
  return [...html.matchAll(/data-setting-key="([^"]+)"/g)].map((m) => m[1] ?? '').sort();
}

describe('session settings descriptor table', () => {
  it('has exactly one row per SessionSettings field', () => {
    const keys = SETTING_DESCRIPTORS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(KEYS);
  });

  it('every field survives the stored-settings sanitiser (app, server and connection layers)', () => {
    for (const d of SETTING_DESCRIPTORS) {
      const value = nonDefault(d);
      expect(value, d.key).not.toBeUndefined();
      const patch = sanitizeSessionPatch({ [d.key]: value });
      expect(patch, d.key).toHaveProperty(d.key);
      expect(JSON.stringify(patch[d.key as keyof typeof patch]), d.key).toBe(JSON.stringify(value));
    }
  });

  it('the Settings pages render a control for every field, each exactly once', () => {
    const keys = SETTINGS_PAGES.flatMap((page) => keysIn(renderPage(page)));
    expect([...keys].sort()).toEqual(KEYS);
  });

  it('the in-session options sheet renders a control for every field', () => {
    const html = renderToStaticMarkup(
      <InputMenu
        settings={DEFAULT_SESSION_SETTINGS}
        touchSupport={0}
        onChange={() => undefined}
        onEditList={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(keysIn(html)).toEqual(KEYS);
  });

  it('search narrows the Settings list', () => {
    const refs = searchSettings('toolbar', CTX).map((r) => r.ref);
    expect(refs).toContain('toolbarStyle');
    expect(refs).not.toContain('longPressMs');
    expect(searchSettings('', CTX)).toEqual([]);
  });
});

describe('Settings categories and search', () => {
  it('has a short top level (6–9 rows) with unique ids', () => {
    const ids = SETTINGS_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(6);
    expect(ids.length).toBeLessThanOrEqual(9);
    expect(ids).toEqual([...SETTINGS_PAGES]);
  });

  it('every session setting belongs to exactly one category and group', () => {
    const placed = placedSessionKeys();
    expect(new Set(placed).size).toBe(placed.length);
    expect([...placed].sort()).toEqual(KEYS);
  });

  it('every app-level item belongs to exactly one group and is rendered there', () => {
    const refs = SETTINGS_CATEGORIES.flatMap((c) => c.groups.flatMap((g) => g.items)).filter((r) =>
      r.startsWith('app:'),
    );
    expect(new Set(refs).size).toBe(refs.length);
    expect([...refs].sort()).toEqual(APP_ITEMS.map((id) => `app:${id}`).sort());
    const rendered = SETTINGS_PAGES.flatMap((page) =>
      [...renderPage(page).matchAll(/data-setting-id="([^"]+)"/g)].map((m) => m[1] ?? ''),
    );
    expect(rendered.sort()).toEqual([...APP_ITEMS].sort());
  });

  it('every group has items; Backup opens its own screen directly', () => {
    for (const c of SETTINGS_CATEGORIES) {
      if (c.route) expect(c.groups, c.id).toEqual([]);
      for (const g of c.groups) expect(g.items.length, `${c.id}/${g.id}`).toBeGreaterThan(0);
    }
  });

  it.each(['en', 'es'] as const)('finds every setting by its own label (%s)', (locale) => {
    try {
      setActiveLocale(locale);
      for (const d of SETTING_DESCRIPTORS) {
        const { label } = sessionItemText(d, DEFAULT_SESSION_SETTINGS);
        expect(label.trim(), d.key).not.toBe('');
        const refs = searchSettings(label, CTX).map((r) => r.ref);
        expect(refs, `${locale}: ${d.key} "${label}"`).toContain(d.key);
      }
      for (const id of APP_ITEMS) {
        const { label } = appItemText(id, CTX);
        expect(label.trim(), id).not.toBe('');
        const refs = searchSettings(label, CTX).map((r) => r.ref);
        expect(refs, `${locale}: ${id} "${label}"`).toContain(`app:${id}`);
      }
      for (const id of ROUTE_ITEMS) {
        const refs = searchSettings(routeItemText(id).label, CTX).map((r) => r.ref);
        expect(refs, `${locale}: ${id}`).toContain(`route:${id}`);
      }
    } finally {
      setActiveLocale('en');
    }
  });

  it('search results name their category and are accent- and case-insensitive', () => {
    const lock = searchSettings('face id', CTX).find((r) => r.ref === 'app:lock');
    expect(lock?.where).toBe('Security & privacy › App lock');
    expect(searchSettings('biometr', CTX).map((r) => r.ref)).toContain('app:rememberUnlock');
    // The device check is found by any wording, whatever this device uses.
    expect(
      searchSettings('fingerprint', { ...CTX, biometryLabel: 'Face ID' }).map((r) => r.ref),
    ).toContain('app:rememberUnlock');
    const landscape = searchSettings('landscape', CTX).map((r) => r.ref);
    expect(landscape).toEqual(expect.arrayContaining(['toolbarLandscape', 'keyBarLandscape']));
    expect(searchSettings('scroll', CTX).map((r) => r.ref)).toEqual(
      expect.arrayContaining(['naturalScroll', 'horizontalScroll']),
    );
    try {
      setActiveLocale('es');
      expect(searchSettings('BIOMETRIA', CTX).map((r) => r.ref)).toContain('app:rememberUnlock');
    } finally {
      setActiveLocale('en');
    }
  });
});

describe('defaults ← server ← connection with the new fields', () => {
  it('app defaults reach a new session; a connection override wins and can be dropped', () => {
    const app = diffFromDefaults(DEFAULT_SESSION_SETTINGS, {
      ...DEFAULT_SESSION_SETTINGS,
      toolbarStyle: 'dock-top',
      tapDismissKeyboard: 'hide-click',
    });
    expect(app).toEqual({ toolbarStyle: 'dock-top', tapDismissKeyboard: 'hide-click' });
    const stored = { toolbarStyle: 'floating', pointerSpeed: 2 };
    const merged: ResolvedSessionSettings = normalizeSessionSettings(
      mergeSessionSettings(DEFAULT_SESSION_SETTINGS, app, stored, { toolbarLabels: 'never' }),
    );
    expect(merged.toolbarStyle).toBe('floating');
    expect(merged.tapDismissKeyboard).toBe('hide-click');
    expect(merged.toolbarLabels).toBe('never');
    expect(overriddenKeys(stored).sort()).toEqual(['pointerSpeed', 'toolbarStyle']);
    const after = removeConnectionKeys(stored, ['toolbarStyle']);
    expect(after).toEqual({ pointerSpeed: 2 });
    expect(
      normalizeSessionSettings(mergeSessionSettings(DEFAULT_SESSION_SETTINGS, app, after))
        .toolbarStyle,
    ).toBe('dock-top');
  });

  it('a built-in toolbar row (null) is not stored as a change', () => {
    expect(diffFromDefaults(DEFAULT_SESSION_SETTINGS, { toolbarItems: null })).toEqual({});
    expect(diffFromDefaults(DEFAULT_SESSION_SETTINGS, { toolbarItems: ['files'] })).toEqual({
      toolbarItems: ['files'],
    });
  });
});

describe('Demo server visibility', () => {
  it('auto: shown only while no server is saved, hidden while loading', () => {
    expect(demoVisible('auto', 0)).toBe(true);
    expect(demoVisible('auto', 1)).toBe(false);
    expect(demoVisible('auto', 5)).toBe(false);
    expect(demoVisible('auto', undefined)).toBe(false);
  });

  it('show / hide override the rule', () => {
    expect(demoVisible('show', 3)).toBe(true);
    expect(demoVisible('show', undefined)).toBe(true);
    expect(demoVisible('hide', 0)).toBe(false);
  });

  it('"When a connection is already open": defaults to ask, keeps valid choices', () => {
    expect(DEFAULT_APP_SETTINGS.openAgain).toBe('switch');
    expect(parseAppSettings({}).openAgain).toBe('switch');
    expect(parseAppSettings({ openAgain: 'switch' }).openAgain).toBe('switch');
    expect(parseAppSettings({ openAgain: 'new' }).openAgain).toBe('new');
    expect(parseAppSettings({ openAgain: 'bogus' }).openAgain).toBe('switch');
    expect(parseAppSettings({ openAgain: 1 }).openAgain).toBe('switch');
  });

  it('"Ask before connecting" (MUL-5): defaults to when in use, keeps valid choices', () => {
    expect(DEFAULT_APP_SETTINGS.askInUse).toBe('in-use');
    expect(parseAppSettings({}).askInUse).toBe('in-use');
    expect(parseAppSettings({ askInUse: 'always' }).askInUse).toBe('always');
    expect(parseAppSettings({ askInUse: 'never' }).askInUse).toBe('never');
    expect(parseAppSettings({ askInUse: 'bogus' }).askInUse).toBe('in-use');
    expect(parseAppSettings({ askInUse: true }).askInUse).toBe('in-use');
    // Restored from a backup like the other session choices.
    expect(settingsFromBackup(DEFAULT_APP_SETTINGS, { askInUse: 'never' }).askInUse).toBe('never');
  });

  it('"Ask before connecting" sits next to "When a connection is already open"', () => {
    const sessions = SETTINGS_CATEGORIES.find((c) => c.id === 'sessions');
    const open = sessions?.groups.find((g) => g.id === 'open');
    expect(open?.items).toEqual(['app:maxSessions', 'app:openAgain', 'app:askInUse']);
  });

  it.each(['en', 'es'] as const)('"Ask before connecting" is found by its wording (%s)', (l) => {
    try {
      setActiveLocale(l);
      const query = l === 'en' ? 'in use' : 'en uso';
      expect(searchSettings(query, CTX).map((r) => r.ref)).toContain('app:askInUse');
      const { label, text } = appItemText('askInUse', CTX);
      expect(searchSettings(label, CTX)[0]?.where).toContain(l === 'en' ? 'Sessions' : 'Sesiones');
      // The hint says how it differs from the in-app setting, by that setting's own label.
      expect(text.join(' ')).toContain(appItemText('openAgain', CTX).label);
    } finally {
      setActiveLocale('en');
    }
  });

  it('defaults to auto and survives parsing', () => {
    expect(DEFAULT_APP_SETTINGS.showDemo).toBe('auto');
    expect(parseAppSettings({}).showDemo).toBe('auto');
    expect(parseAppSettings({ showDemo: 'show' }).showDemo).toBe('show');
    expect(parseAppSettings({ showDemo: 'bogus' }).showDemo).toBe('auto');
  });
});

describe('key library in the app settings (KEY-9)', () => {
  it('fresh settings: default library, Terminal for terminal protocols', () => {
    const s = parseAppSettings({});
    expect(s.keys.sets).toEqual([]);
    expect(s.keys.protocolDefaults['ssh']).toBe('builtin:terminal');
    expect(s.keepAliveBackground).toBe(false);
    expect(s.autoBackup).toEqual({ enabled: false, frequency: 'weekly', keep: 5 });
  });

  it('migrates an app-wide key bar layout and custom combos from before key sets', () => {
    const s = parseAppSettings({
      sessionDefaults: {
        keyBarLayout: [['Esc', 'F5']],
        customCombos: ['Ctrl+Shift+T'],
        pointerSpeed: 2,
      },
    });
    expect(s.keys.sets).toEqual([
      { id: 'user-my-key-bar', name: 'My key bar', rows: [['Esc', 'F5']] },
    ]);
    expect(s.keys.combos.map((c) => c.name)).toEqual(['Ctrl+Shift+T']);
    expect(s.sessionDefaults).toEqual({ pointerSpeed: 2, keySet: 'user-my-key-bar' });
  });

  it('a stored library wins (no repeated migration)', () => {
    const s = parseAppSettings({
      keys: { sets: [], combos: [] },
      sessionDefaults: { customCombos: ['Alt+F4'] },
    });
    expect(s.keys.combos).toEqual([]);
    expect(s.keys.protocolDefaults).toEqual({});
  });

  it('per-connection legacy values still load (shown as the legacy set and combos)', () => {
    const merged = normalizeSessionSettings(
      mergeSessionSettings(
        DEFAULT_SESSION_SETTINGS,
        {},
        { keyBarLayout: [['Tab']], customCombos: ['Win+D'] },
      ),
    );
    expect(merged.keyBarLayout).toEqual([['Tab']]);
    expect(merged.customCombos).toEqual(['Win+D']);
  });

  it('the library travels in backups; restoring keeps the device lock', () => {
    const current = parseAppSettings({ lock: { enabled: true, afterSeconds: 30 } });
    const restored = settingsFromBackup(current, {
      keys: { sets: [{ id: 'user-a', name: 'A', rows: [['Esc']] }] },
      autoBackup: { enabled: true, frequency: 'daily', keep: 3 },
    });
    expect(restored.keys.sets.map((x) => x.id)).toEqual(['user-a']);
    expect(restored.autoBackup.frequency).toBe('daily');
    expect(restored.lock.enabled).toBe(true);
  });
});
