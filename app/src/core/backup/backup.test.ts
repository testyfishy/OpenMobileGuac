import { describe, expect, it } from 'vitest';
import type { ServerProfile } from '../models/ServerProfile.ts';
import type { ProfileData } from '../storage/ProfileStore.ts';
import {
  BACKUP_FORMAT,
  backupFileName,
  countUnsealedSecrets,
  createBackup,
  decryptSecrets,
  encryptSecrets,
  parseBackup,
  planRestore,
  secretsToRestore,
  withoutRiskySessionValues,
} from './backup.ts';

const profile = (id: string, over: Partial<ServerProfile> = {}): ServerProfile => ({
  id,
  name: `Server ${id}`,
  baseUrl: 'https://guac.example/guacamole',
  username: 'testuser',
  rememberPassword: true,
  createdAt: 1,
  ...over,
});

const data = (p: ServerProfile): ProfileData => ({
  profile: p,
  favourites: [{ dataSource: 'postgresql', identifier: '1', type: 'c' }],
  recents: [{ ref: { dataSource: 'postgresql', identifier: '1', type: 'c' }, at: 5, name: 'Desk' }],
  connectionSettings: { 'c/postgresql/1': { fitMode: 'fit-width' } },
  options: { ssoMode: 'webview' },
});

describe('backup files', () => {
  it('round-trips and never contains secrets by default', () => {
    const file = createBackup({
      profiles: [data(profile('a'))],
      settings: { theme: 'dark' },
      appVersion: '0.1.0',
      now: Date.UTC(2026, 0, 2),
    });
    const text = JSON.stringify(file);
    expect(text).not.toMatch(/password"|authToken|totpSeed|secrets/);
    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.backup.servers).toEqual(file.servers);
    expect(parsed.backup.settings).toEqual({ theme: 'dark' });
    expect(parsed.backup.exportedAt).toBe('2026-01-02T00:00:00.000Z');
  });

  it('rejects other files and future versions', () => {
    expect(parseBackup('nope')).toEqual({ ok: false, error: 'json' });
    expect(parseBackup('{"format":"other"}')).toEqual({ ok: false, error: 'format' });
    expect(parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 2, servers: [] }))).toEqual(
      {
        ok: false,
        error: 'version',
      },
    );
    expect(parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1 }))).toEqual({
      ok: false,
      error: 'shape',
    });
  });

  it('skips invalid servers and cleans nested data', () => {
    const parsed = parseBackup(
      JSON.stringify({
        format: BACKUP_FORMAT,
        version: 1,
        servers: [
          { id: 'a', name: 'A', baseUrl: 'javascript:alert(1)' },
          {
            id: 'b',
            name: 'B',
            baseUrl: 'http://guac.example:8080/guacamole',
            favourites: [{ x: 1 }, { dataSource: 'd', identifier: 'i', type: 'c' }],
          },
          { id: 'b', name: 'dup', baseUrl: 'http://guac.example' },
        ],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.skipped).toBe(2);
    expect(parsed.backup.servers).toHaveLength(1);
    expect(parsed.backup.servers[0]?.favourites).toEqual([
      { dataSource: 'd', identifier: 'i', type: 'c' },
    ]);
    expect(parsed.backup.servers[0]?.username).toBe('');
  });

  it('names files by date', () => {
    expect(backupFileName(new Date(2026, 10, 18).getTime())).toBe(
      'openmobileguac-backup-2026-11-18.json',
    );
  });
});

describe('planRestore', () => {
  const file = createBackup({
    profiles: [
      data(profile('a')),
      data(profile('b', { baseUrl: 'http://guac.example:8080/guacamole' })),
      data(profile('c', { username: 'other' })),
    ],
    appVersion: '0',
    now: 0,
  });

  it('merge matches by id, then by URL and username, and adds the rest', () => {
    const existing = [
      profile('a', { name: 'renamed' }),
      profile('x', { baseUrl: 'http://guac.example:8080/guacamole' }),
      profile('y', { baseUrl: 'https://other.example' }),
    ];
    let n = 0;
    const plan = planRestore(existing, file, 'merge', () => `gen${++n}`);
    expect(plan.idMap).toEqual({ a: 'a', b: 'x', c: 'c' });
    expect(plan.entries.map((e) => [e.targetId, e.merge])).toEqual([
      ['a', true],
      ['x', true],
      ['c', false],
    ]);
    expect([plan.added, plan.updated, plan.removed]).toEqual([1, 2, 0]);
  });

  it('merge never maps a backup server onto a saved one at another address (AUDIT #1)', () => {
    const dupFile = createBackup({
      profiles: [
        data(profile('a')),
        data(profile('a2', { baseUrl: 'https://guac.example/guacamole' })),
      ],
      appVersion: '0',
      now: 0,
    });
    const plan = planRestore(
      [profile('a2', { baseUrl: 'https://x.example' })],
      dupFile,
      'merge',
      () => 'gen',
    );
    // Same id, different host: added under a fresh id, so the saved server (and its
    // secrets) is untouched and nothing saved for x.example is ever sent to guac.example.
    expect(plan.idMap['a2']).toBe('gen');
    expect(plan.entries.map((e) => [e.targetId, e.merge])).toEqual([
      ['a', false],
      ['gen', false],
    ]);
    expect(plan.addressChanged).toBe(1);
    expect(plan.updated).toBe(0);
  });

  it.each([
    ['scheme', 'http://guac.example/guacamole'],
    ['port', 'https://guac.example:8443/guacamole'],
    ['path', 'https://guac.example/other'],
    ['host', 'https://evil.example/guacamole'],
  ])('a changed %s counts as a different server', (_label, baseUrl) => {
    const f = createBackup({
      profiles: [data(profile('a', { baseUrl }))],
      appVersion: '0',
      now: 0,
    });
    const plan = planRestore([profile('a')], f, 'merge', () => 'fresh');
    expect(plan.entries[0]?.targetId).toBe('fresh');
    expect(plan.addressChanged).toBe(1);
  });

  it('a cosmetic difference (trailing slash, host case) is still the same server', () => {
    const f = createBackup({
      profiles: [data(profile('a', { baseUrl: 'https://GUAC.example/guacamole/' }))],
      appVersion: '0',
      now: 0,
    });
    const plan = planRestore([profile('a')], f, 'merge', () => 'fresh');
    expect(plan.entries[0]).toMatchObject({ targetId: 'a', merge: true });
    expect(plan.addressChanged).toBe(0);
  });

  it('replace removes everything and keeps backup ids', () => {
    const plan = planRestore([profile('z')], file, 'replace', () => 'never');
    expect(plan.removeIds).toEqual(['z']);
    expect(plan.entries.map((e) => e.targetId)).toEqual(['a', 'b', 'c']);
    expect(plan.removed).toBe(1);
  });
});

describe('encrypted secrets', () => {
  it('round-trips with the right passphrase and fails with a wrong one', async () => {
    const blob = await encryptSecrets(
      { a: { password: 'not-a-real-password', totpSeed: 'otpauth://totp/x?secret=AAAA' } },
      'correct horse',
      {
        iterations: 10_000,
      },
    );
    expect(JSON.stringify(blob)).not.toContain('not-a-real-password');
    expect(await decryptSecrets(blob, 'correct horse')).toEqual({
      a: { password: 'not-a-real-password', totpSeed: 'otpauth://totp/x?secret=AAAA' },
    });
    await expect(decryptSecrets(blob, 'wrong')).rejects.toThrow('bad-passphrase');
    // Survives the file round trip.
    const file = createBackup({ profiles: [], appVersion: '0', now: 0, secrets: blob });
    const parsed = parseBackup(JSON.stringify(file));
    expect(parsed.ok && parsed.backup.secrets).toEqual(blob);
  });
});

describe('secretsToRestore (AUDIT #1: secrets never follow a changed address)', () => {
  const backup = createBackup({
    profiles: [
      data(profile('a')),
      data(profile('b', { baseUrl: 'https://b.example/guacamole' })),
      data(profile('c', { baseUrl: 'https://evil.example/guacamole' })),
    ],
    appVersion: '0',
    now: 0,
  });
  const existing = [
    profile('a'),
    profile('b', { baseUrl: 'https://old-b.example/guacamole' }),
    profile('c', { baseUrl: 'https://c.example/guacamole' }),
  ];
  let gen = 0;
  const plan = planRestore(existing, backup, 'merge', () => `fresh${++gen}`);

  it('skips servers whose address changed and secrets sealed for another address', () => {
    const out = secretsToRestore(plan, backup, {
      a: { password: 'pa', baseUrl: 'https://guac.example/guacamole' },
      b: { password: 'pb', baseUrl: 'https://b.example/guacamole' },
      // The plain file says evil.example, the sealed address says c.example: edited file.
      c: { password: 'pc', baseUrl: 'https://c.example/guacamole' },
    });
    expect(out).toEqual([{ id: 'a', password: 'pa' }]);
    expect(plan.addressChangedIds).toEqual(['b', 'c']);
  });

  it('a fresh server from a backup gets its own sealed secrets', () => {
    const p = planRestore([], backup, 'merge', () => 'never');
    const out = secretsToRestore(p, backup, {
      c: { totpSeed: 'otpauth://totp/x?secret=AAAA', baseUrl: 'https://c.example/guacamole' },
      b: { password: 'pb', baseUrl: 'https://b.example/guacamole' },
    });
    expect(out).toEqual([{ id: 'b', password: 'pb' }]);
  });
});

describe('pre-release review R7: secrets need a sealed address', () => {
  const backup = createBackup({ profiles: [data(profile('a'))], appVersion: '0', now: 0 });
  const plan = planRestore([], backup, 'merge', () => 'never');

  it('releases nothing for an entry without a sealed baseUrl, and counts it', () => {
    const secrets = { a: { password: 'pa', totpSeed: 'otpauth://totp/x?secret=AAAA' } };
    expect(secretsToRestore(plan, backup, secrets)).toEqual([]);
    expect(countUnsealedSecrets(secrets)).toBe(1);
    // Pin-only entries (no password, no seed) are neither restored nor counted.
    expect(countUnsealedSecrets({ a: { tlsPin: 'ab' } })).toBe(0);
    expect(
      secretsToRestore(plan, backup, { a: { baseUrl: 'https://guac.example/guacamole' } }),
    ).toEqual([]);
  });
});

describe('pre-release review R6: security settings are not restored', () => {
  const risky: ProfileData = {
    ...data(profile('a')),
    connectionSettings: {
      'c/postgresql/1': { fitMode: 'fit-width', remoteFiles: 'accept', microphone: true },
      'c/postgresql/2': { remoteFiles: 'decline', microphone: false },
    },
    options: {
      ssoMode: 'webview',
      confirmLinks: false,
      sessionDefaults: { microphone: true, remoteFiles: 'accept', fitMode: 'fit' },
    },
  };
  const backup = createBackup({ profiles: [risky], appVersion: '0', now: 0 });

  it('drops accept-all files, the microphone and confirmLinks: false at every level', () => {
    for (const mode of ['merge', 'replace'] as const) {
      const plan = planRestore([], backup, mode, () => 'never');
      expect(plan.securityReset).toBe(1);
      const d = plan.entries[0]?.data;
      expect(d?.connectionSettings).toEqual({
        'c/postgresql/1': { fitMode: 'fit-width' },
        'c/postgresql/2': { remoteFiles: 'decline', microphone: false },
      });
      expect(d?.options).toEqual({ ssoMode: 'webview', sessionDefaults: { fitMode: 'fit' } });
    }
  });

  it('leaves safe values alone and reports nothing', () => {
    const safe = createBackup({ profiles: [data(profile('a'))], appVersion: '0', now: 0 });
    const plan = planRestore([], safe, 'merge', () => 'never');
    expect(plan.securityReset).toBe(0);
    expect(plan.entries[0]?.data.options).toEqual({ ssoMode: 'webview' });
    expect(withoutRiskySessionValues({ microphone: false })).toEqual({
      value: { microphone: false },
      changed: false,
    });
  });
});
