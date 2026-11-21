import { describe, expect, it } from 'vitest';
import {
  createBackup,
  parseBackup,
  planRestore,
  secretsToRestore,
  type BackupSecrets,
} from '../backup/backup.ts';
import { parseServerProfile } from '../models/ServerProfile.ts';
import type { TlsPin } from '../tls/TlsPin.ts';
import { MemoryKeyValueStore } from './KeyValueStore.ts';
import { ProfileStore } from './ProfileStore.ts';

/**
 * SRV-8 storage rules: a pin is bound to one scheme/host/port, follows the profile only on
 * that origin, and a backup can never add, replace or repoint one in a way that would send a
 * saved password to a certificate the user did not trust for it.
 */

const ORIGIN = 'https://guac.example.test:8443';
const pin = (sha: string, origin = ORIGIN): TlsPin => ({
  origin,
  sha256: sha.repeat(64).slice(0, 64),
  subject: 'CN=guac.example.test',
  issuer: 'CN=guac.example.test',
  notBefore: 1,
  notAfter: 2,
  pinnedAt: 3,
});
const A = pin('a');
const B = pin('b');

function store() {
  let n = 0;
  return new ProfileStore(new MemoryKeyValueStore(), { generateId: () => `id${++n}` });
}

describe('parseServerProfile and pins', () => {
  const base = { id: 'x', name: 'X', baseUrl: `${ORIGIN}/guacamole` };
  it('keeps a valid pin bound to the address', () => {
    expect(parseServerProfile({ ...base, tlsPin: A }).tlsPin).toEqual(A);
  });
  it.each([
    ['another host', pin('a', 'https://evil.example.test:8443')],
    ['another port', pin('a', 'https://guac.example.test:443')],
    ['a bad fingerprint', { ...A, sha256: 'xyz' }],
    ['an origin that is not normalised', { ...A, origin: 'https://GUAC.example.test:8443' }],
    ['not an object', 'aaaa'],
  ])('drops a pin for %s (and keeps the profile)', (_n, bad) => {
    const p = parseServerProfile({ ...base, tlsPin: bad });
    expect(p.tlsPin).toBeUndefined();
    expect(p.id).toBe('x');
  });
  it('never pins an http server', () => {
    const p = parseServerProfile({
      ...base,
      baseUrl: 'http://guac.example.test:8443/guacamole',
      tlsPin: pin('a', 'https://guac.example.test:8443'),
    });
    expect(p.tlsPin).toBeUndefined();
  });
});

describe('ProfileStore pins', () => {
  it('add() keeps only a bound pin', async () => {
    const s = store();
    const ok = await s.add({ name: 'A', baseUrl: `${ORIGIN}/g`, tlsPin: A });
    const bad = await s.add({ name: 'B', baseUrl: 'https://other.example.test/g', tlsPin: A });
    expect((await s.get(ok.id))?.tlsPin).toEqual(A);
    expect((await s.get(bad.id))?.tlsPin).toBeUndefined();
  });

  it('update() keeps the pin for a path change and drops it for another host or port', async () => {
    const s = store();
    const p = await s.add({ name: 'A', baseUrl: `${ORIGIN}/g`, tlsPin: A });
    expect((await s.update(p.id, { baseUrl: `${ORIGIN}/other` })).tlsPin).toEqual(A);
    expect((await s.update(p.id, { name: 'renamed' })).tlsPin).toEqual(A);
    expect(
      (await s.update(p.id, { baseUrl: 'https://guac.example.test/g' })).tlsPin,
    ).toBeUndefined();
    // Moving back does not resurrect it.
    expect((await s.update(p.id, { baseUrl: `${ORIGIN}/g` })).tlsPin).toBeUndefined();
  });

  it('update() ignores a tlsPin smuggled in the patch', async () => {
    const s = store();
    const p = await s.add({ name: 'A', baseUrl: `${ORIGIN}/g` });
    const patch = { name: 'x', tlsPin: A } as unknown as Parameters<ProfileStore['update']>[1];
    expect((await s.update(p.id, patch)).tlsPin).toBeUndefined();
  });

  it('setTlsPinForOrigin() sets and clears every profile at that origin only', async () => {
    const s = store();
    const a = await s.add({ name: 'A', baseUrl: `${ORIGIN}/one` });
    const b = await s.add({ name: 'B', baseUrl: `${ORIGIN}/two` });
    const c = await s.add({ name: 'C', baseUrl: 'https://guac.example.test/one' });
    expect(await s.setTlsPinForOrigin(ORIGIN, A)).toEqual([a.id, b.id]);
    expect((await s.get(c.id))?.tlsPin).toBeUndefined();
    await expect(s.setTlsPinForOrigin('https://guac.example.test:443', A)).rejects.toThrow();
    await s.setTlsPinForOrigin(ORIGIN, undefined);
    expect((await s.get(a.id))?.tlsPin).toBeUndefined();
    expect((await s.get(b.id))?.tlsPin).toBeUndefined();
  });

  it("add() and an address change take the address's existing trust state", async () => {
    const s = store();
    await s.add({ name: 'A', baseUrl: `${ORIGIN}/g`, tlsPin: A });
    // A second profile for the same server shares the pin, and cannot bring another.
    expect((await s.add({ name: 'B', baseUrl: `${ORIGIN}/x` })).tlsPin).toEqual(A);
    expect((await s.add({ name: 'C', baseUrl: `${ORIGIN}/y`, tlsPin: B })).tlsPin).toEqual(A);
    // Moving a profile onto that address inherits the pin; moving away drops it.
    const d = await s.add({ name: 'D', baseUrl: 'https://d.example.test/g' });
    expect((await s.update(d.id, { baseUrl: `${ORIGIN}/d` })).tlsPin).toEqual(A);
    expect((await s.update(d.id, { baseUrl: 'https://d.example.test/g' })).tlsPin).toBeUndefined();
  });

  it('duplicate() keeps the pin (same address)', async () => {
    const s = store();
    const p = await s.add({ name: 'A', baseUrl: `${ORIGIN}/g`, tlsPin: A });
    expect((await s.duplicate(p.id, 'copy')).tlsPin).toEqual(A);
  });
});

describe('backup and restore of pins', () => {
  async function backupOf(s: ProfileStore) {
    return createBackup({ profiles: await s.exportAll(), appVersion: 't', now: 0 });
  }
  const roundTrip = (file: unknown) => {
    const parsed = parseBackup(JSON.stringify(file));
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.backup;
  };

  it('a backup carries the pin and a new server restores it on the same address', async () => {
    const src = store();
    await src.add({ name: 'A', baseUrl: `${ORIGIN}/g`, tlsPin: A });
    const backup = roundTrip(await backupOf(src));
    expect(backup.servers[0]?.tlsPin).toEqual(A);
    const dst = store();
    const plan = planRestore([], backup, 'merge', () => 'fresh');
    await dst.applyRestore(plan.entries, plan.removeIds);
    expect((await dst.list())[0]?.tlsPin).toEqual(A);
  });

  it('an edited address in the backup drops the pin (cannot repoint trust)', async () => {
    const src = store();
    await src.add({ name: 'A', baseUrl: `${ORIGIN}/g`, tlsPin: A });
    const file = JSON.parse(JSON.stringify(await backupOf(src))) as {
      servers: { baseUrl: string }[];
    };
    for (const s of file.servers) s.baseUrl = 'https://evil.example.test:8443/g';
    const backup = roundTrip(file);
    expect(backup.servers[0]?.tlsPin).toBeUndefined();
  });

  it('a merge never adds or replaces the pin of a saved server', async () => {
    const dst = store();
    const saved = await dst.add({ name: 'A', baseUrl: `${ORIGIN}/g`, tlsPin: A });
    const unpinned = await dst.add({ name: 'U', baseUrl: 'https://u.example.test/g' });
    const src = new ProfileStore(new MemoryKeyValueStore(), { generateId: () => saved.id });
    await src.add({ name: 'A', baseUrl: `${ORIGIN}/g`, tlsPin: B });
    const s2 = new ProfileStore(new MemoryKeyValueStore(), { generateId: () => unpinned.id });
    await s2.add({
      name: 'U',
      baseUrl: 'https://u.example.test/g',
      tlsPin: pin('c', 'https://u.example.test:443'),
    });
    const backup = roundTrip(
      createBackup({
        profiles: [...(await src.exportAll()), ...(await s2.exportAll())],
        appVersion: 't',
        now: 0,
      }),
    );
    const plan = planRestore(await dst.list(), backup, 'merge', () => 'fresh');
    expect(plan.updated).toBe(2);
    await dst.applyRestore(plan.entries, plan.removeIds);
    expect((await dst.get(saved.id))?.tlsPin).toEqual(A);
    expect((await dst.get(unpinned.id))?.tlsPin).toBeUndefined();
  });

  it('a new server at a saved address never brings its own pin (merge)', async () => {
    const dst = store();
    const saved = await dst.add({ name: 'A', baseUrl: `${ORIGIN}/g`, username: 'u1', tlsPin: A });
    const bare = await dst.add({ name: 'N', baseUrl: 'https://n.example.test/g' });
    // Same host:port, another path and user: added as a new profile by planRestore.
    const src = new ProfileStore(new MemoryKeyValueStore(), { generateId: () => 'other' });
    await src.add({ name: 'B', baseUrl: `${ORIGIN}/other`, username: 'u2', tlsPin: B });
    const srcN = new ProfileStore(new MemoryKeyValueStore(), { generateId: () => 'otherN' });
    await srcN.add({
      name: 'N2',
      baseUrl: 'https://n.example.test/x',
      tlsPin: pin('c', 'https://n.example.test:443'),
    });
    const backup = roundTrip(
      createBackup({
        profiles: [...(await src.exportAll()), ...(await srcN.exportAll())],
        appVersion: 't',
        now: 0,
      }),
    );
    const plan = planRestore(await dst.list(), backup, 'merge', () => 'fresh');
    expect(plan.added).toBe(2);
    await dst.applyRestore(plan.entries, plan.removeIds);
    for (const p of await dst.list()) {
      if (p.baseUrl.startsWith(ORIGIN)) expect(p.tlsPin, p.name).toEqual(A);
      else expect(p.tlsPin, p.name).toBeUndefined(); // the saved address had no pin
    }
    expect((await dst.get(saved.id))?.tlsPin).toEqual(A);
    expect((await dst.get(bare.id))?.tlsPin).toBeUndefined();
  });

  it('two backup servers at one address with different pins: the first decides (replace)', async () => {
    const one = new ProfileStore(new MemoryKeyValueStore(), { generateId: () => 's1' });
    await one.add({ name: 'A', baseUrl: `${ORIGIN}/a`, tlsPin: A });
    const two = new ProfileStore(new MemoryKeyValueStore(), { generateId: () => 's2' });
    await two.add({ name: 'B', baseUrl: `${ORIGIN}/b`, tlsPin: B });
    const backup = roundTrip(
      createBackup({
        profiles: [...(await one.exportAll()), ...(await two.exportAll())],
        appVersion: 't',
        now: 0,
      }),
    );
    const dst = store();
    await dst.add({ name: 'old', baseUrl: `${ORIGIN}/a`, tlsPin: B });
    const plan = planRestore(await dst.list(), backup, 'replace', () => 'never');
    await dst.applyRestore(plan.entries, plan.removeIds);
    expect((await dst.list()).map((p) => p.tlsPin?.sha256)).toEqual([A.sha256, A.sha256]);
  });

  it('secrets are restored only when the sealed pin matches the plain one', async () => {
    const src = store();
    const p = await src.add({ name: 'A', baseUrl: `${ORIGIN}/g`, tlsPin: A });
    const backup = roundTrip(await backupOf(src));
    const plan = planRestore([], backup, 'merge', () => 'fresh');
    const sealed = (tlsPin?: string): BackupSecrets => ({
      [p.id]: { password: 'pw', baseUrl: `${ORIGIN}/g`, ...(tlsPin ? { tlsPin } : {}) },
    });
    expect(secretsToRestore(plan, backup, sealed(A.sha256))).toHaveLength(1);
    // The plain pin was replaced (e.g. by an attacker's certificate) or not sealed at all.
    expect(secretsToRestore(plan, backup, sealed(B.sha256))).toEqual([]);
    expect(secretsToRestore(plan, backup, sealed())).toEqual([]);
  });

  it('secrets without a pin in the plain part are unaffected', async () => {
    const src = store();
    const p = await src.add({ name: 'A', baseUrl: `${ORIGIN}/g` });
    const backup = roundTrip(await backupOf(src));
    const plan = planRestore([], backup, 'merge', () => 'fresh');
    expect(
      secretsToRestore(plan, backup, { [p.id]: { password: 'pw', baseUrl: `${ORIGIN}/g` } }),
    ).toHaveLength(1);
  });
});
