import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { descriptorOf, type ListEditor, type SettingKey } from '../session/settingsSchema.ts';
import { sessionStrings } from '../session/sessionStrings.ts';
import { keySetNameIn } from '../session/keySetNames.ts';
import { GESTURES } from '../session/gestures.ts';
import { resolveToolbarItems } from '../session/toolbarItems.ts';
import { useBackInterceptor, useNav } from '../nav/NavContext.ts';
import { topRoute } from '../nav/navigation.ts';
import { useAppSettings, useProfilesVersion, useServices } from '../services/context.ts';
import {
  isAndroid,
  notificationPermission,
  requestNotificationPermission,
} from '../services/keepAlive.ts';
import {
  biometryMethod,
  platformName,
  saveTextFile,
  type BiometryAvailability,
  type BiometryMethod,
} from '../services/native.ts';
import { useSessions } from '../sessions/SessionsContext.ts';
import { SOURCE_URL, strings } from '../strings.ts';
import type { ThemePreference } from '../theme/theme.ts';
import {
  REMEMBER_POLICIES,
  rememberUnlockOn,
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
  type AskInUse,
  type OpenAgain,
  mergeSessionSettings,
  parseServerOptions,
  serverOptionsToJson,
} from './settingsModel.ts';
import {
  SETTINGS_CATEGORIES,
  categoryOf,
  searchSettings,
  splitHint,
  type AppItemId,
  type SearchResult,
  type SettingsPageId,
} from './settingsCatalog.ts';
import { MoreHint } from './SessionDefaultsEditor.tsx';
import { SettingsPageBody } from './SettingsPageBody.tsx';
import { SessionListEditor } from './SessionListEditors.tsx';
import {
  allEntries,
  entriesOverriding,
  entriesOverridingPage,
  overrideList,
  overrideNames,
} from './connectionLayers.ts';
import { useConnectionInventory } from './useConnectionInventory.ts';
import './settingsPages.css';

function durationLabel(seconds: number | null): string {
  if (seconds === null) return strings.common.never;
  if (seconds === 0) return strings.common.immediately;
  if (seconds >= 3600 && seconds % 3600 === 0) return strings.common.hours(seconds / 3600);
  return seconds < 60 ? strings.common.seconds(seconds) : strings.common.minutes(seconds / 60);
}

/** A hint paragraph: the first sentence of a long one, the rest behind "More". */
function Hint({ text }: { text: string }) {
  const [lead, rest] = splitHint(text);
  return (
    <>
      <p className="field-hint">{lead}</p>
      <MoreHint text={rest} />
    </>
  );
}

/** A switch whose long hint shows its first sentence, the rest behind "More". */
function LongToggle(props: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  const [lead, rest] = splitHint(props.hint);
  return (
    <>
      <Toggle
        label={props.label}
        hint={lead}
        checked={props.checked}
        disabled={props.disabled ?? false}
        onChange={props.onChange}
      />
      <MoreHint text={rest} />
    </>
  );
}

interface OpenPage {
  readonly id: SettingsPageId;
  /** `data-setting-key` / `data-setting-id` to scroll to and highlight. */
  readonly focus?: string;
}

/**
 * Settings: a short list of categories (SET-1), each opening a sub-page, with one search
 * across every setting. Security (SRV-6), sessions (MUL-1, T2.1), key library, data, About.
 * Sub-pages are local to this screen: Back, Android back and Escape return to the list, which
 * keeps its scroll position and the search.
 */
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
  const tp = t.pages;
  const session = normalizeSessionSettings(
    mergeSessionSettings(DEFAULT_SESSION_SETTINGS, settings.sessionDefaults, {}),
  );
  const changed = useMemo(
    () => new Set(Object.keys(settings.sessionDefaults)),
    [settings.sessionDefaults],
  );
  const [query, setQuery] = useState('');
  const [page, setPage] = useState<OpenPage | null>(null);
  const [listEditor, setListEditor] = useState<ListEditor | null>(null);
  const [biometry, setBiometry] = useState<BiometryAvailability | undefined>(undefined);
  const [method, setMethod] = useState<BiometryMethod>('generic');
  const [confirmLockOff, setConfirmLockOff] = useState<string[] | null>(null);
  const sessions = useSessions();
  const { bump } = useProfilesVersion();
  const [signOut, setSignOut] = useState<{ removeServers: boolean; busy: boolean } | null>(null);
  const [keepAliveAsk, setKeepAliveAsk] = useState(false);
  const [keepAliveDenied, setKeepAliveDenied] = useState(false);
  const android = isAndroid();
  const ios = platformName() === 'ios';
  const openSessions = sessions.state.sessions.length;
  // Settings per connection: who keeps its own values (counts, "Also set for", Pointer mode).
  const inventory = useConnectionInventory();
  const entries = useMemo(() => allEntries(inventory ?? []), [inventory]);

  // ---- Sub-page navigation: back returns to the list (only while Settings is on top).
  const rootRef = useRef<HTMLDivElement>(null);
  const listScroll = useRef(0);
  const opener = useRef<string | null>(null);
  const isTop = topRoute(nav.state).name === 'settings';
  const scroller = () => rootRef.current?.closest('.screen-body') ?? null;
  const openPage = (next: OpenPage, from: string) => {
    listScroll.current = scroller()?.scrollTop ?? 0;
    opener.current = from;
    setPage(next);
  };
  const closePage = () => setPage(null);
  useBackInterceptor(page !== null && isTop, closePage);

  useLayoutEffect(() => {
    const body = scroller();
    if (page) {
      if (body) body.scrollTop = 0;
      return;
    }
    if (body) body.scrollTop = listScroll.current;
  }, [page]);

  // Back on the list: focus the row that opened the page (after Screen focused its title).
  useEffect(() => {
    if (page || !opener.current) return undefined;
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-opener="${opener.current}"]`);
    opener.current = null;
    const timer = setTimeout(() => el?.focus({ preventScroll: true }), 0);
    return () => clearTimeout(timer);
  }, [page]);

  // Opened from a search result: scroll to the setting, open "Advanced" if needed, flash it.
  useEffect(() => {
    if (!page?.focus) return undefined;
    const root = rootRef.current;
    if (!root) return undefined;
    const sel = `[data-setting-key="${page.focus}"], [data-setting-id="${page.focus}"]`;
    const el = root.querySelector<HTMLElement>(sel);
    if (!el) return undefined;
    const details = el.closest('details');
    if (details) details.open = true;
    // A control that is hidden right now (e.g. "Lock after" while the lock is off): its group.
    const target = el.childElementCount > 0 ? el : (el.closest('section') ?? el);
    target.scrollIntoView({ block: 'center' });
    target.classList.add('setting-flash');
    // After the screen has focused its title: move focus on to the control itself.
    const focusTimer = setTimeout(() => {
      target.querySelector<HTMLElement>('input, button, select')?.focus({ preventScroll: true });
    }, 0);
    const timer = setTimeout(() => target.classList.remove('setting-flash'), 2000);
    return () => {
      clearTimeout(focusTimer);
      clearTimeout(timer);
      target.classList.remove('setting-flash');
    };
  }, [page]);

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
    void biometryMethod().then((m) => {
      if (live) setMethod(m);
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

  const resetKeys = (keys: readonly SettingKey[]) => {
    const drop = new Set<string>(keys);
    const cur = settingsRef.current;
    write({
      ...cur,
      sessionDefaults: Object.fromEntries(
        Object.entries(cur.sessionDefaults).filter(([k]) => !drop.has(k)),
      ),
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
  // "Ask for Face ID / fingerprint …": turning it off is itself protected, like turning the
  // app lock off, so whoever holds the unlocked phone cannot simply switch the check off.
  const setRememberUnlock = async (on: boolean) => {
    if (!on) {
      const ok =
        (await services.lock.prompt(
          strings.lock.connectionUnlockOffReason,
          strings.lock.cancel,
        )) === 'ok';
      if (!ok) return;
    }
    const cur = settingsRef.current;
    write({ ...cur, rememberConnectionUnlock: on ? 'on' : 'off' });
  };
  const forgetConnectionPasswords = async () => {
    await services.connectionSecrets.forgetAll(await secretProfileIds());
    services.log.info('auth', 'remembered connection passwords forgotten');
    toast.show(t.connectionPasswordsForgotten);
  };

  const keySetName = (id: string) => keySetNameIn(settings.keys, id);

  /** The control of each app-level item (the catalogue says where it is shown). */
  const renderApp = (id: AppItemId): ReactNode => {
    switch (id) {
      case 'theme':
        return (
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
        );
      case 'language':
        return (
          <Segmented<LanguagePreference>
            label={t.language}
            value={settings.language}
            onChange={(language) => update({ ...settings, language })}
            options={[
              { value: 'system', label: t.languageSystem },
              ...LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] })),
            ]}
          />
        );
      case 'showDemo':
        return (
          <>
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
            <Hint text={t.showDemoHint} />
          </>
        );
      case 'introduction':
        return (
          <div className="link-list">
            <button
              type="button"
              className="row-main link-row"
              onClick={() => update({ ...settings, onboardingDone: false })}
            >
              <Icon name="info" /> <span className="row-text">{t.introduction}</span>
            </button>
          </div>
        );
      case 'diagnostics':
        return (
          <div className="link-list">
            <button
              type="button"
              className="row-main link-row"
              onClick={() => nav.push({ name: 'diagnostics' })}
            >
              <Icon name="bug" /> <span className="row-text">{t.diagnostics}</span>
              <Icon name="chevron-right" className="row-chevron" />
            </button>
          </div>
        );
      case 'about':
        return (
          <>
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
            </dl>
            <p className="muted">{t.disclaimer}</p>
          </>
        );
      case 'resetAllSession':
        return (
          <div className="list-setting">
            <span className="toggle-label">
              <span>{tp.resetAllSession}</span>
              <span className="toggle-hint">{tp.resetAllSessionHint}</span>
            </span>
            <button
              type="button"
              className="btn btn-small btn-danger-ghost"
              data-action="reset-all-session"
              disabled={changed.size === 0}
              onClick={() => update({ ...settings, sessionDefaults: {} })}
            >
              {tp.reset}
            </button>
          </div>
        );
      case 'keySets':
        return (
          <div className="list-setting">
            <span className="toggle-label">
              <span>{t.keySetsButton}</span>
              <span className="toggle-hint">
                {t.keySetsSummary(settings.keys.sets.length)} · {keySetName(session.keySet)}
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
        );
      case 'combos':
        return (
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
        );
      case 'maxSessions':
        return (
          <>
            <RangeField
              label={t.maxSessions}
              value={settings.maxSessions}
              min={MAX_SESSIONS_MIN}
              max={MAX_SESSIONS_MAX}
              step={1}
              onChange={(v) => update({ ...settings, maxSessions: v })}
              format={(v) => String(v)}
            />
            <Hint text={t.maxSessionsHint} />
          </>
        );
      case 'openAgain':
        return (
          <>
            <Segmented<OpenAgain>
              label={t.openAgain}
              value={settings.openAgain}
              onChange={(v) => update({ ...settings, openAgain: v })}
              options={[
                { value: 'ask', label: t.openAgainAsk },
                { value: 'switch', label: t.openAgainSwitch },
                { value: 'new', label: t.openAgainNew },
              ]}
            />
            <Hint text={t.openAgainHint} />
          </>
        );
      case 'askInUse':
        return (
          <>
            <Segmented<AskInUse>
              label={t.askInUse}
              value={settings.askInUse}
              onChange={(v) => update({ ...settings, askInUse: v })}
              options={[
                { value: 'in-use', label: t.askInUseInUse },
                { value: 'always', label: t.askInUseAlways },
                { value: 'never', label: t.askInUseNever },
              ]}
            />
            <Hint text={t.askInUseHint} />
          </>
        );
      case 'backgroundDisconnect':
        return (
          <>
            <Segmented<string>
              label={t.backgroundDisconnect}
              value={String(settings.backgroundDisconnectSeconds)}
              onChange={(v) =>
                update({
                  ...settings,
                  backgroundDisconnectSeconds: v === 'null' ? null : Number(v),
                })
              }
              options={BACKGROUND_DISCONNECT_CHOICES.map((s) => ({
                value: String(s),
                label: durationLabel(s),
              }))}
            />
            <Hint text={t.backgroundDisconnectHint} />
            {ios ? <Hint text={t.backgroundDisconnectIos} /> : null}
          </>
        );
      case 'keepAlive':
        return (
          <>
            <LongToggle
              label={t.keepAlive}
              hint={
                android ? t.keepAliveHintAndroid : ios ? t.keepAliveHintIos : t.keepAliveHintWeb
              }
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
          </>
        );
      case 'thumbnails':
        return (
          <Toggle
            label={t.thumbnails}
            hint={t.thumbnailsHint}
            checked={settings.thumbnails}
            onChange={(v) => {
              update({ ...settings, thumbnails: v });
              if (!v) void services.profiles.clearThumbnails();
            }}
          />
        );
      case 'clearThumbnails':
        return (
          <button
            type="button"
            className="btn btn-ghost"
            data-action="clear-thumbnails"
            onClick={() =>
              void services.profiles.clearThumbnails().then(() => toast.show(t.thumbnailsCleared))
            }
          >
            {t.clearThumbnails}
          </button>
        );
      case 'lock':
        return (
          <LongToggle
            label={t.lockEnable}
            hint={
              biometry === 'web'
                ? t.lockUnavailableWeb
                : biometry === 'no-device-security'
                  ? t.lockUnavailableDevice
                  : biometry === 'error'
                    ? t.lockUnavailableError
                    : t.lockHint
            }
            checked={settings.lock.enabled && lockAvailable}
            disabled={!lockAvailable}
            onChange={(v) => void setLock(v)}
          />
        );
      case 'lockAfter':
        return settings.lock.enabled && lockAvailable ? (
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
        ) : null;
      case 'rememberPolicy':
        return (
          <>
            <Segmented<RememberPolicy>
              label={t.rememberConnection}
              value={settings.rememberConnectionPasswords}
              onChange={setRememberPolicy}
              options={REMEMBER_POLICIES.map((p) => ({
                value: p,
                label: t.rememberConnectionOptions[p],
              }))}
            />
            <Hint text={t.rememberConnectionHint} />
            {settings.rememberConnectionPasswords === 'device' &&
            services.secretStorage === 'memory' ? (
              <p className="field-hint">{t.rememberConnectionMemoryOnly}</p>
            ) : null}
          </>
        );
      case 'rememberUnlock':
        return settings.rememberConnectionPasswords !== 'never' ? (
          <LongToggle
            label={t.rememberConnectionUnlock(t.biometryMethods[method])}
            hint={
              lockAvailable || biometry === undefined
                ? t.rememberConnectionUnlockHint
                : t.rememberConnectionUnlockUnavailable
            }
            checked={rememberUnlockOn(
              settings.rememberConnectionUnlock,
              settings.rememberConnectionPasswords,
              lockAvailable,
            )}
            disabled={!lockAvailable}
            onChange={(v) => void setRememberUnlock(v)}
          />
        ) : null;
      case 'serverSignOut':
        return (
          <>
            <Segmented<string>
              label={t.serverSignOut}
              value={String(settings.serverSignOutAfterSeconds)}
              onChange={(v) =>
                update({
                  ...settings,
                  serverSignOutAfterSeconds: v === 'null' ? null : Number(v),
                })
              }
              options={SERVER_SIGN_OUT_CHOICES.map((s) => ({
                value: String(s),
                label: durationLabel(s),
              }))}
            />
            <Hint text={t.serverSignOutHint} />
          </>
        );
      case 'privacy':
        return <p className="muted">{t.privacy}</p>;
      case 'storage':
        return (
          <dl className="about">
            <div>
              <dt>{t.storageTitle}</dt>
              <dd>{storage}</dd>
            </div>
          </dl>
        );
      case 'forgetPasswords':
        return (
          <button
            type="button"
            className="btn btn-ghost"
            data-action="forget-connection-passwords"
            onClick={() => void forgetConnectionPasswords()}
          >
            {t.forgetConnectionPasswords}
          </button>
        );
      case 'signOutAll':
        return (
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
        );
    }
  };

  /** One line under each category: what is inside, or its key values. */
  const summaryOf = (id: SettingsPageId): string => {
    const opt = (key: SettingKey) => {
      const d = descriptorOf(key);
      return d?.control === 'choice' ? d.optionLabel(String(session[key])) : '';
    };
    const join = (...parts: string[]) => parts.filter(Boolean).join(' · ');
    switch (id) {
      case 'general':
        return join(
          { system: t.themeSystem, light: t.themeLight, dark: t.themeDark }[settings.theme],
          settings.language === 'system' ? t.languageSystem : LOCALE_NAMES[settings.language],
        );
      case 'display':
        return join(opt('fitMode'), opt('quality'));
      case 'toolbar':
        return join(
          opt('toolbarStyle'),
          sessionStrings.options.toolbarItemsSummary(
            resolveToolbarItems(session.toolbarItems).length,
          ),
        );
      case 'pointer': {
        const speed = descriptorOf('pointerSpeed');
        return speed?.control === 'range'
          ? tp.summaries.pointer(opt('pointerMode'), speed.format(session.pointerSpeed))
          : opt('pointerMode');
      }
      case 'gestures': {
        const toggles = GESTURES.flatMap((g) => (g.toggle ? [g.toggle] : []));
        return tp.summaries.gestures(
          toggles.filter((k) => session[k] === true).length,
          toggles.length,
        );
      }
      case 'keyboard':
        return tp.summaries.keyboard(keySetName(session.keySet), settings.keys.combos.length);
      case 'sessions':
        return join(
          tp.summaries.sessions(settings.maxSessions),
          { ask: t.openAgainAsk, switch: t.openAgainSwitch, new: t.openAgainNew }[
            settings.openAgain
          ],
        );
      case 'security':
        return join(
          settings.lock.enabled && lockAvailable ? tp.summaries.lockOn : tp.summaries.lockOff,
          tp.summaries.remember(t.rememberConnectionOptions[settings.rememberConnectionPasswords]),
        );
      case 'connections': {
        const n = entriesOverriding(entries).length;
        return n > 0 ? t.perConnection.summaryCount(n) : t.perConnection.summaryNone;
      }
      case 'backup':
        return settings.autoBackup.enabled
          ? tp.summaries.autoBackupOn(
              strings.backup.frequencies[settings.autoBackup.frequency] ??
                settings.autoBackup.frequency,
            )
          : tp.summaries.autoBackupOff;
    }
  };

  const open = (id: SettingsPageId, from: string, focus?: string) => {
    const c = categoryOf(id);
    if (c.route) {
      nav.push({ name: c.route });
      return;
    }
    openPage(focus ? { id, focus } : { id }, from);
  };

  const openResult = (r: SearchResult) => {
    const from = `r:${r.ref}`;
    if (r.ref.startsWith('route:')) {
      nav.push({ name: r.page === 'backup' ? 'backup' : 'diagnostics' });
      return;
    }
    const focus = r.ref.startsWith('app:') ? r.ref.slice(4) : r.ref;
    open(r.page, from, focus);
  };

  const results = query.trim()
    ? searchSettings(query, {
        values: session,
        biometryLabel: t.biometryMethods[method],
        alsoSetFor: (key) => overrideNames(entries, key) || undefined,
      })
    : [];

  const editorAndDialogs = (
    <>
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
    </>
  );

  if (page) {
    const c = categoryOf(page.id);
    const hasSession = c.groups.some((g) => g.items.some((r) => !r.startsWith('app:')));
    const gestureHint = splitHint(sessionStrings.options.sectionHints.gestures);
    const pc = t.perConnection;
    const ownHere = entriesOverridingPage(entries, page.id).length;
    const pageId = page.id;
    return (
      <Screen key={`page-${page.id}`} title={c.title()} onBack={closePage}>
        <div ref={rootRef}>
          <SettingsPageBody
            page={page.id}
            values={session}
            changed={changed}
            onChange={setSession}
            onEditList={setListEditor}
            summaryContext={{ keySetName }}
            renderApp={renderApp}
            onResetKeys={resetKeys}
            below={(key) =>
              key === 'pointerMode' && entriesOverriding(entries, [key]).length > 0 ? (
                <p className="field-hint layer-overrides" data-overrides={key}>
                  {pc.overriddenOn(overrideList(entries, key, { keySetName }))}
                </p>
              ) : null
            }
            intro={
              hasSession ? (
                <>
                  <p className="muted defaults-line" data-own-here={ownHere}>
                    {pc.defaultsLine} {ownHere > 0 ? pc.defaultsOwn(ownHere) : pc.defaultsNoneOwn}{' '}
                    <button
                      type="button"
                      className="inline-link"
                      data-action="per-connection"
                      onClick={() =>
                        nav.push(
                          ownHere > 0
                            ? { name: 'connection-settings', page: pageId }
                            : { name: 'connection-settings' },
                        )
                      }
                    >
                      {pc.seeConnections}
                    </button>
                  </p>
                  {page.id === 'gestures' ? (
                    <>
                      <p className="field-hint">{gestureHint[0]}</p>
                      <MoreHint text={gestureHint[1]} />
                    </>
                  ) : null}
                </>
              ) : null
            }
          />
        </div>
        {editorAndDialogs}
      </Screen>
    );
  }

  return (
    <Screen
      key="settings-top"
      title={t.title}
      onBack={nav.back}
      toolbar={
        <div className="search" role="search">
          <Icon name="search" className="search-icon" />
          <input
            type="search"
            className="search-input"
            value={query}
            placeholder={tp.search}
            aria-label={tp.search}
            onChange={(e) => setQuery(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
          />
          {query ? (
            <button
              type="button"
              className="icon-btn search-clear"
              aria-label={strings.common.close}
              onClick={() => setQuery('')}
            >
              <Icon name="close" />
            </button>
          ) : null}
        </div>
      }
    >
      <div ref={rootRef}>
        {query.trim() ? (
          <>
            <p className="muted settings-results-count" role="status">
              {results.length > 0 ? tp.resultCount(results.length) : tp.noMatch}
            </p>
            <ul className="settings-results">
              {results.map((r) => (
                <li key={r.ref}>
                  <button
                    type="button"
                    className="row-main settings-result"
                    data-opener={`r:${r.ref}`}
                    data-result={r.ref}
                    onClick={() => openResult(r)}
                  >
                    <span className="row-text">
                      <span className="row-title">{r.label}</span>
                      <span className="row-subtitle">{r.where}</span>
                      {r.alsoSetFor ? (
                        <span className="row-subtitle settings-result-also">
                          {t.perConnection.alsoSetFor(r.alsoSetFor)}
                        </span>
                      ) : null}
                    </span>
                    <Icon name="chevron-right" className="row-chevron" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <nav aria-label={t.title}>
            <ul className="settings-cats">
              {SETTINGS_CATEGORIES.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="row-main settings-cat"
                    data-opener={`c:${c.id}`}
                    data-category={c.id}
                    onClick={() => open(c.id, `c:${c.id}`)}
                  >
                    <span className="row-icon">
                      <Icon name={c.icon} />
                    </span>
                    <span className="row-text">
                      <span className="row-title">{c.title()}</span>
                      <span className="row-subtitle">{summaryOf(c.id)}</span>
                    </span>
                    <Icon name="chevron-right" className="row-chevron" />
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
      {editorAndDialogs}
    </Screen>
  );
}
