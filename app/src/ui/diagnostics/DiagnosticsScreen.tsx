import { useMemo, useState, useSyncExternalStore } from 'react';
import {
  describeNetwork,
  describeWebView,
  parseWebView,
} from '../../core/diagnostics/deviceInfo.ts';
import {
  LOG_LEVELS,
  filterByLevel,
  formatEntry,
  formatLog,
  type LogLevel,
} from '../../core/diagnostics/log.ts';
import { Segmented, Toggle } from '../components/Form.tsx';
import { Icon } from '../components/Icon.tsx';
import { Screen } from '../components/Screen.tsx';
import { useToast } from '../components/toastContext.ts';
import { activeLocale } from '../strings.ts';
import { useNav } from '../nav/NavContext.ts';
import { useAppSettings, useServices } from '../services/context.ts';
import { copyText, platformName, shareText } from '../services/native.ts';
import { useSessions } from '../sessions/SessionsContext.ts';
import { strings } from '../strings.ts';

/** DIAG-1: local-only log viewer and device details for bug reports. */
export function DiagnosticsScreen() {
  const nav = useNav();
  const services = useServices();
  const toast = useToast();
  const sessions = useSessions();
  const { settings, update } = useAppSettings();
  const d = strings.diagnostics;
  const entries = useSyncExternalStore(services.log.subscribe, services.log.entries);
  const [level, setLevel] = useState<LogLevel>('info');
  const hideHosts = settings.logHideHosts;
  const shown = useMemo(() => filterByLevel(entries, level).slice().reverse(), [entries, level]);

  const device = useMemo(() => {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    return {
      platform: platformName(),
      webView: describeWebView(parseWebView(ua)),
      screen:
        typeof window !== 'undefined'
          ? `${window.screen.width}×${window.screen.height} @${window.devicePixelRatio}x, viewport ${window.innerWidth}×${window.innerHeight}`
          : '',
      locale: `${activeLocale()} (${typeof navigator !== 'undefined' ? navigator.language : ''})`,
      ua,
    };
  }, []);

  const report = () =>
    [
      `${strings.appName} ${__APP_VERSION__}`,
      `${d.platform}: ${device.platform}`,
      `${d.webView}: ${device.webView}`,
      `${d.screen}: ${device.screen}`,
      `${d.locale}: ${device.locale}`,
      `${d.userAgent}: ${device.ua}`,
      `${d.sessionsTitle}: ${sessions.state.sessions.length}`,
      `${d.network}: ${describeNetwork(typeof navigator !== 'undefined' ? navigator : undefined, services.restPath())}`,
      '',
      formatLog(entries, { hideHosts, minLevel: level }),
    ].join('\n');

  const copy = async () => {
    const ok = await copyText(report());
    toast.show(ok ? d.copied : strings.errors.unknown.title);
  };
  const share = async () => {
    const r = await shareText(`${strings.appName} diagnostics`, report());
    if (r === 'copied') toast.show(d.copied);
  };

  return (
    <Screen title={d.title} onBack={nav.back}>
      <div className="form settings">
        <p className="muted">{d.privacy}</p>
        <section className="settings-group" aria-labelledby="dg-device">
          <h2 id="dg-device" className="section-title">
            {d.deviceTitle}
          </h2>
          <dl className="about">
            <div>
              <dt>{d.appVersion}</dt>
              <dd>{__APP_VERSION__}</dd>
            </div>
            <div>
              <dt>{d.platform}</dt>
              <dd>{device.platform}</dd>
            </div>
            <div>
              <dt>{d.webView}</dt>
              <dd>{device.webView}</dd>
            </div>
            <div>
              <dt>{d.screen}</dt>
              <dd>{device.screen}</dd>
            </div>
            <div>
              <dt>{d.locale}</dt>
              <dd>{device.locale}</dd>
            </div>
            <div>
              <dt>{d.network}</dt>
              <dd>
                {describeNetwork(
                  typeof navigator !== 'undefined' ? navigator : undefined,
                  services.restPath(),
                )}
              </dd>
            </div>
            <div>
              <dt>{d.sessionsTitle}</dt>
              <dd>{d.sessionsOpen(sessions.state.sessions.length)}</dd>
            </div>
          </dl>
          <p className="field-hint">{d.sessionStatsUnavailable}</p>
        </section>

        <section className="settings-group" aria-labelledby="dg-log">
          <h2 id="dg-log" className="section-title">
            {d.logTitle}
          </h2>
          <Segmented<LogLevel>
            label={d.level}
            value={level}
            onChange={setLevel}
            options={LOG_LEVELS.map((l) => ({ value: l, label: d.levels[l] ?? l }))}
          />
          <Toggle
            label={d.hideHosts}
            hint={d.hideHostsHint}
            checked={hideHosts}
            onChange={(v) => update({ ...settings, logHideHosts: v })}
          />
          <div className="button-row">
            <button type="button" className="btn" onClick={() => void copy()}>
              <Icon name="copy" /> {d.copy}
            </button>
            <button type="button" className="btn" onClick={() => void share()}>
              <Icon name="share" /> {d.share}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => services.log.clear()}>
              {d.clear}
            </button>
          </div>
          {shown.length === 0 ? (
            <p className="muted">{d.empty}</p>
          ) : (
            <ol className="log-list" aria-label={d.logTitle}>
              {shown.map((e) => (
                <li key={e.seq} className={`log-${e.level}`}>
                  {formatEntry(e, hideHosts)}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </Screen>
  );
}
