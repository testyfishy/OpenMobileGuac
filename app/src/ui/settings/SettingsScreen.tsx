import { useEffect, useState } from 'react';
import { Dialog } from '../components/Dialog.tsx';
import { RangeField, Segmented, Toggle } from '../components/Form.tsx';
import { Icon } from '../components/Icon.tsx';
import { Screen } from '../components/Screen.tsx';
import { useToast } from '../components/toastContext.ts';
import { LOCALES, LOCALE_NAMES, type LanguagePreference } from '../i18n/locale.ts';
import { DEFAULT_SESSION_SETTINGS, type SessionSettings } from '../session/settings.ts';
import { useNav } from '../nav/NavContext.ts';
import { useAppSettings, useServices } from '../services/context.ts';
import type { BiometryAvailability } from '../services/native.ts';
import { SOURCE_URL, strings } from '../strings.ts';
import type { ThemePreference } from '../theme/theme.ts';
import {
  BACKGROUND_DISCONNECT_CHOICES,
  LOCK_AFTER_CHOICES,
  MAX_SESSIONS_MAX,
  MAX_SESSIONS_MIN,
  POINTER_SPEED_MAX,
  POINTER_SPEED_MIN,
  diffFromDefaults,
  mergeSessionSettings,
  parseServerOptions,
  serverOptionsToJson,
} from './settingsModel.ts';

function durationLabel(seconds: number | null): string {
  if (seconds === null) return strings.common.never;
  if (seconds === 0) return strings.common.immediately;
  return seconds < 60 ? strings.common.seconds(seconds) : strings.common.minutes(seconds / 60);
}

/** Global settings (SET-1), security (SRV-6), sessions (MUL-1, T2.1), data and About. */
export function SettingsScreen() {
  const nav = useNav();
  const services = useServices();
  const toast = useToast();
  const { settings, update } = useAppSettings();
  const t = strings.settings;
  const session = mergeSessionSettings(DEFAULT_SESSION_SETTINGS, settings.sessionDefaults, {});
  const [biometry, setBiometry] = useState<BiometryAvailability | undefined>(undefined);
  const [confirmLockOff, setConfirmLockOff] = useState<string[] | null>(null);

  useEffect(() => {
    let live = true;
    void services.lock.availability().then((a) => {
      if (live) setBiometry(a);
    });
    return () => {
      live = false;
    };
  }, [services.lock]);

  const setSession = <K extends keyof SessionSettings>(key: K, value: SessionSettings[K]) => {
    update({
      ...settings,
      sessionDefaults: diffFromDefaults(DEFAULT_SESSION_SETTINGS, { ...session, [key]: value }),
    });
  };

  const setLock = async (on: boolean) => {
    if (on) {
      // Prove the prompt works before relying on it.
      const ok = (await services.lock.prompt(strings.lock.reason, strings.lock.cancel)) === 'ok';
      if (ok) update({ ...settings, lock: { ...settings.lock, enabled: true } });
      return;
    }
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

        <section className="settings-group" aria-labelledby="set-session">
          <h2 id="set-session" className="section-title">
            {t.sessionDefaults}
          </h2>
          <p className="muted">{t.sessionDefaultsHint}</p>
          <Segmented<SessionSettings['fitMode']>
            label={t.fitMode}
            value={session.fitMode}
            onChange={(v) => setSession('fitMode', v)}
            options={(['fit-screen', 'fit-width', 'fit-height', 'one-to-one'] as const).map(
              (v) => ({
                value: v,
                label: t.fitModes[v] ?? v,
              }),
            )}
          />
          <Segmented<SessionSettings['pointerMode']>
            label={t.pointerMode}
            value={session.pointerMode}
            onChange={(v) => setSession('pointerMode', v)}
            options={(['direct', 'trackpad', 'touch'] as const).map((v) => ({
              value: v,
              label: t.pointerModes[v] ?? v,
            }))}
          />
          <RangeField
            label={t.pointerSpeed}
            value={session.pointerSpeed}
            min={POINTER_SPEED_MIN}
            max={POINTER_SPEED_MAX}
            step={0.25}
            onChange={(v) => setSession('pointerSpeed', v)}
            format={(v) => `${v.toFixed(2)}×`}
          />
          <Toggle
            label={t.matchDeviceSize}
            hint={t.matchDeviceSizeHint}
            checked={session.matchDeviceSize}
            onChange={(v) => setSession('matchDeviceSize', v)}
          />
          <Toggle
            label={t.naturalScroll}
            checked={session.naturalScroll}
            onChange={(v) => setSession('naturalScroll', v)}
          />
          <Toggle
            label={t.haptics}
            checked={session.haptics}
            onChange={(v) => setSession('haptics', v)}
          />
          <Toggle
            label={t.keepAwake}
            checked={session.keepAwake}
            onChange={(v) => setSession('keepAwake', v)}
          />
          <h3 className="subsection-title">{t.clipboard}</h3>
          <Toggle
            label={t.clipboardRemoteToDevice}
            checked={session.clipboardRemoteToDevice}
            onChange={(v) => setSession('clipboardRemoteToDevice', v)}
          />
          <Toggle
            label={t.clipboardAutoSendOnFocus}
            hint={t.clipboardAutoSendHint}
            checked={session.clipboardAutoSendOnFocus}
            onChange={(v) => setSession('clipboardAutoSendOnFocus', v)}
          />
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => update({ ...settings, sessionDefaults: {} })}
          >
            {t.resetDefaults}
          </button>
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
          <p className="muted">{t.disclaimer}</p>
          <h3 className="subsection-title">{t.privacyTitle}</h3>
          <p className="muted">{t.privacy}</p>
        </section>
      </div>
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
