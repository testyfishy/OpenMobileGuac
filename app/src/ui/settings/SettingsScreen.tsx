import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from '../components/Dialog.tsx';
import { RangeField, Segmented, Toggle } from '../components/Form.tsx';
import { Icon } from '../components/Icon.tsx';
import { Screen } from '../components/Screen.tsx';
import { useToast } from '../components/toastContext.ts';
import { LOCALES, LOCALE_NAMES, type LanguagePreference } from '../i18n/locale.ts';
import {
  DEFAULT_SESSION_SETTINGS,
  normalizeSessionSettings,
  type SessionSettings,
} from '../session/settings.ts';
import { descriptorsIn, type ListEditor } from '../session/settingsSchema.ts';
import { sessionStrings } from '../session/sessionStrings.ts';
import { keySetNameIn } from '../session/keySetNames.ts';
import { useNav } from '../nav/NavContext.ts';
import { useAppSettings, useProfilesVersion, useServices } from '../services/context.ts';
import {
  isAndroid,
  notificationPermission,
  requestNotificationPermission,
} from '../services/keepAlive.ts';
import { platformName, saveTextFile, type BiometryAvailability } from '../services/native.ts';
import { useSessions } from '../sessions/SessionsContext.ts';
import { SOURCE_URL, strings } from '../strings.ts';
import type { ThemePreference } from '../theme/theme.ts';
import {
  REMEMBER_POLICIES,
  type RememberPolicy,
} from '../../session/credentials/rememberedParams.ts';
import {
  BACKGROUND_DISCONNECT_CHOICES,
  LOCK_AFTER_CHOICES,
  MAX_SESSIONS_MAX,
  MAX_SESSIONS_MIN,
  SERVER_SIGN_OUT_CHOICES,
  diffFromDefaults,
  type DemoVisibility,
  mergeSessionSettings,
  parseServerOptions,
  serverOptionsToJson,
} from './settingsModel.ts';
import { SessionDefaultsEditor } from './SessionDefaultsEditor.tsx';
import { SessionListEditor } from './SessionListEditors.tsx';

function durationLabel(seconds: number | null): string {
  if (seconds === null) return strings.common.never;
  if (seconds === 0) return strings.common.immediately;
  if (seconds >= 3600 && seconds % 3600 === 0) return strings.common.hours(seconds / 3600);
  return seconds < 60 ? strings.common.seconds(seconds) : strings.common.minutes(seconds / 60);
}

/** Global settings (SET-1), security (SRV-6), sessions (MUL-1, T2.1), data and About. */
export function SettingsScreen() {
  const nav = useNav();
  const services = useServices();
  const toast = useToast();
  const { settings, update } = useAppSettings();
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  });
  const t = strings.settings;
  const session = normalizeSessionSettings(
    mergeSessionSettings(DEFAULT_SESSION_SETTINGS, settings.sessionDefaults, {}),
  );
  const changed = useMemo(
    () => new Set(Object.keys(settings.sessionDefaults)),
    [settings.sessionDefaults],
  );
  const [query, setQuery] = useState('');
  const [listEditor, setListEditor] = useState<ListEditor | null>(null);
  const [biometry, setBiometry] = useState<BiometryAvailability | undefined>(undefined);
  const [confirmLockOff, setConfirmLockOff] = useState<string[] | null>(null);
  const sessions = useSessions();
  const { bump } = useProfilesVersion();
  const [signOut, setSignOut] = useState<{ removeServers: boolean; busy: boolean } | null>(null);
  const [keepAliveAsk, setKeepAliveAsk] = useState(false);
  const [keepAliveDenied, setKeepAliveDenied] = useState(false);
  const android = isAndroid();
  const ios = platformName() === 'ios';
  const openSessions = sessions.state.sessions.length;

  useEffect(() => {
    if (!android || !settings.keepAliveBackground) return;
    let live = true;
    void notificationPermission().then((p) => {
      if (live) setKeepAliveDenied(p === 'denied');
    });
    return () => {
      live = false;
    };
  }, [android, settings.keepAliveBackground]);

  const setKeepAlive = (on: boolean) => {
    if (!on) {
      update({ ...settings, keepAliveBackground: false });
      return;
    }
    // Android 13+ asks for POST_NOTIFICATIONS: explain first, then show the system prompt.
    void notificationPermission().then((p) => {
      if (p === 'granted' || p === 'unavailable')
        update({ ...settings, keepAliveBackground: true });
      else setKeepAliveAsk(true);
    });
  };

  const confirmKeepAlive = async () => {
    setKeepAliveAsk(false);
    const p = await requestNotificationPermission();
    setKeepAliveDenied(p === 'denied');
    // The service runs without the notification permission too (the notification is hidden).
    update({ ...settings, keepAliveBackground: true });
  };

  const runSignOut = async (removeServers: boolean) => {
    setSignOut({ removeServers, busy: true });
    // Close sessions first, so they end cleanly instead of flipping to "sign in again".
    sessions.closeAll();
    const profiles = await services.profiles.list();
    await services.auth.signOutEverywhere(profiles);
    for (const p of profiles) {
      if (removeServers) {
        await services.profiles.remove(p.id).catch(() => undefined);
        await services.settings.setHttpWarningDismissed(p.id, false).catch(() => undefined);
      } else {
        // The TOTP seeds are gone: autofill has nothing to fill.
        const o = parseServerOptions(
          await services.profiles.getOptions(p.id).catch(() => undefined),
        );
        if (o.totpAutofill) {
          await services.profiles
            .setOptions(p.id, serverOptionsToJson({ ...o, totpAutofill: false }))
            .catch(() => undefined);
        }
      }
    }
    services.log.info('auth', `signed out of all servers (removed: ${removeServers})`);
    setSignOut(null);
    bump();
    toast.show(removeServers ? t.signedOutRemoved(profiles.length) : t.signedOut(profiles.length));
  };

  useEffect(() => {
    let live = true;
    void services.lock.availability().then((a) => {
      if (live) setBiometry(a);
    });
    return () => {
      live = false;
    };
  }, [services.lock]);

  // Several writes can happen in one tap (e.g. deleting the key set in use also picks a new
  // default): each builds on the latest written settings, not on this render's.
  const write = (next: typeof settings) => {
    settingsRef.current = next;
    update(next);
  };

  const setSession = (patch: Partial<SessionSettings>) => {
    const cur = settingsRef.current;
    const values = normalizeSessionSettings(
      mergeSessionSettings(DEFAULT_SESSION_SETTINGS, cur.sessionDefaults, {}),
    );
    write({
      ...cur,
      sessionDefaults: diffFromDefaults(DEFAULT_SESSION_SETTINGS, { ...values, ...patch }),
    });
  };

  const setLock = async (on: boolean) => {
    if (on) {
      // Prove the prompt works before relying on it.
      const ok = (await services.lock.prompt(strings.lock.reason, strings.lock.cancel)) === 'ok';
      if (ok) update({ ...settings, lock: { ...settings.lock, enabled: true } });
      return;
    }
    // Turning the lock off is itself protected (AUDIT #3): it needs a successful unlock.
    if ((await services.lock.prompt(strings.lock.offReason, strings.lock.cancel)) !== 'ok') return;
    // Stored TOTP seeds are only allowed behind the lock (SRV-9): turning it off deletes them.
    const ids = [...(await services.profiles.list()).map((p) => p.id)];
    const withSeeds: string[] = [];
    for (const id of ids) if (await services.auth.hasTotpSeed(id)) withSeeds.push(id);
    if (withSeeds.length > 0) setConfirmLockOff(withSeeds);
    else update({ ...settings, lock: { ...settings.lock, enabled: false } });
  };

  const lockOffAndWipe = async (ids: string[]) => {
    setConfirmLockOff(null);
    for (const id of ids) {
      await services.auth.saveTotpSeed(id, null);
      const o = parseServerOptions(await services.profiles.getOptions(id));
      await services.profiles.setOptions(id, serverOptionsToJson({ ...o, totpAutofill: false }));
    }
    update({ ...settings, lock: { ...settings.lock, enabled: false } });
  };

  const storage =
    services.secretStorage === 'secure'
      ? t.storageSecure
      : services.secretStorage === 'insecure-dev'
        ? t.storageDev
        : t.storageMemory;

  const lockAvailable = biometry === 'available';

  // SRV-11: a change of policy also drops what the new one does not allow (see applyPolicy).
  // Saved servers, plus the dev server (a virtual profile that is not in the list).
  const secretProfileIds = async () => {
    const ids = (await services.profiles.list().catch(() => [])).map((p) => p.id);
    const dev = services.devServer?.profile.id;
    return dev && !ids.includes(dev) ? [...ids, dev] : ids;
  };
  const setRememberPolicy = (policy: RememberPolicy) => {
    update({ ...settings, rememberConnectionPasswords: policy });
    void secretProfileIds()
      .then((ids) => services.connectionSecrets.applyPolicy(policy, ids))
      .catch(() => undefined);
  };
  const forgetConnectionPasswords = async () => {
    await services.connectionSecrets.forgetAll(await secretProfileIds());
    services.log.info('auth', 'remembered connection passwords forgotten');
    toast.show(t.connectionPasswordsForgotten);
  };

  return (
    <Screen title={t.title} onBack={nav.back}>
      <div className="form settings">
        <section className="settings-group" aria-labelledby="set-appearance">
          <h2 id="set-appearance" className="section-title">
            {t.appearance}
          </h2>
          <Segmented<ThemePreference>
            label={t.theme}
            value={settings.theme}
            onChange={(theme) => update({ ...settings, theme })}
            options={[
              { value: 'system', label: t.themeSystem },
              { value: 'light', label: t.themeLight },
              { value: 'dark', label: t.themeDark },
            ]}
          />
          <Segmented<LanguagePreference>
            label={t.language}
            value={settings.language}
            onChange={(language) => update({ ...settings, language })}
            options={[
              { value: 'system', label: t.languageSystem },
              ...LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] })),
            ]}
          />
        </section>

        <section className="settings-group" aria-labelledby="set-security">
          <h2 id="set-security" className="section-title">
            <Icon name="lock" size="1rem" /> {t.security}
          </h2>
          <Toggle
            label={t.lockEnable}
            hint={
              biometry === 'web'
                ? t.lockUnavailableWeb
                : biometry === 'no-device-security'
                  ? t.lockUnavailableDevice
                  : t.lockHint
            }
            checked={settings.lock.enabled && lockAvailable}
            disabled={!lockAvailable}
            onChange={(v) => void setLock(v)}
          />
          {settings.lock.enabled && lockAvailable ? (
            <Segmented<string>
              label={t.lockAfter}
              value={String(settings.lock.afterSeconds)}
              onChange={(v) =>
                update({ ...settings, lock: { ...settings.lock, afterSeconds: Number(v) } })
              }
              options={LOCK_AFTER_CHOICES.map((s) => ({
                value: String(s),
                label: durationLabel(s),
              }))}
            />
          ) : null}
          <Segmented<RememberPolicy>
            label={t.rememberConnection}
            value={settings.rememberConnectionPasswords}
            onChange={setRememberPolicy}
            options={REMEMBER_POLICIES.map((p) => ({
              value: p,
              label: t.rememberConnectionOptions[p],
            }))}
          />
          <p className="field-hint">{t.rememberConnectionHint}</p>
          {settings.rememberConnectionPasswords === 'device' &&
          services.secretStorage === 'memory' ? (
            <p className="field-hint">{t.rememberConnectionMemoryOnly}</p>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost"
            data-action="forget-connection-passwords"
            onClick={() => void forgetConnectionPasswords()}
          >
            {t.forgetConnectionPasswords}
          </button>
          <div className="list-setting">
            <span className="toggle-label">
              <span>{t.signOutAll}</span>
              <span className="toggle-hint">{t.signOutAllHint}</span>
            </span>
            <button
              type="button"
              className="btn btn-small btn-danger-ghost"
              data-action="sign-out-all"
              onClick={() => setSignOut({ removeServers: false, busy: false })}
            >
              {t.signOutConfirm}
            </button>
          </div>
        </section>

        <section className="settings-group" aria-labelledby="set-sessions">
          <h2 id="set-sessions" className="section-title">
            <Icon name="layers" size="1rem" /> {t.sessions}
          </h2>
          <RangeField
            label={t.maxSessions}
            value={settings.maxSessions}
            min={MAX_SESSIONS_MIN}
            max={MAX_SESSIONS_MAX}
            step={1}
            onChange={(v) => update({ ...settings, maxSessions: v })}
            format={(v) => String(v)}
          />
          <p className="field-hint">{t.maxSessionsHint}</p>
          <Segmented<string>
            label={t.backgroundDisconnect}
            value={String(settings.backgroundDisconnectSeconds)}
            onChange={(v) =>
              update({ ...settings, backgroundDisconnectSeconds: v === 'null' ? null : Number(v) })
            }
            options={BACKGROUND_DISCONNECT_CHOICES.map((s) => ({
              value: String(s),
              label: durationLabel(s),
            }))}
          />
          <p className="field-hint">{t.backgroundDisconnectHint}</p>
          {ios ? <p className="field-hint">{t.backgroundDisconnectIos}</p> : null}
          <Segmented<string>
            label={t.serverSignOut}
            value={String(settings.serverSignOutAfterSeconds)}
            onChange={(v) =>
              update({ ...settings, serverSignOutAfterSeconds: v === 'null' ? null : Number(v) })
            }
            options={SERVER_SIGN_OUT_CHOICES.map((s) => ({
              value: String(s),
              label: durationLabel(s),
            }))}
          />
          <p className="field-hint">{t.serverSignOutHint}</p>
          <Toggle
            label={t.keepAlive}
            hint={android ? t.keepAliveHintAndroid : ios ? t.keepAliveHintIos : t.keepAliveHintWeb}
            checked={settings.keepAliveBackground}
            disabled={!android && !settings.keepAliveBackground}
            onChange={setKeepAlive}
          />
          {android && settings.keepAliveBackground ? (
            <>
              {keepAliveDenied ? <p className="field-hint">{t.keepAliveDenied}</p> : null}
              <p className="field-hint">{t.keepAliveBattery}</p>
            </>
          ) : null}
          <Toggle
            label={t.thumbnails}
            hint={t.thumbnailsHint}
            checked={settings.thumbnails}
            onChange={(v) => {
              update({ ...settings, thumbnails: v });
              if (!v) void services.profiles.clearThumbnails();
            }}
          />
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() =>
              void services.profiles.clearThumbnails().then(() => toast.show(t.thumbnailsCleared))
            }
          >
            {t.clearThumbnails}
          </button>
        </section>

        <section className="settings-group" aria-labelledby="set-keys">
          <h2 id="set-keys" className="section-title">
            <Icon name="key" size="1rem" /> {t.keysTitle}
          </h2>
          <p className="muted">{t.keysHint}</p>
          <div className="list-setting">
            <span className="toggle-label">
              <span>{t.keySetsButton}</span>
              <span className="toggle-hint">
                {t.keySetsSummary(settings.keys.sets.length)} ·{' '}
                {keySetNameIn(settings.keys, session.keySet)}
              </span>
            </span>
            <button
              type="button"
              className="btn btn-small"
              data-action="key-sets"
              onClick={() => setListEditor('keySets')}
            >
              <Icon name="edit" /> {sessionStrings.options.edit}
            </button>
          </div>
          <div className="list-setting">
            <span className="toggle-label">
              <span>{t.combosButton}</span>
              <span className="toggle-hint">{t.combosSummary(settings.keys.combos.length)}</span>
            </span>
            <button
              type="button"
              className="btn btn-small"
              data-action="combos"
              onClick={() => setListEditor('combos')}
            >
              <Icon name="edit" /> {sessionStrings.options.edit}
            </button>
          </div>
        </section>

        <section className="settings-group" aria-labelledby="set-session">
          <h2 id="set-session" className="section-title">
            <Icon name="monitor" size="1rem" /> {t.sessionDefaults}
          </h2>
          <p className="muted">{t.sessionDefaultsHint}</p>
          <SessionDefaultsEditor
            values={session}
            changed={changed}
            query={query}
            onQuery={setQuery}
            onChange={setSession}
            onResetSection={(section) => {
              const keys = new Set<string>(descriptorsIn(section).map((d) => d.key));
              const rest = Object.fromEntries(
                Object.entries(settings.sessionDefaults).filter(([k]) => !keys.has(k)),
              );
              update({ ...settings, sessionDefaults: rest });
            }}
            onResetAll={() => update({ ...settings, sessionDefaults: {} })}
            onEditList={setListEditor}
            summaryContext={{ keySetName: (id) => keySetNameIn(settings.keys, id) }}
          />
        </section>

        <section className="settings-group" aria-labelledby="set-data">
          <h2 id="set-data" className="section-title">
            {t.data}
          </h2>
          <div className="link-list">
            <button
              type="button"
              className="row-main link-row"
              onClick={() => nav.push({ name: 'backup' })}
            >
              <Icon name="archive" /> <span className="row-text">{t.backup}</span>
              <Icon name="chevron-right" className="row-chevron" />
            </button>
            <button
              type="button"
              className="row-main link-row"
              onClick={() => nav.push({ name: 'diagnostics' })}
            >
              <Icon name="bug" /> <span className="row-text">{t.diagnostics}</span>
              <Icon name="chevron-right" className="row-chevron" />
            </button>
            <button
              type="button"
              className="row-main link-row"
              onClick={() => update({ ...settings, onboardingDone: false })}
            >
              <Icon name="info" /> <span className="row-text">{t.introduction}</span>
            </button>
          </div>
        </section>

        <section className="settings-group" aria-labelledby="set-about">
          <h2 id="set-about" className="section-title">
            {t.about}
          </h2>
          <dl className="about">
            <div>
              <dt>{t.version}</dt>
              <dd>{__APP_VERSION__}</dd>
            </div>
            <div>
              <dt>{t.licence}</dt>
              <dd>{t.licenceValue}</dd>
            </div>
            <div>
              <dt>{t.source}</dt>
              <dd>
                <a href={SOURCE_URL} target="_blank" rel="noreferrer noopener">
                  {SOURCE_URL.replace(/^https:\/\//, '')}
                </a>
              </dd>
            </div>
            <div>
              <dt>{t.storageTitle}</dt>
              <dd>{storage}</dd>
            </div>
          </dl>
          <Segmented<DemoVisibility>
            label={t.showDemo}
            value={settings.showDemo}
            onChange={(showDemo) => update({ ...settings, showDemo })}
            options={[
              { value: 'auto', label: t.showDemoAuto },
              { value: 'show', label: t.showDemoShow },
              { value: 'hide', label: t.showDemoHide },
            ]}
          />
          <p className="field-hint">{t.showDemoHint}</p>
          <p className="muted">{t.disclaimer}</p>
          <h3 className="subsection-title">{t.privacyTitle}</h3>
          <p className="muted">{t.privacy}</p>
        </section>
      </div>
      {listEditor ? (
        <SessionListEditor
          editor={listEditor}
          values={session}
          onChange={setSession}
          keys={{
            library: settings.keys,
            onLibrary: (keys) => write({ ...settingsRef.current, keys }),
            saveFile: saveTextFile,
          }}
          onClose={() => setListEditor(null)}
        />
      ) : null}
      {signOut ? (
        <Dialog
          title={t.signOutTitle}
          tone="danger"
          onCancel={() => (signOut.busy ? undefined : setSignOut(null))}
          actions={
            <>
              <button
                type="button"
                className="btn"
                disabled={signOut.busy}
                onClick={() => setSignOut(null)}
              >
                {strings.common.cancel}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={signOut.busy}
                data-action="confirm-sign-out-all"
                onClick={() => void runSignOut(signOut.removeServers)}
              >
                {signOut.busy
                  ? t.signingOut
                  : signOut.removeServers
                    ? t.signOutConfirmRemove
                    : t.signOutConfirm}
              </button>
            </>
          }
        >
          <p>{t.signOutBody}</p>
          <ul>
            {t.signOutItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {signOut.removeServers ? (
            <p>
              <strong>{t.removeServersHint}</strong>
            </p>
          ) : (
            <p>{t.signOutKeeps}</p>
          )}
          {openSessions > 0 ? <p>{t.signOutSessions(openSessions)}</p> : null}
          <Toggle
            label={t.removeServers}
            hint={t.removeServersHint}
            checked={signOut.removeServers}
            disabled={signOut.busy}
            onChange={(v) => setSignOut({ ...signOut, removeServers: v })}
          />
        </Dialog>
      ) : null}
      {keepAliveAsk ? (
        <Dialog
          title={t.keepAliveExplainTitle}
          onCancel={() => setKeepAliveAsk(false)}
          actions={
            <>
              <button type="button" className="btn" onClick={() => setKeepAliveAsk(false)}>
                {strings.common.cancel}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void confirmKeepAlive()}
              >
                {t.keepAliveContinue}
              </button>
            </>
          }
        >
          <p>{t.keepAliveExplain}</p>
        </Dialog>
      ) : null}
      {confirmLockOff ? (
        <Dialog
          title={t.lockEnable}
          tone="warning"
          onCancel={() => setConfirmLockOff(null)}
          actions={
            <>
              <button type="button" className="btn" onClick={() => setConfirmLockOff(null)}>
                {strings.common.cancel}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void lockOffAndWipe(confirmLockOff)}
              >
                {t.lockOffConfirm}
              </button>
            </>
          }
        >
          <p>{t.lockOffWithSeeds}</p>
        </Dialog>
      ) : null}
    </Screen>
  );
}
