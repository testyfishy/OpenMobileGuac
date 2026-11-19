import { describe, expect, it } from 'vitest';
import type { ServerProfile } from '../models/ServerProfile.ts';
import type { ProfileData } from '../storage/ProfileStore.ts';
import {
  BACKUP_FORMAT,
  backupFileName,
  createBackup,
  decryptSecrets,
  encryptSecrets,
  parseBackup,
  planRestore,
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

  it('merge matches by id even when the URL changed', () => {
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
    expect(plan.idMap['a2']).toBe('a2');
    expect(plan.entries.map((e) => e.merge)).toEqual([false, true]);
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
