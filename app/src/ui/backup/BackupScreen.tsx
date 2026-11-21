import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  backupFileName,
  countUnsealedSecrets,
  decryptSecrets,
  parseBackup,
  planRestore,
  secretsToRestore,
  type BackupFile,
  type BackupSecrets,
  type RestoreMode,
} from '../../core/backup/backup.ts';
import {
  AUTO_BACKUP_KEEP_MAX,
  AUTO_BACKUP_KEEP_MIN,
  BACKUP_FREQUENCIES,
  nextDueAt,
  type BackupFrequency,
  type StoredBackup,
} from '../../core/backup/schedule.ts';
import { Dialog } from '../components/Dialog.tsx';
import { ErrorBanner, InfoBanner } from '../components/Feedback.tsx';
import { RangeField, Segmented, TextField, Toggle } from '../components/Form.tsx';
import { Icon } from '../components/Icon.tsx';
import { Screen } from '../components/Screen.tsx';
import { useNav } from '../nav/NavContext.ts';
import { useAppSettings, useProfilesVersion, useServices } from '../services/context.ts';
import { haptic, saveTextFile } from '../services/native.ts';
import { useSessions } from '../sessions/SessionsContext.ts';
import { settingsRestore } from '../settings/settingsModel.ts';
import { strings } from '../strings.ts';
import {
  buildBackup,
  createBackupVault,
  listStoredBackups,
  loadAutoState,
  loadBackupPassphrase,
  runAutoBackup,
  setBackupPassphrase,
  type AutoBackupState,
  type BackupVault,
} from './backupService.ts';

const MIN_PASSPHRASE = 8;

/** A backup file chosen from the device's stored backups, handed to the restore section. */
interface Loaded {
  readonly name: string;
  readonly text: string;
  /** Changes on every load, so loading the same file again re-parses it. */
  readonly seq: number;
}

/** SRV-10: export and restore servers, favourites, recents and settings as JSON. */
export function BackupScreen() {
  const nav = useNav();
  const b = strings.backup;
  const services = useServices();
  const vault = useMemo(() => createBackupVault(services.kv), [services.kv]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const importRef = useRef<HTMLElement>(null);
  return (
    <Screen title={b.title} onBack={nav.back}>
      <div className="form settings">
        <p className="muted">{b.intro}</p>
        <ExportSection />
        <AutoSection
          vault={vault}
          onRestore={(name, text) => {
            setLoaded((l) => ({ name, text, seq: (l?.seq ?? 0) + 1 }));
            setTimeout(() => importRef.current?.scrollIntoView({ block: 'start' }), 0);
          }}
        />
        <ImportSection key={loaded?.seq ?? 0} loaded={loaded} sectionRef={importRef} />
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
      // Reading saved secrets goes through the same unlock as signing in.
      if (
        withSecrets &&
        !(await services.lock.ensureUnlocked(strings.lock.credentialReason, strings.lock.cancel))
      ) {
        return;
      }
      const now = Date.now();
      const built = await buildBackup(services, settings, withSecrets ? pass : null, now);
      const name = backupFileName(now);
      const ok = await saveTextFile(name, JSON.stringify(built.file, null, 2));
      services.log.info(
        'backup',
        `export ${ok ? 'saved' : 'failed'} (${built.servers} servers, secrets: ${withSecrets})`,
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

function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Scheduled automatic backups: settings, passphrase, "Back up now" and the stored files. */
function AutoSection({
  vault,
  onRestore,
}: {
  vault: BackupVault;
  onRestore: (name: string, text: string) => void;
}) {
  const services = useServices();
  const { settings, update } = useAppSettings();
  const b = strings.backup;
  const auto = settings.autoBackup;
  const [state, setState] = useState<AutoBackupState>({ lastAt: null });
  const [stored, setStored] = useState<StoredBackup[]>([]);
  const [hasPass, setHasPass] = useState(false);
  const [editPass, setEditPass] = useState(false);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | undefined>();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(
    () =>
      Promise.all([
        loadAutoState(services.kv),
        listStoredBackups(vault),
        loadBackupPassphrase(services),
      ]),
    [services, vault],
  );
  const apply = useCallback(([st, list, p]: Awaited<ReturnType<typeof load>>) => {
    setState(st);
    setStored(list);
    setHasPass(p !== null);
    setNow(Date.now());
  }, []);
  const refresh = async () => apply(await load());

  useEffect(() => {
    let live = true;
    void load().then((r) => {
      if (live) apply(r);
    });
    return () => {
      live = false;
    };
  }, [load, apply]);

  const setAuto = (patch: Partial<typeof auto>) =>
    update({ ...settings, autoBackup: { ...auto, ...patch } });

  const backUpNow = async () => {
    setBusy(true);
    setMessage(undefined);
    const r = await runAutoBackup(services, settings, vault, Date.now(), { allowPrompt: true });
    setBusy(false);
    if (r.kind === 'done') {
      haptic('success');
      setMessage({
        ok: true,
        text: `${b.savedAuto(r.name)} (${r.secrets ? b.withSecrets : b.withoutSecrets})`,
      });
    } else if (r.kind === 'failed') {
      haptic('error');
      setMessage({ ok: false, text: b.lastFailed(r.error) });
    }
    await refresh();
  };

  const passError =
    pass.length > 0 && pass.length < MIN_PASSPHRASE
      ? b.passphraseShort
      : pass2.length > 0 && pass !== pass2
        ? b.passphraseMismatch
        : undefined;

  const next = nextDueAt(auto, state.lastAt, now);

  return (
    <section className="settings-group" aria-labelledby="bk-auto" data-section="auto-backup">
      <h2 id="bk-auto" className="section-title">
        {b.autoTitle}
      </h2>
      <Toggle
        label={b.autoEnable}
        hint={b.autoHint}
        checked={auto.enabled}
        onChange={(enabled) => setAuto({ enabled })}
      />
      {auto.enabled ? (
        <>
          <Segmented<BackupFrequency>
            label={b.frequency}
            value={auto.frequency}
            onChange={(frequency) => setAuto({ frequency })}
            options={BACKUP_FREQUENCIES.map((f) => ({ value: f, label: b.frequencies[f] ?? f }))}
          />
          <RangeField
            label={b.keep}
            value={auto.keep}
            min={AUTO_BACKUP_KEEP_MIN}
            max={AUTO_BACKUP_KEEP_MAX}
            step={1}
            onChange={(keep) => setAuto({ keep })}
            format={b.keepFormat}
          />
        </>
      ) : null}
      <p className="field-hint" data-auto-last="">
        {state.lastAt === null ? b.lastNever : b.lastBackup(formatWhen(state.lastAt))}
      </p>
      {next !== null ? (
        <p className="field-hint" data-auto-next="">
          {state.lastAt === null || next <= now ? b.nextSoon : b.nextBackup(formatWhen(next))}
        </p>
      ) : null}
      {state.lastError ? <p className="field-error">{b.lastFailed(state.lastError)}</p> : null}

      <h3 className="subsection-title">{b.passTitle}</h3>
      <p className="field-hint">{b.passHint}</p>
      {settings.lock.enabled ? <p className="field-hint">{b.passLockNote}</p> : null}
      <p>{hasPass ? b.passSet : b.passNone}</p>
      {editPass ? (
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
          <div className="form-actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setEditPass(false);
                setPass('');
                setPass2('');
              }}
            >
              {strings.common.cancel}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={pass.length < MIN_PASSPHRASE || pass !== pass2}
              onClick={() =>
                void setBackupPassphrase(services, pass).then(() => {
                  setEditPass(false);
                  setPass('');
                  setPass2('');
                  setMessage({ ok: true, text: b.passSaved });
                  void refresh();
                })
              }
            >
              {b.savePass}
            </button>
          </div>
        </>
      ) : (
        <div className="form-actions">
          <button type="button" className="btn" onClick={() => setEditPass(true)}>
            {hasPass ? b.changePass : b.setPass}
          </button>
          {hasPass ? (
            <button
              type="button"
              className="btn btn-danger-ghost"
              onClick={() =>
                void setBackupPassphrase(services, null).then(() => {
                  setMessage({ ok: true, text: b.passRemoved });
                  void refresh();
                })
              }
            >
              {b.removePass}
            </button>
          ) : null}
        </div>
      )}

      <button
        type="button"
        className="btn btn-primary"
        disabled={busy}
        data-action="backup-now"
        onClick={() => void backUpNow()}
      >
        <Icon name="archive" /> {busy ? b.backingUp : b.backUpNow}
      </button>
      {message ? (
        message.ok ? (
          <InfoBanner>{message.text}</InfoBanner>
        ) : (
          <ErrorBanner error={{ code: 'backup-auto', title: message.text }} />
        )
      ) : null}

      <h3 className="subsection-title">{b.storedTitle}</h3>
      {vault.where === 'browser' ? <p className="field-hint">{b.storedBrowser}</p> : null}
      {stored.length === 0 ? <p className="muted">{b.noneStored}</p> : null}
      <ul className="list" data-stored-backups="">
        {stored.map((s) => (
          <li key={s.name} className="row edit-row" data-backup-name={s.name}>
            <span className="row-text">{s.name}</span>
            <span className="row-trailing">
              <button
                type="button"
                className="icon-btn"
                aria-label={b.shareName(s.name)}
                title={b.share}
                onClick={() => void vault.read(s.name).then((text) => saveTextFile(s.name, text))}
              >
                <Icon name="share" />
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={b.restoreName(s.name)}
                title={b.restoreThis}
                onClick={() =>
                  void vault
                    .read(s.name)
                    .then((text) => onRestore(s.name, text))
                    .catch(() => setMessage({ ok: false, text: b.errors['read'] ?? '' }))
                }
              >
                <Icon name="refresh" />
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={b.deleteName(s.name)}
                title={b.deleteThis}
                onClick={() => setConfirmDelete(s.name)}
              >
                <Icon name="trash" />
              </button>
            </span>
          </li>
        ))}
      </ul>
      {confirmDelete ? (
        <Dialog
          title={b.deleteConfirmTitle}
          tone="danger"
          onCancel={() => setConfirmDelete(null)}
          actions={
            <>
              <button type="button" className="btn" onClick={() => setConfirmDelete(null)}>
                {strings.common.cancel}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  const name = confirmDelete;
                  setConfirmDelete(null);
                  void vault
                    .remove(name)
                    .catch(() => undefined)
                    .then(refresh);
                }}
              >
                {b.deleteThis}
              </button>
            </>
          }
        >
          <p>{b.deleteConfirmBody(confirmDelete)}</p>
        </Dialog>
      ) : null}
    </section>
  );
}

function ImportSection({
  loaded,
  sectionRef,
}: {
  loaded: Loaded | null;
  sectionRef: RefObject<HTMLElement | null>;
}) {
  const services = useServices();
  const sessions = useSessions();
  const { settings, update } = useAppSettings();
  const { bump } = useProfilesVersion();
  const b = strings.backup;
  const fileInput = useRef<HTMLInputElement>(null);
  // A stored backup chosen above is parsed once on mount (the section is keyed by it).
  const [initial] = useState(() => (loaded ? parseBackup(loaded.text) : null));
  const [backup, setBackup] = useState<BackupFile | undefined>(
    initial?.ok ? initial.backup : undefined,
  );
  const [skipped, setSkipped] = useState(initial?.ok ? initial.skipped : 0);
  const [error, setError] = useState<string | undefined>(
    initial && !initial.ok ? b.errors[initial.error] : undefined,
  );
  const [mode, setMode] = useState<RestoreMode>('merge');
  const [withSettings, setWithSettings] = useState(true);
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [done, setDone] = useState<string | undefined>(
    loaded && initial?.ok ? b.loaded(loaded.name) : undefined,
  );

  const onText = (text: string) => {
    const parsed = parseBackup(text);
    if (!parsed.ok) {
      setError(b.errors[parsed.error]);
      haptic('error');
      return;
    }
    setBackup(parsed.backup);
    setSkipped(parsed.skipped);
  };

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
    onText(text);
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
      // The decrypted part vouches for trusted certificates (pre-release review R6).
      const plan = planRestore(
        existing,
        backup,
        mode,
        () => globalThis.crypto.randomUUID(),
        secrets,
      );
      for (const id of plan.removeIds) sessions.closeServer(id);
      await services.profiles.applyRestore(plan.entries, plan.removeIds);
      const unsealed = secrets ? countUnsealedSecrets(secrets) : 0;
      if (secrets) {
        for (const s of secretsToRestore(plan, backup, secrets)) {
          if (s.password) await services.auth.savePassword(s.id, s.password);
          if (s.totpSeed) {
            await services.auth.saveTotpSeed(s.id, s.totpSeed).catch(() => undefined);
          }
        }
      }
      let settingsReset = false;
      if (withSettings && backup.settings) {
        const r = settingsRestore(settings, backup.settings);
        settingsReset = r.securityReset;
        update(r.settings);
      }
      bump();
      services.log.info(
        'backup',
        `restored (${plan.added} added, ${plan.updated} updated, ${plan.removed} removed, ${plan.addressChanged} address changed, ${plan.pinsDropped} pins not restored, ${unsealed} unsealed secrets skipped)`,
      );
      haptic('success');
      setDone(
        b.restored(plan.added, plan.updated, plan.removed) +
          (plan.addressChanged > 0 ? b.restoredAddressChanged(plan.addressChanged) : '') +
          (backup.secrets && !secrets ? b.restoredSecretsSkipped : '') +
          (unsealed > 0 ? b.restoredUnsealedSkipped(unsealed) : '') +
          (plan.pinsDropped > 0 ? b.restoredPinsDropped(plan.pinsDropped) : '') +
          (plan.securityReset > 0 || settingsReset ? b.restoredSecurityReset : ''),
      );
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
    <section className="settings-group" aria-labelledby="bk-import" ref={sectionRef}>
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
