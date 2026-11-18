import { describe, expect, it } from 'vitest';
import { GuacApiError } from '../core/api/errors.ts';
import { parseConnectionGroup, type ConnectionTree } from '../core/models/Connection.ts';
import { sharedTreeJson, treeJson } from '../core/testing/fixtures.ts';
import {
  isTreeEmpty,
  protocolIcon,
  protocolLabel,
  resolveRefs,
  searchConnections,
} from './connections/treeView.ts';
import { describeError, describeGuacError } from './errors/errorMessages.ts';
import { hasErrors, suggestName, urlUnchanged, validateServerForm } from './servers/serverForm.ts';
import {
  applyConnectionPatch,
  diffFromDefaults,
  mergeSessionSettings,
  parseAppSettings,
  sanitizeSessionPatch,
} from './settings/settingsModel.ts';
import type { SessionSettings } from './integration/session.ts';
import { parseThemePreference, resolveTheme } from './theme/theme.ts';

describe('describeGuacError', () => {
  it('gives each failure kind a distinct message (SRV-2)', () => {
    const infos = [
      { kind: 'unreachable', url: 'u', timedOut: false },
      { kind: 'unreachable', url: 'u', timedOut: true },
      { kind: 'tls', url: 'u' },
      { kind: 'not-guacamole', url: 'u', status: 404 },
      { kind: 'invalid-url', reason: 'invalid' },
      {
        kind: 'invalid-credentials',
        status: 403,
        message: undefined,
        translatableMessage: undefined,
      },
      { kind: 'session-expired', status: 403, message: undefined, translatableMessage: undefined },
      { kind: 'invalid-response', url: 'u', detail: 'x' },
    ] as const;
    const titles = infos.map((i) => describeGuacError(i).title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('mentions the HTTP status for a non-Guacamole answer', () => {
    expect(describeGuacError({ kind: 'not-guacamole', url: 'u', status: 404 }).detail).toMatch(
      /404/,
    );
  });

  it('notes the CORS caveat only in a browser', () => {
    const info = { kind: 'unreachable', url: 'u', timedOut: false } as const;
    expect(describeGuacError(info, { browser: true }).detail).toMatch(/cross-origin/);
    expect(describeGuacError(info).detail).toMatch(/VPN/);
  });

  it('maps BAD_REQUEST during the extra step to a wrong-code message with server text', () => {
    const info = {
      kind: 'server-error',
      type: 'BAD_REQUEST',
      status: 400,
      message: 'Code rejected',
      translatableMessage: undefined,
    } as const;
    expect(describeGuacError(info, { duringAdditionalStep: true })).toMatchObject({
      code: 'wrong-code',
      detail: 'Code rejected',
    });
    expect(describeGuacError(info).code).toBe('server-BAD_REQUEST');
  });

  it('wraps unknown errors without leaking their text', () => {
    expect(describeError(new Error('secret stack')).detail).not.toMatch(/secret/);
    expect(describeError(new GuacApiError({ kind: 'tls', url: 'u' })).code).toBe('tls');
  });
});

describe('server form', () => {
  it('validates name and URL', () => {
    const v = { name: '', url: '', username: '', password: '', rememberPassword: false };
    expect(validateServerForm(v)).toMatchObject({
      name: expect.any(String),
      url: expect.any(String),
    });
    expect(validateServerForm({ ...v, name: 'x', url: 'ftp://guac.example' }).url).toMatch(/http/);
    expect(hasErrors(validateServerForm({ ...v, name: 'x', url: 'guac.example:8080' }))).toBe(
      false,
    );
  });

  it('suggests a name from the host', () => {
    expect(suggestName('guac.example:8080/guacamole/')).toBe('guac.example');
    expect(suggestName('')).toBe('');
  });

  it('detects an unchanged URL', () => {
    expect(urlUnchanged('https://guac.example/guacamole', 'https://guac.example/guacamole')).toBe(
      true,
    );
    expect(urlUnchanged('https://guac.example/guacamole/', 'https://guac.example/guacamole')).toBe(
      true,
    );
    expect(urlUnchanged('guac.example', 'https://guac.example/guacamole')).toBe(false);
  });
});

describe('connection tree view', () => {
  const tree: ConnectionTree = {
    dataSources: [
      { dataSource: 'postgresql', root: parseConnectionGroup(treeJson, 'postgresql') },
      {
        dataSource: 'postgresql-shared',
        root: parseConnectionGroup(sharedTreeJson, 'postgresql-shared'),
      },
    ],
  };

  it('searches names, protocols and group names, case-insensitively, all terms', () => {
    expect(searchConnections(tree, 'desktop').map((m) => m.connection.name)).toEqual([
      'Desktop RDP',
      'Shared desktop',
    ]);
    expect(searchConnections(tree, 'desktop rdp').map((m) => m.connection.name)).toEqual([
      'Desktop RDP',
      'Shared desktop',
    ]);
    expect(searchConnections(tree, 'ssh').map((m) => m.connection.name)).toEqual(['Shell']);
    expect(searchConnections(tree, 'LAB').map((m) => m.connection.name)).toContain('Lab VNC');
    expect(searchConnections(tree, 'lab vnc').map((m) => m.path)).toEqual([['Lab']]);
    expect(searchConnections(tree, 'zzz')).toEqual([]);
    expect(searchConnections(tree, '   ')).toEqual([]);
  });

  it('resolves favourites/recents in order and drops unknown refs', () => {
    const refs = [
      { dataSource: 'postgresql', identifier: '7', type: 'c' },
      { dataSource: 'postgresql', identifier: 'gone', type: 'c' },
      { dataSource: 'postgresql', identifier: '1', type: 'c' },
      { dataSource: 'postgresql', identifier: '7', type: 'c' },
    ] as const;
    expect(resolveRefs(tree, refs).map((m) => m.connection.identifier)).toEqual(['7', '1']);
  });

  it('knows an empty tree', () => {
    expect(isTreeEmpty(tree)).toBe(false);
    expect(
      isTreeEmpty({
        dataSources: [{ dataSource: 'x', root: parseConnectionGroup({ identifier: 'ROOT' }, 'x') }],
      }),
    ).toBe(true);
  });

  it('maps protocols to icons and labels', () => {
    expect(protocolIcon('ssh')).toBe('terminal');
    expect(protocolIcon('RDP')).toBe('monitor');
    expect(protocolLabel('vnc')).toBe('VNC');
    expect(protocolLabel('spice')).toBe('SPICE');
  });
});

describe('settings model', () => {
  const defaults: SessionSettings = {
    fitMode: 'fit-screen',
    pointerMode: 'direct',
    matchDeviceSize: false,
    pointerSpeed: 1,
    naturalScroll: true,
    haptics: true,
    clipboardRemoteToDevice: true,
    clipboardAutoSendOnFocus: false,
    keepAwake: true,
    customCombos: [],
  };

  it('sanitizes stored patches', () => {
    expect(
      sanitizeSessionPatch({
        fitMode: 'stretch',
        pointerMode: 'trackpad',
        pointerSpeed: 99,
        haptics: 'yes',
        keepAwake: false,
        customCombos: ['Ctrl+Alt+Del', 3],
        extra: 1,
      }),
    ).toEqual({ pointerMode: 'trackpad', pointerSpeed: 4, keepAwake: false });
    expect(sanitizeSessionPatch(null)).toEqual({});
  });

  it('merges defaults ← global ← connection', () => {
    const merged = mergeSessionSettings(
      defaults,
      { pointerMode: 'trackpad', fitMode: 'fit-width' },
      { fitMode: 'one-to-one' },
    );
    expect(merged).toMatchObject({ pointerMode: 'trackpad', fitMode: 'one-to-one', haptics: true });
  });

  it('accumulates in-session patches', () => {
    expect(applyConnectionPatch({ fitMode: 'fit-width' }, { pointerMode: 'trackpad' })).toEqual({
      fitMode: 'fit-width',
      pointerMode: 'trackpad',
    });
  });

  it('stores only global fields that differ from the defaults', () => {
    expect(diffFromDefaults(defaults, { ...defaults, haptics: false })).toEqual({ haptics: false });
  });

  it('parses app settings defensively', () => {
    expect(parseAppSettings({ theme: 'dark', sessionDefaults: { haptics: false } })).toEqual({
      theme: 'dark',
      sessionDefaults: { haptics: false },
    });
    expect(parseAppSettings('junk')).toEqual({ theme: 'system', sessionDefaults: {} });
  });

  it('resolves themes', () => {
    expect(parseThemePreference('nope')).toBe('system');
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
  });
});
