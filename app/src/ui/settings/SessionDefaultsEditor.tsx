import { RangeField, Segmented, Toggle } from '../components/Form.tsx';
import { Icon } from '../components/Icon.tsx';
import type { ResolvedSessionSettings, SessionSettings } from '../session/settings.ts';
import {
  SETTING_SECTIONS,
  descriptorsIn,
  matchesQuery,
  rangeOf,
  settingPatch,
  DEFAULT_SUMMARY_CONTEXT,
  type ListEditor,
  type SettingDescriptor,
  type SettingSection,
  type SummaryContext,
} from '../session/settingsSchema.ts';
import { sessionStrings } from '../session/sessionStrings.ts';
import './sessionDefaults.css';

export interface SessionDefaultsEditorProps {
  readonly values: ResolvedSessionSettings;
  /** Keys that differ from the built-in defaults (marked, and what "Reset section" clears). */
  readonly changed: ReadonlySet<string>;
  readonly query: string;
  readonly onQuery: (q: string) => void;
  readonly onChange: (patch: Partial<SessionSettings>) => void;
  readonly onResetSection: (section: SettingSection) => void;
  readonly onResetAll: () => void;
  readonly onEditList: (editor: ListEditor) => void;
  /** Names for list summaries (key sets from the key library). */
  readonly summaryContext?: SummaryContext;
}

function Control({
  d,
  s,
  onChange,
  onEditList,
  ctx,
}: {
  d: SettingDescriptor;
  s: ResolvedSessionSettings;
  onChange: (patch: Partial<SessionSettings>) => void;
  onEditList: (editor: ListEditor) => void;
  ctx: SummaryContext;
}) {
  const value = s[d.key];
  const set = (v: unknown) => onChange(settingPatch(d.key, v));
  switch (d.control) {
    case 'switch': {
      const hint = d.hint?.(s);
      return (
        <Toggle
          label={d.label()}
          {...(hint ? { hint } : {})}
          checked={value === true}
          onChange={(v) => set(v)}
        />
      );
    }
    case 'choice': {
      const hint = d.hint?.(s);
      return (
        <>
          <Segmented<string>
            label={d.label()}
            value={String(value)}
            onChange={(v) => set(v)}
            options={d.options.map((o) => ({ value: o, label: d.optionLabel(o) }))}
          />
          {hint ? <p className="field-hint">{hint}</p> : null}
        </>
      );
    }
    case 'range': {
      const [min, max, step] = rangeOf(d);
      return (
        <RangeField
          label={d.label()}
          value={value as number}
          min={min}
          max={max}
          step={step}
          onChange={(v) => set(v)}
          format={d.format}
        />
      );
    }
    case 'list':
      return (
        <div className="list-setting">
          <span className="toggle-label">
            <span>{d.label()}</span>
            <span className="toggle-hint">{d.summary(s, ctx)}</span>
          </span>
          <button type="button" className="btn btn-small" onClick={() => onEditList(d.editor)}>
            <Icon name="edit" /> {sessionStrings.options.edit}
          </button>
        </div>
      );
  }
}

/**
 * App-wide session defaults (SET-1): every `SessionSettings` field, rendered from the shared
 * descriptor table so nothing can be left without a control. Pure props (no context), so
 * the completeness test can render it.
 */
export function SessionDefaultsEditor(p: SessionDefaultsEditorProps) {
  const o = sessionStrings.options;
  const sections = SETTING_SECTIONS.map((section) => ({
    section,
    items: descriptorsIn(section).filter((d) => matchesQuery(d, p.query, p.values)),
  })).filter((x) => x.items.length > 0);
  return (
    <div className="session-defaults">
      <div className="search" role="search">
        <Icon name="search" className="search-icon" />
        <input
          type="search"
          className="search-input"
          value={p.query}
          placeholder={o.search}
          aria-label={o.search}
          onChange={(e) => p.onQuery(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
        />
      </div>
      {sections.length === 0 ? <p className="muted">{o.noMatch}</p> : null}
      {sections.map(({ section, items }) => {
        const dirty = descriptorsIn(section).some((d) => p.changed.has(d.key));
        return (
          <section
            key={section}
            className="defaults-section"
            aria-labelledby={`sd-${section}`}
            data-section={section}
          >
            <div className="defaults-section-head">
              <h3 id={`sd-${section}`} className="subsection-title">
                {o.sections[section]}
              </h3>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                disabled={!dirty}
                onClick={() => p.onResetSection(section)}
              >
                {o.resetSection}
              </button>
            </div>
            <p className="field-hint">{o.sectionHints[section]}</p>
            {items.map((d) => (
              <div
                key={d.key}
                className={p.changed.has(d.key) ? 'setting setting-changed' : 'setting'}
                data-setting-key={d.key}
              >
                <Control
                  d={d}
                  s={p.values}
                  onChange={p.onChange}
                  onEditList={p.onEditList}
                  ctx={p.summaryContext ?? DEFAULT_SUMMARY_CONTEXT}
                />
              </div>
            ))}
          </section>
        );
      })}
      <button type="button" className="btn btn-block" onClick={p.onResetAll}>
        {o.resetAll}
      </button>
    </div>
  );
}
