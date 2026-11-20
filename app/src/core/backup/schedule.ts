/**
 * Scheduled automatic backups (SRV-10). Pure: when a backup is due, file names, and which
 * stored backups the rolling retention removes.
 *
 * Mobile systems do not run app code on a schedule without extra background machinery, so
 * a due backup runs the next time the app is opened or resumed (`isBackupDue`).
 */

export type BackupFrequency = 'daily' | 'weekly' | 'monthly';
export const BACKUP_FREQUENCIES: readonly BackupFrequency[] = ['daily', 'weekly', 'monthly'];

export interface AutoBackupSettings {
  readonly enabled: boolean;
  readonly frequency: BackupFrequency;
  /** How many automatic backups to keep (oldest removed first). */
  readonly keep: number;
}

export const AUTO_BACKUP_KEEP_MIN = 1;
export const AUTO_BACKUP_KEEP_MAX = 30;

export const DEFAULT_AUTO_BACKUP: AutoBackupSettings = {
  enabled: false,
  frequency: 'weekly',
  keep: 5,
};

export function parseAutoBackupSettings(raw: unknown): AutoBackupSettings {
  const d = DEFAULT_AUTO_BACKUP;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return d;
  const r = raw as Record<string, unknown>;
  const keep = r['keep'];
  return {
    enabled: typeof r['enabled'] === 'boolean' ? r['enabled'] : d.enabled,
    frequency: BACKUP_FREQUENCIES.includes(r['frequency'] as BackupFrequency)
      ? (r['frequency'] as BackupFrequency)
      : d.frequency,
    keep:
      typeof keep === 'number' && Number.isInteger(keep)
        ? Math.min(AUTO_BACKUP_KEEP_MAX, Math.max(AUTO_BACKUP_KEEP_MIN, keep))
        : d.keep,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** When the next automatic backup is due after one at `last` (local calendar months). */
export function nextBackupAt(last: number, frequency: BackupFrequency): number {
  switch (frequency) {
    case 'daily':
      return last + DAY_MS;
    case 'weekly':
      return last + 7 * DAY_MS;
    case 'monthly': {
      const d = new Date(last);
      const day = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + 1);
      // Clamp to the month's last day (31 Jan → 28/29 Feb).
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(day, lastDay));
      return d.getTime();
    }
  }
}

/**
 * Whether an automatic backup should run now. Never run before: due at once. A last-run
 * time in the future (clock moved back) counts as due, so a wrong clock cannot stop backups.
 */
export function isBackupDue(
  settings: AutoBackupSettings,
  lastAt: number | null,
  now: number,
): boolean {
  if (!settings.enabled) return false;
  if (lastAt === null || lastAt > now) return true;
  return now >= nextBackupAt(lastAt, settings.frequency);
}

/** Next due time to show in the UI, or null when off. */
export function nextDueAt(
  settings: AutoBackupSettings,
  lastAt: number | null,
  now: number,
): number | null {
  if (!settings.enabled) return null;
  if (lastAt === null || lastAt > now) return now;
  return nextBackupAt(lastAt, settings.frequency);
}

export const AUTO_BACKUP_PREFIX = 'openmobileguac-auto-';

/** `openmobileguac-auto-2026-11-20-1405.json` (local time, sorts by time). */
export function autoBackupFileName(now: number): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${AUTO_BACKUP_PREFIX}${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.json`;
}

export function isAutoBackupName(name: string): boolean {
  return name.startsWith(AUTO_BACKUP_PREFIX) && name.endsWith('.json') && !name.includes('/');
}

export interface StoredBackup {
  readonly name: string;
  /** Modification time (ms), when the store knows it. */
  readonly at?: number;
}

/** Newest first: by time when known, else by name (names sort by time). */
export function sortBackups(list: readonly StoredBackup[]): StoredBackup[] {
  return [...list].sort((a, b) => {
    if (a.at !== undefined && b.at !== undefined && a.at !== b.at) return b.at - a.at;
    return b.name.localeCompare(a.name);
  });
}

/** Automatic backups to delete so that `keep` remain (manual files are never touched). */
export function backupsToPrune(list: readonly StoredBackup[], keep: number): string[] {
  const auto = sortBackups(list.filter((b) => isAutoBackupName(b.name)));
  return auto.slice(Math.max(0, keep)).map((b) => b.name);
}
