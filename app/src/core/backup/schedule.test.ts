import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUTO_BACKUP,
  autoBackupFileName,
  backupsToPrune,
  isAutoBackupName,
  isBackupDue,
  nextBackupAt,
  nextDueAt,
  parseAutoBackupSettings,
  sortBackups,
  type AutoBackupSettings,
} from './schedule.ts';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0).getTime();
const on = (frequency: AutoBackupSettings['frequency']): AutoBackupSettings => ({
  enabled: true,
  frequency,
  keep: 5,
});

describe('scheduled backup due logic (fake clock)', () => {
  it.each<[string, AutoBackupSettings, number | null, number, boolean]>([
    ['off is never due', DEFAULT_AUTO_BACKUP, null, at(2026, 1, 1), false],
    ['never run: due at once', on('weekly'), null, at(2026, 1, 1), true],
    ['daily: 23 h later not due', on('daily'), at(2026, 1, 1, 8), at(2026, 1, 2, 7), false],
    ['daily: 24 h later due', on('daily'), at(2026, 1, 1, 8), at(2026, 1, 2, 8), true],
    ['weekly: 6 days not due', on('weekly'), at(2026, 1, 1), at(2026, 1, 7), false],
    ['weekly: 7 days due', on('weekly'), at(2026, 1, 1), at(2026, 1, 8), true],
    ['monthly: same day next month due', on('monthly'), at(2026, 3, 15), at(2026, 4, 15), true],
    ['monthly: day before not due', on('monthly'), at(2026, 3, 15), at(2026, 4, 14), false],
    ['monthly: 31 Jan → 28 Feb', on('monthly'), at(2026, 1, 31), at(2026, 2, 28), true],
    ['clock moved back: due', on('weekly'), at(2026, 6, 1), at(2026, 5, 1), true],
  ])('%s', (_n, settings, last, now, due) => {
    expect(isBackupDue(settings, last, now)).toBe(due);
  });

  it('next due time for the UI', () => {
    const last = at(2026, 1, 1);
    expect(nextDueAt(DEFAULT_AUTO_BACKUP, last, last)).toBeNull();
    expect(nextDueAt(on('daily'), null, 5)).toBe(5);
    expect(nextDueAt(on('daily'), last, last)).toBe(nextBackupAt(last, 'daily'));
    expect(new Date(nextBackupAt(at(2024, 1, 31), 'monthly')).getDate()).toBe(29); // leap year
  });
});

describe('settings', () => {
  it('defaults: off, weekly, keep 5; bad values fall back or clamp', () => {
    expect(DEFAULT_AUTO_BACKUP).toEqual({ enabled: false, frequency: 'weekly', keep: 5 });
    expect(parseAutoBackupSettings(null)).toEqual(DEFAULT_AUTO_BACKUP);
    expect(parseAutoBackupSettings({ enabled: true, frequency: 'hourly', keep: 99 })).toEqual({
      enabled: true,
      frequency: 'weekly',
      keep: 30,
    });
    expect(parseAutoBackupSettings({ keep: 0.5 }).keep).toBe(5);
    expect(parseAutoBackupSettings({ keep: 0 }).keep).toBe(1);
  });
});

describe('rolling retention', () => {
  it('names sort by time and are recognised', () => {
    const a = autoBackupFileName(at(2026, 11, 20, 9));
    const b = autoBackupFileName(at(2026, 11, 20, 14));
    expect(a).toMatch(/^openmobileguac-auto-2026-11-20-090000\.json$/);
    expect(isAutoBackupName(a)).toBe(true);
    expect(isAutoBackupName('openmobileguac-backup-2026-11-20.json')).toBe(false);
    expect(isAutoBackupName('openmobileguac-auto-x/../y.json')).toBe(false);
    expect(sortBackups([{ name: a }, { name: b }]).map((x) => x.name)).toEqual([b, a]);
  });

  it('keeps the newest N automatic backups and never touches other files', () => {
    const names = [1, 2, 3, 4, 5, 6, 7].map((d) => autoBackupFileName(at(2026, 1, d)));
    const list = [...names.map((name) => ({ name })), { name: 'my-manual-export.json' }];
    expect(backupsToPrune(list, 5).sort()).toEqual([names[0], names[1]].sort());
    expect(backupsToPrune(list, 10)).toEqual([]);
    expect(backupsToPrune(list, 1)).toHaveLength(6);
  });

  it('uses modification times when the store has them', () => {
    const list = [
      { name: 'openmobileguac-auto-a.json', at: 300 },
      { name: 'openmobileguac-auto-b.json', at: 100 },
      { name: 'openmobileguac-auto-c.json', at: 200 },
    ];
    expect(backupsToPrune(list, 2)).toEqual(['openmobileguac-auto-b.json']);
  });
});
