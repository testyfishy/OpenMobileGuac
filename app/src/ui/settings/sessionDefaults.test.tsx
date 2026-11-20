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
import { SessionDefaultsEditor } from './SessionDefaultsEditor.tsx';
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

  it('the Settings screen renders a control for every field', () => {
    const html = renderToStaticMarkup(
      <SessionDefaultsEditor
        values={DEFAULT_SESSION_SETTINGS}
        changed={new Set()}
        query=""
        onQuery={() => undefined}
        onChange={() => undefined}
        onResetSection={() => undefined}
        onResetAll={() => undefined}
        onEditList={() => undefined}
      />,
    );
    expect(keysIn(html)).toEqual(KEYS);
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
    const html = renderToStaticMarkup(
      <SessionDefaultsEditor
        values={DEFAULT_SESSION_SETTINGS}
        changed={new Set()}
        query="toolbar"
        onQuery={() => undefined}
        onChange={() => undefined}
        onResetSection={() => undefined}
        onResetAll={() => undefined}
        onEditList={() => undefined}
      />,
    );
    const keys = keysIn(html);
    expect(keys).toContain('toolbarStyle');
    expect(keys).not.toContain('longPressMs');
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
