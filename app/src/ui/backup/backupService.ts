import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { createBackup, encryptSecrets, type BackupFile } from '../../core/backup/backup.ts';
import {
  autoBackupFileName,
  backupsToPrune,
  isAutoBackupName,
  isBackupDue,
  sortBackups,
  type StoredBackup,
} from '../../core/backup/schedule.ts';
import type { KeyValueStore } from '../../core/storage/KeyValueStore.ts';
import type { JsonValue } from '../../core/storage/ProfileStore.ts';
import { secretKeys } from '../../core/storage/SecureStore.ts';
import type { AppServices } from '../services/AppServices.ts';
import type { AppSettings } from '../settings/settingsModel.ts';
import { strings } from '../strings.ts';

/**
 * Building backups (manual and automatic), the on-device store of automatic backups and the
 * "run when due" check (SRV-10).
 *
 * Automatic backups never contain secrets unless the user set a backup passphrase (kept
 * only in the secure store). With the app lock on, secrets are read only right after an
 * unlock (opening the app unlocks it); an automatic run never shows a prompt by itself and
 * otherwise saves the backup without secrets.
 */

/** Secure-store key of the backup passphrase. */
export const BACKUP_PASSPHRASE_KEY = 'app/backupPassphrase';
/** Non-secret store key of the automatic backup state (device-specific, never exported). */
const AUTO_STATE_KEY = 'backup/autoState';
const WEB_PREFIX = 'backup/files/';
const DIR = 'backups';

export interface AutoBackupState {
  readonly lastAt: number | null;
  readonly lastError?: string;
}

export async function loadAutoState(kv: KeyValueStore): Promise<AutoBackupState> {
  try {
    const raw = await kv.get(AUTO_STATE_KEY);
    const v = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const lastAt =
      typeof v['lastAt'] === 'number' && Number.isFinite(v['lastAt']) ? v['lastAt'] : null;
    return {
      lastAt,
      ...(typeof v['lastError'] === 'string' ? { lastError: v['lastError'] } : {}),
    };
  } catch {
    return { lastAt: null };
  }
}

async function saveAutoState(kv: KeyValueStore, s: AutoBackupState): Promise<void> {
  await kv.set(AUTO_STATE_KEY, JSON.stringify(s)).catch(() => undefined);
}

export async function loadBackupPassphrase(services: AppServices): Promise<string | null> {
  return services.secure.get(BACKUP_PASSPHRASE_KEY).catch(() => null);
}

export async function setBackupPassphrase(
  services: AppServices,
  passphrase: string | null,
): Promise<void> {
  if (passphrase) await services.secure.set(BACKUP_PASSPHRASE_KEY, passphrase);
  else await services.secure.remove(BACKUP_PASSPHRASE_KEY).catch(() => undefined);
}

/** Settings as they go into a backup: without the device-specific parts. */
export function portableSettings(settings: AppSettings): Record<string, JsonValue> {
  const { lock: _lock, onboardingDone: _seen, ...portable } = settings;
  void _lock;
  void _seen;
  return JSON.parse(JSON.stringify(portable)) as Record<string, JsonValue>;
}

/**
 * One backup file. With `passphrase`, saved passwords and TOTP seeds are added, encrypted.
 * The caller decides whether reading secrets is allowed (the unlock gate).
 */
export async function buildBackup(
  services: AppServices,
  settings: AppSettings,
  passphrase: string | null,
  now: number,
): Promise<{ file: BackupFile; servers: number; secrets: boolean }> {
  const profiles = await services.profiles.exportAll();
  let secrets;
  if (passphrase) {
    const plain: Record<
      string,
      { password?: string; totpSeed?: string; baseUrl?: string; tlsPin?: string }
    > = {};
    for (const p of profiles) {
      const id = p.profile.id;
      const password = await services.secure.get(secretKeys.password(id)).catch(() => null);
      const totpSeed = await services.secure.get(secretKeys.totpSeed(id)).catch(() => null);
      if (password || totpSeed) {
        // The address goes inside the encrypted part too, so an edited plain `baseUrl`
        // cannot carry these secrets to another host (AUDIT #1).
        plain[id] = {
          ...(password ? { password } : {}),
          ...(totpSeed ? { totpSeed } : {}),
          baseUrl: p.profile.baseUrl,
          // SRV-8: likewise the trusted certificate, so an edited plain pin cannot either.
          ...(p.profile.tlsPin ? { tlsPin: p.profile.tlsPin.sha256 } : {}),
        };
      }
    }
    secrets = await encryptSecrets(plain, passphrase);
  }
  const file = createBackup({
    profiles,
    settings: portableSettings(settings),
    appVersion: __APP_VERSION__,
    now,
    ...(secrets ? { secrets } : {}),
  });
  return { file, servers: profiles.length, secrets: secrets !== undefined };
}

// ---- The on-device store of automatic backups ------------------------------------------

export interface BackupVault {
  /** Where the files are kept, for the UI. */
  readonly where: 'device' | 'browser';
  list(): Promise<StoredBackup[]>;
  read(name: string): Promise<string>;
  write(name: string, text: string): Promise<void>;
  remove(name: string): Promise<void>;
}

/**
 * Where automatic backups live on native. Not `Directory.Data`: on iOS that is the
 * Documents folder, which the Files app shows (the app shares it for downloads), and a
 * backup lists server addresses and user names. Library is app-private on both platforms.
 */
const VAULT_DIR = Directory.Library;

/** iOS, once per launch: move backups written by older versions out of Documents. */
let migrated: Promise<void> | null = null;
function migrateOldBackups(): Promise<void> {
  if (Capacitor.getPlatform() !== 'ios') return Promise.resolve();
  migrated ??= (async () => {
    try {
      const old = await Filesystem.readdir({ path: DIR, directory: Directory.Data });
      for (const file of old.files) {
        if (file.type === 'directory' || !isAutoBackupName(file.name)) continue;
        const path = `${DIR}/${file.name}`;
        const r = await Filesystem.readFile({
          path,
          directory: Directory.Data,
          encoding: Encoding.UTF8,
        });
        await Filesystem.writeFile({
          path,
          data: typeof r.data === 'string' ? r.data : await r.data.text(),
          directory: VAULT_DIR,
          encoding: Encoding.UTF8,
          recursive: true,
        });
        await Filesystem.deleteFile({ path, directory: Directory.Data });
      }
      await Filesystem.rmdir({ path: DIR, directory: Directory.Data }).catch(() => undefined);
    } catch {
      // No old folder, or a file that could not be moved: try again next launch.
    }
  })();
  return migrated;
}

/** App-private storage (Library/backups) on native, the KV store on web. */
export function createBackupVault(kv: KeyValueStore): BackupVault {
  if (!Capacitor.isNativePlatform()) return kvVault(kv);
  return {
    where: 'device',
    async list() {
      await migrateOldBackups();
      try {
        const r = await Filesystem.readdir({ path: DIR, directory: VAULT_DIR });
        return r.files
          .filter((f) => f.type !== 'directory' && isAutoBackupName(f.name))
          .map((f) => ({ name: f.name, ...(f.mtime ? { at: Number(f.mtime) } : {}) }));
      } catch {
        return [];
      }
    },
    async read(name) {
      await migrateOldBackups();
      const r = await Filesystem.readFile({
        path: `${DIR}/${name}`,
        directory: VAULT_DIR,
        encoding: Encoding.UTF8,
      });
      return typeof r.data === 'string' ? r.data : await r.data.text();
    },
    async write(name, text) {
      await migrateOldBackups();
      await Filesystem.writeFile({
        path: `${DIR}/${name}`,
        data: text,
        directory: VAULT_DIR,
        encoding: Encoding.UTF8,
        recursive: true,
      });
    },
    async remove(name) {
      await Filesystem.deleteFile({ path: `${DIR}/${name}`, directory: VAULT_DIR });
    },
  };
}

export function kvVault(kv: KeyValueStore): BackupVault {
  return {
    where: 'browser',
    async list() {
      const keys = await kv.keys(WEB_PREFIX).catch(() => [] as string[]);
      return keys
        .map((k) => ({ name: k.slice(WEB_PREFIX.length) }))
        .filter((b) => isAutoBackupName(b.name));
    },
    async read(name) {
      const v = await kv.get(WEB_PREFIX + name);
      if (v === null) throw new Error('missing');
      return v;
    },
    async write(name, text) {
      await kv.set(WEB_PREFIX + name, text);
    },
    async remove(name) {
      await kv.remove(WEB_PREFIX + name);
    },
  };
}

export type AutoRunResult =
  | { readonly kind: 'not-due' }
  | {
      readonly kind: 'done';
      readonly name: string;
      readonly secrets: boolean;
      readonly pruned: number;
    }
  | { readonly kind: 'failed'; readonly error: string };

/**
 * Write one automatic backup now (also "Back up now"), then prune to `keep`. Secrets only
 * with a passphrase and when reading them needs no prompt (see the file comment).
 */
export async function runAutoBackup(
  services: AppServices,
  settings: AppSettings,
  vault: BackupVault,
  now: number = Date.now(),
  opts: { allowPrompt?: boolean } = {},
): Promise<AutoRunResult> {
  try {
    let passphrase = await loadBackupPassphrase(services);
    if (passphrase && services.lock.isEnabled()) {
      const ok = opts.allowPrompt
        ? await services.lock.ensureUnlocked(strings.lock.credentialReason, strings.lock.cancel)
        : services.lock.recentlyUnlocked();
      if (!ok) passphrase = null;
    }
    const b = await buildBackup(services, settings, passphrase, now);
    const name = autoBackupFileName(now);
    await vault.write(name, JSON.stringify(b.file, null, 2));
    const prune = backupsToPrune(await vault.list(), settings.autoBackup.keep);
    for (const n of prune) await vault.remove(n).catch(() => undefined);
    await saveAutoState(services.kv, { lastAt: now });
    services.log.info(
      'backup',
      `automatic backup saved (${b.servers} servers, secrets: ${b.secrets}, pruned ${prune.length})`,
    );
    return { kind: 'done', name, secrets: b.secrets, pruned: prune.length };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    services.log.warn('backup', `automatic backup failed: ${error}`);
    const prev = await loadAutoState(services.kv);
    await saveAutoState(services.kv, { lastAt: prev.lastAt, lastError: error });
    return { kind: 'failed', error };
  }
}

let running: Promise<AutoRunResult> | null = null;

/** On app start and resume: run an automatic backup if one is due (one at a time). */
export function runAutoBackupIfDue(
  services: AppServices,
  settings: AppSettings,
  vault: BackupVault,
  now: number = Date.now(),
): Promise<AutoRunResult> {
  if (running) return running;
  const run = (async (): Promise<AutoRunResult> => {
    const state = await loadAutoState(services.kv);
    if (!isBackupDue(settings.autoBackup, state.lastAt, now)) return { kind: 'not-due' };
    return runAutoBackup(services, settings, vault, now);
  })();
  running = run;
  void run.finally(() => {
    running = null;
  });
  return run;
}

export async function listStoredBackups(vault: BackupVault): Promise<StoredBackup[]> {
  return sortBackups(await vault.list());
}
