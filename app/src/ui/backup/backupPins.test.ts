import { describe, expect, it } from 'vitest';
import { decryptSecrets, parseBackup, planRestore } from '../../core/backup/backup.ts';
import { MemoryKeyValueStore } from '../../core/storage/KeyValueStore.ts';
import { ProfileStore } from '../../core/storage/ProfileStore.ts';
import { MemorySecureStore } from '../../core/storage/SecureStore.ts';
import type { TlsPin } from '../../core/tls/TlsPin.ts';
import type { AppServices } from '../services/AppServices.ts';
import { DEFAULT_APP_SETTINGS } from '../settings/settingsModel.ts';
import { buildBackup } from './backupService.ts';

const ORIGIN = 'https://guac.example.test:8443';
const PIN: TlsPin = {
  origin: ORIGIN,
  sha256: 'ab'.repeat(32),
  subject: 'CN=guac.example.test',
  issuer: 'CN=guac.example.test',
  notBefore: 1,
  notAfter: 2,
  pinnedAt: 3,
};

describe('backup export seals pins (pre-release review R6)', () => {
  it('a pinned server without a saved password keeps its pin through export and restore', async () => {
    const secure = new MemorySecureStore();
    const profiles = new ProfileStore(new MemoryKeyValueStore(), { secureStore: secure });
    await profiles.add({ name: 'Lab', baseUrl: `${ORIGIN}/guacamole`, tlsPin: PIN });
    const services = { profiles, secure } as unknown as AppServices;

    const { file } = await buildBackup(services, DEFAULT_APP_SETTINGS, 'correct horse', 0);
    const parsed = parseBackup(JSON.stringify(file));
    if (!parsed.ok || !parsed.backup.secrets) throw new Error('expected an encrypted part');
    const secrets = await decryptSecrets(parsed.backup.secrets, 'correct horse');

    const dst = new ProfileStore(new MemoryKeyValueStore(), {
      secureStore: new MemorySecureStore(),
    });
    const plan = planRestore([], parsed.backup, 'replace', () => 'fresh', secrets);
    expect(plan.pinsDropped).toBe(0);
    await dst.applyRestore(plan.entries, plan.removeIds);
    expect((await dst.list())[0]?.tlsPin?.sha256).toBe(PIN.sha256);

    // Without the passphrase the same file restores no pin, and says so.
    const blind = planRestore([], parsed.backup, 'replace', () => 'fresh');
    expect(blind.pinsDropped).toBe(1);
  });
});
