import type { ReactNode } from 'react';
import type { SettingKey } from '../session/settingsSchema.ts';
import { descriptorOf } from '../session/settingsSchema.ts';
import { strings } from '../strings.ts';
import {
  categoryOf,
  isAppRef,
  sessionKeysOf,
  type AppItemId,
  type ItemRef,
  type SettingsGroup,
  type SettingsPageId,
} from './settingsCatalog.ts';
import {
  GestureAreaRows,
  SessionSettingBlock,
  type SessionBlockProps,
} from './SessionDefaultsEditor.tsx';
import './settingsPages.css';

export interface SettingsPageBodyProps extends SessionBlockProps {
  readonly page: SettingsPageId;
  /** The control of an app-level item (lock, theme, sign-out …). */
  readonly renderApp: (id: AppItemId) => ReactNode;
  /** "Reset this page to the defaults": drops these keys from the app's session defaults. */
  readonly onResetKeys: (keys: SettingKey[]) => void;
  /** Shown above the first group. */
  readonly intro?: ReactNode;
}

function Item({ r, p }: { r: ItemRef; p: SettingsPageBodyProps }) {
  if (isAppRef(r)) {
    const id = r.slice(4) as AppItemId;
    return (
      <div className="setting" data-setting-id={id}>
        {p.renderApp(id)}
      </div>
    );
  }
  const d = descriptorOf(r);
  return d ? <SessionSettingBlock d={d} p={p} /> : null;
}

function GroupItems({ g, p }: { g: SettingsGroup; p: SettingsPageBodyProps }) {
  if (g.gestureArea) return <GestureAreaRows area={g.gestureArea} p={p} />;
  return (
    <>
      {g.items.map((r) => (
        <Item key={r} r={r} p={p} />
      ))}
    </>
  );
}

/**
 * One Settings category: its groups under small headings, the rarely needed ones collapsed
 * under "Advanced", and destructive actions last under "Reset and remove". Pure props, so the
 * completeness tests can render every page.
 */
export function SettingsPageBody(p: SettingsPageBodyProps) {
  const t = strings.settings.pages;
  const c = categoryOf(p.page);
  const keys = sessionKeysOf(p.page);
  const dirty = keys.some((k) => p.changed.has(k));
  const normal = c.groups.filter((g) => !g.advanced && !g.danger);
  const advanced = c.groups.filter((g) => g.advanced);
  const danger = c.groups.filter((g) => g.danger);
  const id = (g: string) => `sp-${p.page}-${g}`;
  return (
    <div className="form settings settings-page" data-page={p.page}>
      {p.intro}
      {normal.map((g) => (
        <section key={g.id} className="settings-group" aria-labelledby={id(g.id)} data-group={g.id}>
          <h2 id={id(g.id)} className="section-title">
            {g.title()}
          </h2>
          <GroupItems g={g} p={p} />
        </section>
      ))}
      {advanced.length > 0 ? (
        <details className="settings-group settings-advanced" data-group="advanced">
          <summary className="section-title">{t.advanced}</summary>
          {advanced.map((g) => (
            <GroupItems key={g.id} g={g} p={p} />
          ))}
        </details>
      ) : null}
      {danger.length > 0 || keys.length > 0 ? (
        <section
          className="settings-group settings-danger"
          aria-labelledby={id('danger')}
          data-group="danger"
        >
          <h2 id={id('danger')} className="section-title">
            {t.danger}
          </h2>
          {danger.map((g) => (
            <GroupItems key={g.id} g={g} p={p} />
          ))}
          {keys.length > 0 ? (
            <div className="list-setting" data-action="reset-page">
              <span className="toggle-label">
                <span>{t.resetPage}</span>
                <span className="toggle-hint">{t.resetPageHint}</span>
              </span>
              <button
                type="button"
                className="btn btn-small btn-danger-ghost"
                disabled={!dirty}
                onClick={() => p.onResetKeys(keys)}
              >
                {t.reset}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
