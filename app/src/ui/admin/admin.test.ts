import { describe, expect, it } from 'vitest';
import {
  parsePermissionSet,
  type PermissionSet,
  type SchemaForm,
} from '../../core/models/Admin.ts';
import { parseConnectionGroup, type ConnectionTree } from '../../core/models/Connection.ts';
import {
  canMoveGroupTo,
  countContents,
  findGroup,
  folderOptions,
  folderPath,
} from './folderTree.ts';
import {
  buildSections,
  compact,
  fieldKind,
  filterSections,
  unknownParameters,
  valuesDiffer,
  withValue,
} from './formModel.ts';
import {
  canonicalize,
  deriveLabel,
  fieldLabel,
  lookup,
  optionLabel,
  protocolName,
  protocolNamespace,
  sectionLabel,
} from './labels.ts';
import {
  canCloneConnection,
  canCreateConnection,
  canCreateGroup,
  canDeleteConnection,
  canDeleteGroup,
  canEditConnection,
  canEditGroup,
  canKill,
  canManage,
  canManageGroup,
  canPlaceIn,
  withoutRootUpdate,
} from './permissions.ts';
import {
  applyChanges,
  matchingPreset,
  presetChanges,
  presetValues,
  quickFields,
} from './presets.ts';
import {
  cloneName,
  isValidParameterName,
  validateConnection,
  validateGroup,
} from './validation.ts';

const perms = (raw: object): PermissionSet => withoutRootUpdate(parsePermissionSet(raw));

/** A slice of the 1.6.0 RDP schema (guacamole-ext protocols/rdp.json). */
const rdpForms: SchemaForm[] = [
  {
    name: 'network',
    fields: [
      { name: 'hostname', type: 'TEXT', options: [] },
      { name: 'port', type: 'NUMERIC', options: [] },
    ],
  },
  {
    name: 'authentication',
    fields: [
      { name: 'username', type: 'USERNAME', options: [] },
      { name: 'password', type: 'PASSWORD', options: [] },
      { name: 'security', type: 'ENUM', options: ['', 'rdp', 'tls', 'nla', 'vmconnect', 'any'] },
      { name: 'ignore-cert', type: 'BOOLEAN', options: ['true'] },
    ],
  },
  {
    name: 'display',
    fields: [
      { name: 'color-depth', type: 'ENUM', options: ['', '8', '16', '24', '32'] },
      { name: 'force-lossless', type: 'BOOLEAN', options: ['true'] },
      { name: 'resize-method', type: 'ENUM', options: ['', 'reconnect', 'display-update'] },
    ],
  },
  {
    name: 'device-redirection',
    fields: [{ name: 'disable-audio', type: 'BOOLEAN', options: ['true'] }],
  },
  {
    name: 'performance',
    fields: [
      'enable-wallpaper',
      'enable-theming',
      'enable-font-smoothing',
      'enable-full-window-drag',
      'enable-desktop-composition',
      'enable-menu-animations',
      'disable-bitmap-caching',
      'disable-offscreen-caching',
      'disable-glyph-caching',
      'disable-gfx',
    ].map((name) => ({ name, type: 'BOOLEAN', options: ['true'] })),
  },
];
const rdpNames = new Set(rdpForms.flatMap((f) => f.fields.map((x) => x.name)));
const attrForms: SchemaForm[] = [
  { name: 'concurrency', fields: [{ name: 'max-connections', type: 'NUMERIC', options: [] }] },
];

describe('labels', () => {
  it('canonicalises like upstream translationStringService', () => {
    expect(canonicalize('color-depth')).toBe('COLOR_DEPTH');
    expect(canonicalize('rdp')).toBe('RDP');
    expect(canonicalize('a--b.c')).toBe('A_B_C');
    expect(protocolNamespace('rdp')).toBe('PROTOCOL_RDP');
  });

  it('derives readable labels from parameter names', () => {
    expect(deriveLabel('enable-wallpaper')).toBe('Enable wallpaper');
    expect(deriveLabel('sftp-host-key')).toBe('SFTP host key');
    expect(deriveLabel('max-connections-per-user')).toBe('Max connections per user');
    expect(deriveLabel('dpi')).toBe('DPI');
    expect(deriveLabel('guacd-hostname')).toBe('guacd hostname');
    expect(deriveLabel('wol-mac-addr')).toBe('WoL MAC addr');
  });

  it('uses server translations, strips colons and follows @: links', () => {
    const table = {
      APP: { HOST: 'Hostname:' },
      PROTOCOL_RDP: {
        NAME: 'RDP',
        FIELD_HEADER_HOSTNAME: '@:APP.HOST',
        FIELD_HEADER_PORT: 'Port:',
        FIELD_OPTION_COLOR_DEPTH_16: 'Low color (16-bit)',
        FIELD_OPTION_COLOR_DEPTH_EMPTY: '',
        SECTION_HEADER_NETWORK: 'Network',
        LOOP: '@:PROTOCOL_RDP.LOOP',
      },
    };
    expect(fieldLabel('PROTOCOL_RDP', 'hostname', table)).toBe('Hostname');
    expect(fieldLabel('PROTOCOL_RDP', 'port', table)).toBe('Port');
    expect(fieldLabel('PROTOCOL_RDP', 'enable-wallpaper', table)).toBe('Enable wallpaper');
    expect(optionLabel('PROTOCOL_RDP', 'color-depth', '16', 'Default', table)).toBe(
      'Low color (16-bit)',
    );
    expect(optionLabel('PROTOCOL_RDP', 'color-depth', '', 'Default', table)).toBe('Default');
    expect(optionLabel('PROTOCOL_RDP', 'color-depth', '24', 'Default', table)).toBe('24');
    expect(sectionLabel('PROTOCOL_RDP', 'network', table)).toBe('Network');
    expect(sectionLabel('PROTOCOL_RDP', 'device-redirection', null)).toBe('Device redirection');
    expect(protocolName('rdp', table)).toBe('RDP');
    expect(protocolName('kubernetes', null)).toBe('KUBERNETES');
    expect(lookup(table, 'PROTOCOL_RDP.LOOP')).toBeUndefined();
    expect(lookup(table, 'NOPE.KEY')).toBeUndefined();
  });
});

describe('schema → form model', () => {
  it('maps field types to controls', () => {
    expect(fieldKind('BOOLEAN')).toBe('boolean');
    expect(fieldKind('ENUM')).toBe('enum');
    expect(fieldKind('NUMERIC')).toBe('number');
    expect(fieldKind('PASSWORD')).toBe('password');
    expect(fieldKind('MULTILINE')).toBe('multiline');
    expect(fieldKind('TERMINAL_COLOR_SCHEME')).toBe('colorscheme');
    expect(fieldKind('SOME_EXTENSION_TYPE')).toBe('text');
  });

  it('builds labelled sections with options and the BOOLEAN truth value', () => {
    const sections = buildSections(rdpForms, 'PROTOCOL_RDP', 'Default', null);
    expect(sections.map((s) => s.label)).toEqual([
      'Network',
      'Authentication',
      'Display',
      'Device redirection',
      'Performance',
    ]);
    const security = sections[1]?.fields[2];
    expect(security?.kind).toBe('enum');
    expect(security?.options[0]).toEqual({ value: '', label: 'Default' });
    expect(sections[1]?.fields[3]?.truthValue).toBe('true');
  });

  it('searches by label or parameter name, case- and accent-insensitively', () => {
    const sections = buildSections(rdpForms, 'PROTOCOL_RDP', 'Default', null);
    const hit = filterSections(sections, 'WALLPAPER');
    expect(hit).toHaveLength(1);
    expect(hit[0]?.fields.map((f) => f.name)).toEqual(['enable-wallpaper']);
    expect(filterSections(sections, 'color-depth')[0]?.fields.map((f) => f.name)).toEqual([
      'color-depth',
    ]);
    // A section label match keeps the whole section.
    expect(filterSections(sections, 'network')[0]?.fields).toHaveLength(2);
    expect(filterSections(sections, 'zzz')).toEqual([]);
    expect(filterSections(sections, '  ')).toHaveLength(5);
  });

  it('treats absent and empty as the same "unset" value', () => {
    expect(valuesDiffer({ a: '' }, {})).toBe(false);
    expect(valuesDiffer({ a: '1' }, {})).toBe(true);
    expect(withValue({ a: '1', b: '2' }, 'a', '')).toEqual({ b: '2' });
    expect(compact({ a: '', b: 'x' })).toEqual({ b: 'x' });
  });

  it('lists parameters the schema does not describe', () => {
    expect(unknownParameters(rdpForms, { hostname: 'h', 'future-option': 'x', aaa: '1' })).toEqual([
      'aaa',
      'future-option',
    ]);
  });
});

describe('presets', () => {
  it('lists exactly the parameters that change', () => {
    const values = { 'color-depth': '32', 'enable-wallpaper': 'true', 'enable-theming': 'true' };
    const changes = presetChanges('rdp', 'low', values, rdpNames);
    expect(changes).toEqual([
      { name: 'color-depth', from: '32', to: '16' },
      { name: 'disable-gfx', from: '', to: 'true' },
      { name: 'resize-method', from: '', to: 'display-update' },
      { name: 'enable-wallpaper', from: 'true', to: '' },
      { name: 'enable-theming', from: 'true', to: '' },
      { name: 'disable-audio', from: '', to: 'true' },
    ]);
    const after = applyChanges(values, changes);
    expect(after).toEqual({
      'color-depth': '16',
      'disable-gfx': 'true',
      'resize-method': 'display-update',
      'disable-audio': 'true',
    });
    expect(presetChanges('rdp', 'low', after, rdpNames)).toEqual([]);
    expect(matchingPreset('rdp', after, rdpNames)).toBe('low');
    expect(matchingPreset('rdp', values, rdpNames)).toBeUndefined();
  });

  it('never sets a name the server schema lacks', () => {
    const known = new Set(['color-depth']);
    expect(presetChanges('rdp', 'best', {}, known).map((c) => c.name)).toEqual(['color-depth']);
    expect(quickFields('rdp', known)).toEqual(['color-depth']);
  });

  it('uses only parameter names that exist in the 1.6.0 RDP and VNC definitions', () => {
    const vncNames = new Set([
      'color-depth',
      'force-lossless',
      'compress-level',
      'quality-level',
      'cursor',
      'enable-audio',
    ]);
    for (const p of ['best', 'balanced', 'low'] as const) {
      for (const n of Object.keys(presetValues('rdp', p))) expect(rdpNames.has(n), n).toBe(true);
      for (const n of Object.keys(presetValues('vnc', p))) expect(vncNames.has(n), n).toBe(true);
    }
    // RDP 1.6.0 has disable-audio, not enable-audio.
    expect(Object.keys(presetValues('rdp', 'low'))).not.toContain('enable-audio');
    expect(presetChanges('ssh', 'low', {})).toEqual([]);
  });
});

describe('validation', () => {
  const ok = { name: 'PC', protocol: 'rdp', parameters: { hostname: 'h' }, attributes: {} };

  it('requires name, protocol and (for RDP) a hostname', () => {
    expect(validateConnection(ok, rdpForms, attrForms).ok).toBe(true);
    const r = validateConnection(
      { name: ' ', protocol: '', parameters: {}, attributes: {} },
      rdpForms,
      attrForms,
    );
    expect(r.errors).toEqual({ name: 'required', protocol: 'required' });
    expect(
      validateConnection({ ...ok, parameters: { hostname: '  ' } }, rdpForms, attrForms).errors,
    ).toEqual({ 'param:hostname': 'required' });
    // A protocol whose schema has no hostname field does not need one.
    expect(validateConnection({ ...ok, protocol: 'custom', parameters: {} }, [], []).ok).toBe(true);
  });

  it('checks NUMERIC parameters and attributes', () => {
    const r = validateConnection(
      {
        ...ok,
        parameters: { hostname: 'h', port: '33a' },
        attributes: { 'max-connections': '1.5' },
      },
      rdpForms,
      attrForms,
    );
    expect(r.errors).toEqual({ 'param:port': 'number', 'attr:max-connections': 'number' });
    expect(
      validateConnection({ ...ok, parameters: { hostname: 'h', port: '-1' } }, rdpForms, []).ok,
    ).toBe(true);
  });

  it('validates folders and parameter names, and makes unique clone names', () => {
    expect(validateGroup({ name: '', attributes: {} }, attrForms).errors).toEqual({
      name: 'required',
    });
    expect(isValidParameterName('disable-gfx')).toBe(true);
    expect(isValidParameterName('has space')).toBe(false);
    expect(isValidParameterName('')).toBe(false);
    const copy = (n: string) => `Copy of ${n}`;
    expect(cloneName('PC', copy, ['PC'])).toBe('Copy of PC');
    expect(cloneName('PC', copy, ['PC', 'copy of pc', 'Copy of PC (2)'])).toBe('Copy of PC (3)');
  });
});

describe('permission gating', () => {
  const admin = perms({ systemPermissions: ['ADMINISTER'] });
  const editor = perms({
    systemPermissions: ['CREATE_CONNECTION'],
    connectionPermissions: { '1': ['READ', 'UPDATE', 'DELETE'], '2': ['READ'] },
    connectionGroupPermissions: {
      ROOT: ['READ', 'UPDATE'],
      '5': ['READ', 'UPDATE'],
      '6': ['READ'],
    },
    activeConnectionPermissions: { a1: ['DELETE'] },
  });
  const viewer = perms({
    connectionPermissions: { '1': ['READ'] },
    connectionGroupPermissions: { ROOT: ['READ', 'UPDATE'] },
  });

  it('offers management only where something is granted (UPDATE on ROOT ignored)', () => {
    expect(canManage(admin)).toBe(true);
    expect(canManage(editor)).toBe(true);
    expect(canManage(viewer)).toBe(false);
  });

  it('gates creation by system permissions', () => {
    expect(canCreateConnection(admin) && canCreateGroup(admin)).toBe(true);
    expect(canCreateConnection(editor)).toBe(true);
    expect(canCreateGroup(editor)).toBe(false);
    expect(canCreateConnection(viewer)).toBe(false);
  });

  it('gates each connection by its own permissions', () => {
    expect(canEditConnection(editor, '1')).toBe(true);
    expect(canDeleteConnection(editor, '1')).toBe(true);
    expect(canCloneConnection(editor, '1')).toBe(true);
    expect(canEditConnection(editor, '2')).toBe(false);
    expect(canCloneConnection(editor, '2')).toBe(false); // parameters need UPDATE
    expect(canEditConnection(admin, 'anything')).toBe(true);
    expect(canDeleteConnection(viewer, '1')).toBe(false);
  });

  it('gates groups, placement and disconnects', () => {
    expect(canEditGroup(admin, 'ROOT')).toBe(false);
    expect(canDeleteGroup(admin, 'ROOT')).toBe(false);
    expect(canEditGroup(editor, '5')).toBe(true);
    expect(canDeleteGroup(editor, '5')).toBe(false);
    expect(canPlaceIn(editor, 'ROOT')).toBe(true);
    expect(canPlaceIn(editor, '5')).toBe(true);
    expect(canPlaceIn(editor, '6')).toBe(false);
    expect(canManageGroup(editor, '6')).toBe(false);
    expect(canManageGroup(editor, '5')).toBe(true);
    expect(canKill(editor, 'a1')).toBe(true);
    expect(canKill(editor, 'a2')).toBe(false);
    expect(canKill(admin, 'a2')).toBe(true);
  });
});

describe('folder picker', () => {
  const root = parseConnectionGroup(
    {
      identifier: 'ROOT',
      type: 'ORGANIZATIONAL',
      childConnections: [{ identifier: 'c0', name: 'Top', protocol: 'rdp' }],
      childConnectionGroups: [
        {
          identifier: '5',
          parentIdentifier: 'ROOT',
          name: 'Servers',
          type: 'ORGANIZATIONAL',
          childConnections: [{ identifier: 'c1', name: 'A', protocol: 'ssh' }],
          childConnectionGroups: [
            {
              identifier: '7',
              parentIdentifier: '5',
              name: 'Linux',
              type: 'ORGANIZATIONAL',
              childConnections: [{ identifier: 'c2', name: 'B', protocol: 'ssh' }],
              childConnectionGroups: [
                { identifier: '9', parentIdentifier: '7', name: 'Deep', type: 'ORGANIZATIONAL' },
              ],
            },
          ],
        },
        { identifier: '6', parentIdentifier: 'ROOT', name: 'Lab', type: 'BALANCING' },
      ],
    },
    'postgresql',
  );
  const tree: ConnectionTree = { dataSources: [{ dataSource: 'postgresql', root }] };
  const admin = perms({ systemPermissions: ['ADMINISTER'] });

  it('lists every folder depth first with the top level first', () => {
    const opts = folderOptions(tree, 'postgresql', admin);
    expect(opts.map((o) => [o.identifier, o.depth])).toEqual([
      ['ROOT', 0],
      ['5', 1],
      ['7', 2],
      ['9', 3],
      ['6', 1],
    ]);
    expect(opts.every((o) => !o.disabled)).toBe(true);
    expect(folderPath(tree, 'postgresql', '9')).toEqual(['Servers', 'Linux', 'Deep']);
    expect(folderPath(tree, 'postgresql', 'ROOT')).toEqual([]);
  });

  it('cannot move a folder into itself or a descendant', () => {
    const opts = folderOptions(tree, 'postgresql', admin, '5');
    const byId = new Map(opts.map((o) => [o.identifier, o]));
    expect(byId.get('5')?.reason).toBe('self');
    expect(byId.get('7')?.reason).toBe('descendant');
    expect(byId.get('9')?.reason).toBe('descendant');
    expect(byId.get('6')?.disabled).toBe(false);
    expect(byId.get('ROOT')?.disabled).toBe(false);
    expect(canMoveGroupTo(tree, 'postgresql', '5', '9')).toBe(false);
    expect(canMoveGroupTo(tree, 'postgresql', '7', '6')).toBe(true);
  });

  it('disables folders the account cannot add to', () => {
    const editor = perms({
      systemPermissions: ['CREATE_CONNECTION'],
      connectionGroupPermissions: { '7': ['UPDATE'] },
    });
    const opts = folderOptions(tree, 'postgresql', editor);
    expect(opts.filter((o) => !o.disabled).map((o) => o.identifier)).toEqual(['ROOT', '7']);
    expect(opts.find((o) => o.identifier === '5')?.reason).toBe('no-permission');
  });

  it('counts what a folder delete takes with it', () => {
    const g = findGroup(tree, 'postgresql', '5');
    expect(g && countContents(g)).toEqual({ connections: 2, groups: 2 });
    expect(findGroup(tree, 'postgresql', 'ROOT')?.identifier).toBe('ROOT');
    expect(findGroup(tree, 'other', '5')).toBeUndefined();
  });
});
