import { RangeField, Segmented, Toggle } from '../components/Form.tsx';
import { Icon } from '../components/Icon.tsx';
import type { ResolvedSessionSettings, SessionSettings } from '../session/settings.ts';
import {
  descriptorOf,
  rangeOf,
  settingPatch,
  DEFAULT_SUMMARY_CONTEXT,
  type ListEditor,
  type SettingDescriptor,
  type SummaryContext,
} from '../session/settingsSchema.ts';
import { sessionStrings } from '../session/sessionStrings.ts';
import {
  GESTURES,
  type GestureArea,
  type GestureId,
  type GestureInfo,
} from '../session/gestures.ts';
import { GestureFigure } from '../session/GestureFigure.tsx';
import { strings } from '../strings.ts';
import { splitHint } from './settingsCatalog.ts';
import './sessionDefaults.css';

/** What a session setting's control needs: pure props (no context), so tests can render it. */
export interface SessionBlockProps {
  readonly values: ResolvedSessionSettings;
  /** Keys that differ from the built-in defaults (marked with a bar). */
  readonly changed: ReadonlySet<string>;
  readonly onChange: (patch: Partial<SessionSettings>) => void;
  readonly onEditList: (editor: ListEditor) => void;
  /** Names for list summaries (key sets from the key library). */
  readonly summaryContext?: SummaryContext;
}

/** The rest of a long hint, collapsed (outside any label, so tapping it never toggles). */
export function MoreHint({ text }: { text: string }) {
  if (!text) return null;
  return (
    <details className="hint-more">
      <summary>{strings.settings.pages.more}</summary>
      <p className="field-hint">{text}</p>
    </details>
  );
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
      const [lead, rest] = splitHint(d.hint?.(s) ?? '');
      return (
        <>
          <Toggle
            label={d.label()}
            {...(lead ? { hint: lead } : {})}
            checked={value === true}
            onChange={(v) => set(v)}
          />
          <MoreHint text={rest} />
        </>
      );
    }
    case 'choice': {
      const [lead, rest] = splitHint(d.hint?.(s) ?? '');
      return (
        <>
          <Segmented<string>
            label={d.label()}
            value={String(value)}
            onChange={(v) => set(v)}
            options={d.options.map((o) => ({ value: o, label: d.optionLabel(o) }))}
          />
          {lead ? <p className="field-hint">{lead}</p> : null}
          <MoreHint text={rest} />
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

/** One session setting's control, marked when changed from the built-in default. */
export function SessionSettingBlock({ d, p }: { d: SettingDescriptor; p: SessionBlockProps }) {
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
function GestureRow({ g, p }: { g: GestureInfo; p: SessionBlockProps }) {
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
        return d ? <SessionSettingBlock key={k} d={d} p={p} /> : null;
      })}
    </div>
  );
}

/** The gesture rows of one area (Settings › Gestures), each with its switch and tuning. */
export function GestureAreaRows({ area, p }: { area: GestureArea; p: SessionBlockProps }) {
  return (
    <div className="gesture-area" data-gesture-area={area}>
      {GESTURES.filter((g) => g.area === area).map((g) => (
        <GestureRow key={g.id} g={g} p={p} />
      ))}
    </div>
  );
}
