import { useEffect, useMemo, useRef } from 'react';
import { useAppSettings, useServices } from '../services/context.ts';
import { onAppActiveChange } from '../services/native.ts';
import { createBackupVault, runAutoBackupIfDue } from './backupService.ts';

/**
 * SRV-10 scheduled backups: checks on app start and on every return to the foreground
 * whether an automatic backup is due, and writes it. Renders nothing. (Mobile systems give
 * no reliable background schedule without extra plugins, so "due" backups wait for the
 * next time the app is opened.)
 */
export function AutoBackupRunner() {
  const services = useServices();
  const { settings } = useAppSettings();
  const vault = useMemo(() => createBackupVault(services.kv), [services.kv]);
  const latest = useRef(settings);
  useEffect(() => {
    latest.current = settings;
  });
  const enabled = settings.autoBackup.enabled;

  useEffect(() => {
    if (!enabled) return;
    const check = () => {
      // Not while the unlock prompt is showing (it can pause and resume the app).
      if (services.lock.promptActive()) return;
      // Never behind the lock screen (AUDIT #3): it would read stored secrets' passphrase.
      if (services.lock.isLocked()) return;
      void runAutoBackupIfDue(services, latest.current, vault);
    };
    // Give the app lock its chance to unlock first (secrets need a recent unlock).
    const t = setTimeout(check, 1500);
    const sub = onAppActiveChange((active) => {
      if (active) setTimeout(check, 1500);
    });
    return () => {
      clearTimeout(t);
      sub.dispose();
    };
  }, [enabled, services, vault]);

  return null;
}
