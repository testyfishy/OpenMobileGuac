import { Screen } from '../components/Screen.tsx';
import { RangeField, Segmented, Toggle } from '../components/Form.tsx';
import { DEFAULT_SESSION_SETTINGS, type SessionSettings } from '../integration/session.ts';
import { useNav } from '../nav/NavContext.ts';
import { useAppSettings, useServices } from '../services/context.ts';
import { SOURCE_URL, strings } from '../strings.ts';
import type { ThemePreference } from '../theme/theme.ts';
import {
  POINTER_SPEED_MAX,
  POINTER_SPEED_MIN,
  diffFromDefaults,
  mergeSessionSettings,
} from './settingsModel.ts';

/** Global settings (SET-1) and About. */
export function SettingsScreen() {
  const nav = useNav();
  const services = useServices();
  const { settings, update } = useAppSettings();
  const t = strings.settings;
  const session = mergeSessionSettings(DEFAULT_SESSION_SETTINGS, settings.sessionDefaults, {});

  const setSession = <K extends keyof SessionSettings>(key: K, value: SessionSettings[K]) => {
    update({
      ...settings,
      sessionDefaults: diffFromDefaults(DEFAULT_SESSION_SETTINGS, { ...session, [key]: value }),
    });
  };

  const storage =
    services.secretStorage === 'secure'
      ? t.storageSecure
      : services.secretStorage === 'insecure-dev'
        ? t.storageDev
        : t.storageMemory;

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
            options={(['direct', 'trackpad'] as const).map((v) => ({
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
    </Screen>
  );
}
