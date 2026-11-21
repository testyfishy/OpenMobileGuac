import { RangeField, Segmented, Toggle } from '../components/Form.tsx';
import { Icon } from '../components/Icon.tsx';
import type { ResolvedSessionSettings, SessionSettings } from '../session/settings.ts';
import {
  SETTING_SECTIONS,
  descriptorOf,
  descriptorsIn,
  matchesGesture,
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
import {
  GESTURES,
  GESTURE_AREAS,
  gestureForKey,
  type GestureId,
  type GestureInfo,
} from '../session/gestures.ts';
import { GestureFigure } from '../session/GestureFigure.tsx';
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

/** One setting's control, marked when changed from the built-in default. */
function SettingBlock({ d, p }: { d: SettingDescriptor; p: SessionDefaultsEditorProps }) {
  return (
    <div
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
  );
}

/**
 * One gesture: a looping picture of the movement, its name and what it does, its on / off
 * switch (or "Always on" and why), then the settings that tune it.
 */
function GestureRow({ g, p }: { g: GestureInfo; p: SessionDefaultsEditorProps }) {
  const t = sessionStrings.gestures;
  const item = t.items[g.id];
  const toggle = g.toggle ? descriptorOf(g.toggle) : undefined;
  const why = (t.why as Partial<Record<GestureId, string>>)[g.id];
  const s = p.values;
  const noTrackpadDrag = g.id === 'longPress' && !s.gestureLongPress && !s.tapDrag;
  return (
    <div className="gesture-row" data-gesture={g.id}>
      <div className="gesture-head">
        <GestureFigure kind={g.figure} />
        <div className="gesture-main">
          {toggle ? (
            <div
              className={p.changed.has(toggle.key) ? 'setting setting-changed' : 'setting'}
              data-setting-key={toggle.key}
            >
              <Toggle
                label={item.name}
                hint={item.desc}
                checked={s[toggle.key] === true}
                onChange={(v) => p.onChange(settingPatch(toggle.key, v))}
              />
            </div>
          ) : (
            <div className="gesture-text">
              <span className="gesture-name">
                <span>{item.name}</span>
                {g.alwaysOn ? <span className="gesture-always">{t.alwaysOn}</span> : null}
              </span>
              <span className="toggle-hint">{item.desc}</span>
              {why ? <span className="toggle-hint gesture-why">{why}</span> : null}
            </div>
          )}
        </div>
      </div>
      {noTrackpadDrag ? <p className="field-hint gesture-warning">{t.noTrackpadDrag}</p> : null}
      {g.settings.map((k) => {
        const d = descriptorOf(k);
        return d ? <SettingBlock key={k} d={d} p={p} /> : null;
      })}
    </div>
  );
}

function GestureRows({ p }: { p: SessionDefaultsEditorProps }) {
  const t = sessionStrings.gestures;
  const leftovers = descriptorsIn('gestures').filter(
    (d) => !gestureForKey(d.key) && matchesQuery(d, p.query, p.values),
  );
  return (
    <>
      {GESTURE_AREAS.map((area) => {
        const rows = GESTURES.filter(
          (g) => g.area === area && matchesGesture(g, p.query, p.values),
        );
        if (rows.length === 0) return null;
        return (
          <div key={area} className="gesture-area" data-gesture-area={area}>
            <h4 className="gesture-area-title">{t.areas[area]}</h4>
            {rows.map((g) => (
              <GestureRow key={g.id} g={g} p={p} />
            ))}
          </div>
        );
      })}
      {leftovers.map((d) => (
        <SettingBlock key={d.key} d={d} p={p} />
      ))}
    </>
  );
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
  })).filter(
    (x) =>
      x.items.length > 0 ||
      (x.section === 'gestures' && GESTURES.some((g) => matchesGesture(g, p.query, p.values))),
  );
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
            {section === 'gestures' ? (
              <GestureRows p={p} />
            ) : (
              items.map((d) => <SettingBlock key={d.key} d={d} p={p} />)
            )}
          </section>
        );
      })}
      <button type="button" className="btn btn-block" onClick={p.onResetAll}>
        {o.resetAll}
      </button>
    </div>
  );
}
