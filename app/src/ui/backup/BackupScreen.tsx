import { useRef, useState } from 'react';
import {
  backupFileName,
  createBackup,
  decryptSecrets,
  encryptSecrets,
  parseBackup,
  planRestore,
  type BackupFile,
  type BackupSecrets,
  type RestoreMode,
} from '../../core/backup/backup.ts';
import type { JsonValue } from '../../core/storage/ProfileStore.ts';
import { secretKeys } from '../../core/storage/SecureStore.ts';
import { Dialog } from '../components/Dialog.tsx';
import { ErrorBanner, InfoBanner } from '../components/Feedback.tsx';
import { Segmented, TextField, Toggle } from '../components/Form.tsx';
import { Icon } from '../components/Icon.tsx';
import { Screen } from '../components/Screen.tsx';
import { useNav } from '../nav/NavContext.ts';
import { useAppSettings, useProfilesVersion, useServices } from '../services/context.ts';
import { haptic, saveTextFile } from '../services/native.ts';
import { useSessions } from '../sessions/SessionsContext.ts';
import { settingsFromBackup } from '../settings/settingsModel.ts';
import { strings } from '../strings.ts';

const MIN_PASSPHRASE = 8;

/** SRV-10: export and restore servers, favourites, recents and settings as JSON. */
export function BackupScreen() {
  const nav = useNav();
  const b = strings.backup;
  return (
    <Screen title={b.title} onBack={nav.back}>
      <div className="form settings">
        <p className="muted">{b.intro}</p>
        <ExportSection />
        <ImportSection />
      </div>
    </Screen>
  );
}

function ExportSection() {
  const services = useServices();
  const { settings } = useAppSettings();
  const b = strings.backup;
  const [withSecrets, setWithSecrets] = useState(false);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | undefined>();
  const passError =
    withSecrets && pass.length > 0 && pass.length < MIN_PASSPHRASE
      ? b.passphraseShort
      : withSecrets && pass2.length > 0 && pass !== pass2
        ? b.passphraseMismatch
        : undefined;
  const canExport = !withSecrets || (pass.length >= MIN_PASSPHRASE && pass === pass2);

  const run = async () => {
    setBusy(true);
    setMessage(undefined);
    try {
      const profiles = await services.profiles.exportAll();
      let secrets;
      if (withSecrets) {
        // Reading saved secrets goes through the same unlock as signing in.
        if (
          !(await services.lock.ensureUnlocked(strings.lock.credentialReason, strings.lock.cancel))
        ) {
          return;
        }
        const plain: Record<string, { password?: string; totpSeed?: string }> = {};
        for (const p of profiles) {
          const id = p.profile.id;
          const password = await services.secure.get(secretKeys.password(id)).catch(() => null);
          const totpSeed = await services.secure.get(secretKeys.totpSeed(id)).catch(() => null);
          if (password || totpSeed) {
            plain[id] = { ...(password ? { password } : {}), ...(totpSeed ? { totpSeed } : {}) };
          }
        }
        secrets = await encryptSecrets(plain, pass);
      }
      const now = Date.now();
      const { lock: _lock, onboardingDone: _seen, ...portable } = settings;
      void _lock;
      void _seen;
      const file = createBackup({
        profiles,
        settings: JSON.parse(JSON.stringify(portable)) as Record<string, JsonValue>,
        appVersion: __APP_VERSION__,
        now,
        ...(secrets ? { secrets } : {}),
      });
      const name = backupFileName(now);
      const ok = await saveTextFile(name, JSON.stringify(file, null, 2));
      services.log.info(
        'backup',
        `export ${ok ? 'saved' : 'failed'} (${profiles.length} servers, secrets: ${withSecrets})`,
      );
      haptic(ok ? 'success' : 'error');
      setMessage(
        ok ? { ok: true, text: b.exported(name) } : { ok: false, text: b.errors['save'] ?? '' },
      );
      setPass('');
      setPass2('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-group" aria-labelledby="bk-export">
      <h2 id="bk-export" className="section-title">
        {b.exportTitle}
      </h2>
      <Toggle
        label={b.includeSecrets}
        hint={b.includeSecretsHint}
        checked={withSecrets}
        onChange={setWithSecrets}
      />
      {withSecrets ? (
        <>
          <TextField
            label={b.passphrase}
            value={pass}
            onChange={setPass}
            type="password"
            autoComplete="new-password"
          />
          <TextField
            label={b.passphraseConfirm}
            value={pass2}
            onChange={setPass2}
            type="password"
            autoComplete="new-password"
            error={passError}
          />
        </>
      ) : null}
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => void run()}
        disabled={busy || !canExport}
      >
        <Icon name="share" /> {busy ? b.exporting : b.exportButton}
      </button>
      {message ? (
        message.ok ? (
          <InfoBanner>{message.text}</InfoBanner>
        ) : (
          <ErrorBanner error={{ code: 'backup-save', title: message.text }} />
        )
      ) : null}
    </section>
  );
}

function ImportSection() {
  const services = useServices();
  const sessions = useSessions();
  const { settings, update } = useAppSettings();
  const { bump } = useProfilesVersion();
  const b = strings.backup;
  const fileInput = useRef<HTMLInputElement>(null);
  const [backup, setBackup] = useState<BackupFile | undefined>();
  const [skipped, setSkipped] = useState(0);
  const [error, setError] = useState<string | undefined>();
  const [mode, setMode] = useState<RestoreMode>('merge');
  const [withSettings, setWithSettings] = useState(true);
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [done, setDone] = useState<string | undefined>();

  const onFile = async (file: File | undefined) => {
    setBackup(undefined);
    setError(undefined);
    setDone(undefined);
    if (!file) return;
    let text: string;
    try {
      text = await file.text();
    } catch {
      setError(b.errors['read']);
      return;
    }
    const parsed = parseBackup(text);
    if (!parsed.ok) {
      setError(b.errors[parsed.error]);
      haptic('error');
      return;
    }
    setBackup(parsed.backup);
    setSkipped(parsed.skipped);
  };

  const restore = async () => {
    if (!backup) return;
    setConfirmReplace(false);
    setBusy(true);
    setError(undefined);
    try {
      let secrets: BackupSecrets | undefined;
      if (backup.secrets && pass) {
        try {
          secrets = await decryptSecrets(backup.secrets, pass);
        } catch {
          setError(b.badPassphrase);
          return;
        }
      }
      const existing = await services.profiles.list();
      const plan = planRestore(existing, backup, mode, () => globalThis.crypto.randomUUID());
      for (const id of plan.removeIds) sessions.closeServer(id);
      await services.profiles.applyRestore(plan.entries, plan.removeIds);
      if (secrets) {
        for (const [backupId, s] of Object.entries(secrets)) {
          const id = plan.idMap[backupId];
          if (!id) continue;
          if (s.password) await services.auth.savePassword(id, s.password);
          if (s.totpSeed) await services.auth.saveTotpSeed(id, s.totpSeed).catch(() => undefined);
        }
      }
      if (withSettings && backup.settings) update(settingsFromBackup(settings, backup.settings));
      bump();
      services.log.info(
        'backup',
        `restored (${plan.added} added, ${plan.updated} updated, ${plan.removed} removed)`,
      );
      haptic('success');
      setDone(b.restored(plan.added, plan.updated, plan.removed));
      setBackup(undefined);
      setPass('');
      if (fileInput.current) fileInput.current.value = '';
    } catch {
      setError(b.errors['shape']);
    } finally {
      setBusy(false);
    }
  };

  const date = backup?.exportedAt ? new Date(backup.exportedAt) : undefined;
  return (
    <section className="settings-group" aria-labelledby="bk-import">
      <h2 id="bk-import" className="section-title">
        {b.importTitle}
      </h2>
      <label className="btn file-btn">
        <Icon name="archive" /> {b.chooseFile}
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="visually-hidden"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
      </label>
      {error ? <ErrorBanner error={{ code: 'backup', title: error }} /> : null}
      {done ? <InfoBanner>{done}</InfoBanner> : null}
      {backup ? (
        <>
          <p>
            {b.fileSummary(
              backup.servers.length,
              date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString() : '',
            )}
            {skipped ? ` ${b.skipped(skipped)}` : ''}
          </p>
          <Segmented<RestoreMode>
            label={b.mode}
            value={mode}
            onChange={setMode}
            options={[
              { value: 'merge', label: b.merge },
              { value: 'replace', label: b.replace },
            ]}
          />
          <p className="field-hint">{mode === 'merge' ? b.mergeHint : b.replaceHint}</p>
          {backup.settings ? (
            <Toggle label={b.restoreSettings} checked={withSettings} onChange={setWithSettings} />
          ) : null}
          {backup.secrets ? (
            <>
              <InfoBanner>{b.secretsInFile}</InfoBanner>
              <TextField
                label={b.secretsPassphrase}
                value={pass}
                onChange={setPass}
                type="password"
                autoComplete="off"
              />
            </>
          ) : null}
          <button
            type="button"
            className={mode === 'replace' ? 'btn btn-danger' : 'btn btn-primary'}
            disabled={busy}
            onClick={() => (mode === 'replace' ? setConfirmReplace(true) : void restore())}
          >
            {busy ? b.restoring : b.restore}
          </button>
        </>
      ) : null}
      {confirmReplace ? (
        <Dialog
          title={b.replaceConfirmTitle}
          tone="danger"
          onCancel={() => setConfirmReplace(false)}
          actions={
            <>
              <button type="button" className="btn" onClick={() => setConfirmReplace(false)}>
                {strings.common.cancel}
              </button>
              <button type="button" className="btn btn-danger" onClick={() => void restore()}>
                {b.replaceConfirm}
              </button>
            </>
          }
        >
          <p>{b.replaceHint}</p>
        </Dialog>
      ) : null}
    </section>
  );
}
