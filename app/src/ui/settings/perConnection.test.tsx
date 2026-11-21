import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionRef } from '../../core/storage/ProfileStore.ts';
import { DEFAULT_SESSION_SETTINGS } from '../session/settings.ts';
import { SETTING_DESCRIPTORS, descriptorOf } from '../session/settingsSchema.ts';
import { setActiveLocale } from '../strings.ts';
import {
  LAYER_PAGES,
  allEntries,
  buildServerGroup,
  compactList,
  differingKeys,
  displayName,
  effectiveValues,
  entriesOverriding,
  entriesOverridingPage,
  inheritedValues,
  overrideList,
  overrideNames,
  ownKeys,
  summaryLine,
  withoutOwnValues,
  type ServerInput,
} from './connectionLayers.ts';
import { SessionListEditor } from './SessionListEditors.tsx';
import {
  affectsConnection,
  newOrigin,
  publishSettingsChange,
  subscribeSettingsChanges,
} from './connectionSettingsBus.ts';
import { SessionSettingBlock, type SessionBlockProps } from './SessionDefaultsEditor.tsx';
import { SettingsPageBody } from './SettingsPageBody.tsx';
import { searchSettings } from './settingsCatalog.ts';
import {
  DEFAULT_APP_SETTINGS,
  applyConnectionPatch,
  overriddenKeys,
  parseAppSettings,
  removeConnectionKeys,
  settingsRestore,
} from './settingsModel.ts';

const office: ConnectionRef = { dataSource: 'postgresql', identifier: '7', type: 'c' };
const laptop: ConnectionRef = { dataSource: 'postgresql', identifier: '8', type: 'c' };
const tablet: ConnectionRef = { dataSource: 'postgresql', identifier: '9', type: 'c' };
const unnamed: ConnectionRef = { dataSource: 'postgresql', identifier: '42', type: 'c' };

function input(over: Partial<ServerInput> = {}): ServerInput {
  return {
    serverId: 'srv-1',
    serverName: 'Lab server',
    hasServerDefaults: true,
    serverDefaults: {},
    stored: [
      { ref: office, settings: { pointerMode: 'trackpad', fitMode: 'one-to-one', haptics: false } },
      { ref: tablet, settings: { pointerMode: 'touch' } },
      { ref: unnamed, settings: { quality: 'low', keyBarLayout: [['Esc']] } },
    ],
    recents: [
      { ref: office, at: 30, name: 'Office desktop', protocol: 'rdp' },
      { ref: laptop, at: 20, name: 'Laptop', protocol: 'vnc' },
      { ref: tablet, at: 10, name: 'Tablet', protocol: 'rdp' },
    ],
    favourites: [laptop],
    ...over,
  };
}

afterEach(() => setActiveLocale('en'));

describe('own values vs effective defaults (pure)', () => {
  const inherited = inheritedValues({});

  it('counts only keys with a control; legacy fields are not "own values"', () => {
    expect(ownKeys({ keyBarLayout: [['Esc']], customCombos: ['Win+D'] })).toEqual([]);
    expect(ownKeys({ haptics: false, pointerMode: 'trackpad' })).toEqual([
      'pointerMode',
      'haptics',
    ]);
    expect(ownKeys({ bogus: 1, pointerMode: 'nope' })).toEqual([]);
  });

  it('diffs own values against what would be inherited (app ← server)', () => {
    const own = { pointerMode: 'trackpad', fitMode: 'fit-screen' } as const;
    // fit-screen is the built-in default: stored, but not a difference.
    expect(differingKeys(own, inherited)).toEqual(['pointerMode']);
    // With the app default set to trackpad, the connection's trackpad no longer differs.
    expect(differingKeys(own, inheritedValues({ pointerMode: 'trackpad' }))).toEqual([]);
    // The server layer sits between app and connection.
    const viaServer = inheritedValues({ pointerMode: 'trackpad' }, { pointerMode: 'touch' });
    expect(viaServer.pointerMode).toBe('touch');
    expect(differingKeys(own, viaServer)).toEqual(['pointerMode']);
    expect(effectiveValues(viaServer, own).pointerMode).toBe('trackpad');
  });

  it('summarises a row in one line', () => {
    expect(summaryLine({}, inherited)).toBe('Uses the defaults');
    expect(summaryLine({ keyBarLayout: [['Esc']] }, inherited)).toBe('Uses the defaults');
    expect(summaryLine({ fitMode: 'fit-screen' }, inherited)).toBe(
      '1 own value, same as the defaults',
    );
    expect(summaryLine({ pointerMode: 'trackpad' }, inherited)).toBe('Trackpad');
    expect(summaryLine({ pointerMode: 'trackpad', haptics: false }, inherited)).toBe(
      'Trackpad · Haptic feedback: Off',
    );
    expect(
      summaryLine({ pointerMode: 'trackpad', fitMode: 'one-to-one', haptics: false }, inherited),
    ).toBe('Trackpad · 1:1 pixels · 3 changes');
  });

  it('summaries follow the app language', () => {
    setActiveLocale('es');
    expect(summaryLine({}, inherited)).toBe('Usa los valores predeterminados');
    expect(
      summaryLine({ pointerMode: 'trackpad', haptics: false, quality: 'low' }, inherited),
    ).toMatch(/^Trackpad · .+ · 3 cambios$/);
  });

  it('names an unknown connection by its identifier', () => {
    expect(displayName({ name: undefined, ref: unnamed })).toBe('Connection 42');
    expect(displayName({ name: '  ', ref: { ...unnamed, type: 'g' } })).toBe('Group 42');
    expect(displayName({ name: 'Office desktop', ref: office })).toBe('Office desktop');
    setActiveLocale('es');
    expect(displayName({ name: undefined, ref: unnamed })).toBe('Conexión 42');
  });

  it('lists at most three names, then "and N more"', () => {
    expect(compactList(['A', 'B'])).toBe('A, B');
    expect(compactList(['A', 'B', 'C'])).toBe('A, B, C');
    expect(compactList(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C and 2 more');
  });
});

describe('the connection inventory of one server', () => {
  it('joins stored settings, recents and favourites once each, own values first', () => {
    const g = buildServerGroup(input(), {});
    expect(g.entries.map((e) => [displayName(e), ownKeys(e.own).length, e.favourite])).toEqual([
      ['Connection 42', 1, false],
      ['Office desktop', 3, false],
      ['Tablet', 1, false],
      ['Laptop', 0, true],
    ]);
    const o = g.entries.find((e) => e.ref.identifier === '7');
    expect(o?.protocol).toBe('rdp');
    expect(o?.lastUsed).toBe(30);
    expect(summaryLine(o?.own ?? {}, o?.inherited ?? DEFAULT_SESSION_SETTINGS)).toContain(
      'Trackpad',
    );
  });

  it('uses built-in names (the Demo) when no recent names them', () => {
    const g = buildServerGroup(
      input({
        recents: [],
        known: new Map([[`c\u0000postgresql\u00007`, { name: 'Demo desktop', protocol: 'demo' }]]),
      }),
      {},
    );
    expect(g.entries.find((e) => e.ref.identifier === '7')?.name).toBe('Demo desktop');
  });

  it('inherits the server defaults over the app defaults', () => {
    const g = buildServerGroup(input({ serverDefaults: { pointerMode: 'trackpad' } }), {
      pointerMode: 'touch',
    });
    expect(g.appInherited.pointerMode).toBe('touch');
    const laptopEntry = g.entries.find((e) => e.ref.identifier === '8');
    expect(laptopEntry?.inherited.pointerMode).toBe('trackpad');
    // The office's own trackpad equals what it would inherit now.
    const o = g.entries.find((e) => e.ref.identifier === '7');
    expect(differingKeys(o?.own ?? {}, o?.inherited ?? DEFAULT_SESSION_SETTINGS)).not.toContain(
      'pointerMode',
    );
  });

  it('finds who overrides a setting or a page', () => {
    const entries = allEntries([buildServerGroup(input(), {})]);
    expect(entriesOverriding(entries).length).toBe(3);
    expect(entriesOverridingPage(entries, 'pointer').map(displayName)).toEqual([
      'Office desktop',
      'Tablet',
    ]);
    expect(entriesOverridingPage(entries, 'gestures')).toEqual([]);
    expect(overrideList(entries, 'pointerMode')).toBe(
      'Office desktop (Trackpad), Tablet (Touch pass-through)',
    );
    expect(overrideNames(entries, 'quality')).toBe('Connection 42');
    expect(overrideNames(entries, 'audio')).toBe('');
  });
});

describe('change notification (live sessions follow Settings)', () => {
  it('reaches other origins only, and says which connection changed', () => {
    const a = newOrigin('session');
    const b = newOrigin('editor');
    const seenA = vi.fn();
    const seenB = vi.fn();
    const offA = subscribeSettingsChanges(a, seenA);
    const offB = subscribeSettingsChanges(b, seenB);
    publishSettingsChange('srv-1', office, b);
    expect(seenB).not.toHaveBeenCalled();
    expect(seenA).toHaveBeenCalledTimes(1);
    const change = seenA.mock.calls[0]?.[0];
    expect(affectsConnection(change, 'srv-1', office)).toBe(true);
    expect(affectsConnection(change, 'srv-1', laptop)).toBe(false);
    expect(affectsConnection(change, 'srv-2', office)).toBe(false);
    // A server's own defaults concern every connection of that server.
    publishSettingsChange('srv-1', undefined, b);
    expect(affectsConnection(seenA.mock.calls[1]?.[0], 'srv-1', laptop)).toBe(true);
    offA();
    publishSettingsChange('srv-1', office, b);
    expect(seenA).toHaveBeenCalledTimes(2);
    offB();
  });

  it('one failing listener does not stop the others', () => {
    const ok = vi.fn();
    const off1 = subscribeSettingsChanges(newOrigin('x'), () => {
      throw new Error('boom');
    });
    const off2 = subscribeSettingsChanges(newOrigin('y'), ok);
    publishSettingsChange('srv-1', office, newOrigin('z'));
    expect(ok).toHaveBeenCalledTimes(1);
    off1();
    off2();
  });
});

/** Props for one page in a layer: own pointer mode and gesture switch, the rest inherited. */
function layerProps(onUseDefault: (keys: string[]) => void = () => undefined): SessionBlockProps {
  const inherited = inheritedValues({});
  const own = { pointerMode: 'trackpad', gestureTwoFingerTap: false } as const;
  return {
    values: effectiveValues(inherited, own),
    changed: new Set(Object.keys(own)),
    onChange: () => undefined,
    onEditList: () => undefined,
    layer: {
      kind: 'connection',
      own: new Set(Object.keys(own)),
      inherited,
      onUseDefault,
    },
  };
}

function block(html: string, key: string): string {
  const start = html.indexOf(`data-setting-key="${key}"`);
  expect(start, key).toBeGreaterThan(-1);
  const next = html.indexOf('data-setting-key="', start + 10);
  return html.slice(start, next < 0 ? undefined : next);
}

/** The first element in a React tree whose props match, expanding function components. */
function findElement(
  node: ReactNode,
  test: (el: ReactElement) => boolean,
): ReactElement | undefined {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findElement(n as ReactNode, test);
      if (hit) return hit;
    }
    return undefined;
  }
  if (!isValidElement(node)) return undefined;
  if (test(node)) return node;
  const el = node as ReactElement<{ children?: ReactNode }>;
  // The block and its layer note only: the controls use hooks, which need a renderer.
  if (
    typeof el.type === 'function' &&
    ['SessionSettingBlock', 'LayerNote'].includes(el.type.name)
  ) {
    return findElement((el.type as (p: unknown) => ReactNode)(el.props), test);
  }
  return findElement(el.props.children, test);
}

describe('the layered editor (one connection’s own values)', () => {
  it('marks own values with the default and "Use default", the rest as inherited', () => {
    const p = layerProps();
    const html = renderToStaticMarkup(
      <SettingsPageBody
        page="pointer"
        {...p}
        renderApp={() => <i />}
        onResetKeys={() => undefined}
      />,
    );
    const mode = block(html, 'pointerMode');
    expect(mode).toContain('data-layer="own"');
    expect(mode).toContain('This connection');
    expect(mode).toContain('Default: Direct touch');
    expect(mode).toContain('Use the default for Pointer mode');
    const speed = block(html, 'pointerSpeed');
    expect(speed).toContain('data-layer="inherited"');
    expect(speed).not.toContain('Use default');
    // The page's reset is about this connection, and enabled (it has own values here).
    expect(html).toContain('Use the defaults for this page');
  });

  it('marks gesture switches too', () => {
    const html = renderToStaticMarkup(
      <SettingsPageBody
        page="gestures"
        {...layerProps()}
        renderApp={() => <i />}
        onResetKeys={() => undefined}
      />,
    );
    expect(block(html, 'gestureTwoFingerTap')).toContain('data-layer="own"');
    expect(block(html, 'gestureLongPress')).toContain('data-layer="inherited"');
  });

  it('shows session settings only, every one exactly once across its pages', () => {
    const keys = LAYER_PAGES.flatMap((page) => {
      const html = renderToStaticMarkup(
        <SettingsPageBody
          page={page}
          {...layerProps()}
          renderApp={(id) => <i data-app={id} />}
          onResetKeys={() => undefined}
        />,
      );
      expect(html, page).not.toContain('data-setting-id=');
      expect(html, page).not.toContain('data-app=');
      return [...html.matchAll(/data-setting-key="([^"]+)"/g)].map((m) => m[1] ?? '');
    });
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(SETTING_DESCRIPTORS.map((d) => d.key).sort());
    expect(LAYER_PAGES).not.toContain('general');
    expect(LAYER_PAGES).not.toContain('security');
  });

  it('"Use default" drops that key from the connection', () => {
    const onUseDefault = vi.fn();
    const d = descriptorOf('pointerMode');
    if (!d) throw new Error('no descriptor');
    const button = findElement(
      <SessionSettingBlock d={d} p={layerProps(onUseDefault)} />,
      (el) => (el.props as { 'data-action'?: string })['data-action'] === 'use-default',
    );
    (button?.props as { onClick: () => void }).onClick();
    expect(onUseDefault).toHaveBeenCalledWith(['pointerMode']);
    // What the editor then stores.
    const stored = applyConnectionPatch({ pointerMode: 'trackpad', haptics: false }, {});
    expect(removeConnectionKeys(stored, ['pointerMode'])).toEqual({ haptics: false });
  });

  it('legacy values are not own values: kept by "Reset all", a legacy mute goes with "Use default"', () => {
    const stored = {
      keyBarLayout: [['Tab']],
      customCombos: ['Win+D'],
      audioMuted: true,
      haptics: false,
    };
    // What the session sheet offers "Use the defaults for everything" for.
    expect(overriddenKeys(stored).sort()).toEqual(['audio', 'haptics']);
    const unmuted = removeConnectionKeys(stored, ['audio']);
    expect(effectiveValues(inheritedValues({}), unmuted).audio).toBe('on');
    expect(withoutOwnValues(stored)).toEqual({ keyBarLayout: [['Tab']], customCombos: ['Win+D'] });
  });

  it('"Reset to default" in a layer’s toolbar editor uses the default, not the built-in row', () => {
    const onChange = vi.fn();
    const onReset = vi.fn();
    const sheet = SessionListEditor({
      editor: 'toolbar',
      values: DEFAULT_SESSION_SETTINGS,
      onChange,
      onReset,
      keys: { library: parseAppSettings({}).keys, onLibrary: () => undefined },
      onClose: () => undefined,
    }) as ReactElement<{ onReset: () => void }>;
    sheet.props.onReset();
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    // The app defaults editor has no layer: the built-in row (not stored as a change).
    const plain = SessionListEditor({
      editor: 'toolbar',
      values: DEFAULT_SESSION_SETTINGS,
      onChange,
      keys: { library: parseAppSettings({}).keys, onLibrary: () => undefined },
      onClose: () => undefined,
    }) as ReactElement<{ onReset: () => void }>;
    plain.props.onReset();
    expect(onChange).toHaveBeenCalledWith({ toolbarItems: null });
  });

  it('the app defaults pages are unchanged without a layer (no markers)', () => {
    const html = renderToStaticMarkup(
      <SettingsPageBody
        page="pointer"
        values={DEFAULT_SESSION_SETTINGS}
        changed={new Set()}
        onChange={() => undefined}
        onEditList={() => undefined}
        renderApp={() => <i />}
        onResetKeys={() => undefined}
        below={(k) => (k === 'pointerMode' ? <em data-below="1" /> : null)}
      />,
    );
    expect(html).not.toContain('data-layer=');
    expect(block(html, 'pointerMode')).toContain('data-below="1"');
  });
});

describe('search and the one-time note', () => {
  it('search results name the connections that set a setting themselves', () => {
    const entries = allEntries([buildServerGroup(input(), {})]);
    const results = searchSettings('pointer mode', {
      values: DEFAULT_SESSION_SETTINGS,
      biometryLabel: 'Face ID',
      alsoSetFor: (k) => overrideNames(entries, k) || undefined,
    });
    const mode = results.find((r) => r.ref === 'pointerMode');
    expect(mode?.alsoSetFor).toBe('Office desktop, Tablet');
    expect(results.find((r) => r.ref === 'viewOnly')?.alsoSetFor).toBeUndefined();
    // Without the context, results are as before.
    expect(
      searchSettings('pointer mode', { values: DEFAULT_SESSION_SETTINGS, biometryLabel: 'x' }).find(
        (r) => r.ref === 'pointerMode',
      ),
    ).not.toHaveProperty('alsoSetFor');
  });

  it('"Saved for this connection" is shown once and stays device-local', () => {
    expect(DEFAULT_APP_SETTINGS.perConnectionNoticeSeen).toBe(false);
    expect(parseAppSettings({ perConnectionNoticeSeen: true }).perConnectionNoticeSeen).toBe(true);
    expect(parseAppSettings({ perConnectionNoticeSeen: 'yes' }).perConnectionNoticeSeen).toBe(
      false,
    );
    const seen = { ...DEFAULT_APP_SETTINGS, perConnectionNoticeSeen: true };
    expect(
      settingsRestore(seen, { perConnectionNoticeSeen: false }).settings.perConnectionNoticeSeen,
    ).toBe(true);
    // The default pointer mode stays direct touch.
    expect(DEFAULT_SESSION_SETTINGS.pointerMode).toBe('direct');
  });
});
