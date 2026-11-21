import type { ReactNode } from 'react';
import { RangeField, Segmented, Toggle } from '../components/Form.tsx';
import { Icon } from '../components/Icon.tsx';
import type { ResolvedSessionSettings, SessionSettings } from '../session/settings.ts';
import {
  descriptorOf,
  rangeOf,
  settingEnabled,
  settingPatch,
  DEFAULT_SUMMARY_CONTEXT,
  type ListEditor,
  type SettingDescriptor,
  type SettingKey,
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
import { valueText } from './connectionLayers.ts';
import './sessionDefaults.css';

/**
 * Editing one connection's (or one server's) own values instead of the app defaults: each
 * control shows the effective value, marked as its own or inherited, with "Use default".
 */
export interface SettingLayer {
  readonly kind: 'connection' | 'server';
  /** Keys this layer stores a value for. */
  readonly own: ReadonlySet<string>;
  /** What it would use without its own values. */
  readonly inherited: ResolvedSessionSettings;
  readonly onUseDefault: (keys: SettingKey[]) => void;
}

/** What a session setting's control needs: pure props (no context), so tests can render it. */
export interface SessionBlockProps {
  readonly values: ResolvedSessionSettings;
  /** Keys that differ from the built-in defaults (marked with a bar). */
  readonly changed: ReadonlySet<string>;
  readonly onChange: (patch: Partial<SessionSettings>) => void;
  readonly onEditList: (editor: ListEditor) => void;
  /** Names for list summaries (key sets from the key library). */
  readonly summaryContext?: SummaryContext;
  /** Set when editing a connection's or server's own values (not the app defaults). */
  readonly layer?: SettingLayer;
  /** Shown under one setting's control (e.g. which connections override it). */
  readonly below?: (key: SettingKey) => ReactNode;
}

/** Under a setting in a layer: its own value (with the default and "Use default") or inherited. */
function LayerNote({ d, p }: { d: SettingDescriptor; p: SessionBlockProps }) {
  const l = p.layer;
  if (!l) return null;
  const t = strings.settings.perConnection;
  if (!l.own.has(d.key)) {
    return (
      <p className="layer-note" data-layer="inherited">
        <span className="layer-tag layer-tag-inherited">{t.inherited}</span>
      </p>
    );
  }
  return (
    <p className="layer-note" data-layer="own">
      <span className="layer-tag">{l.kind === 'server' ? t.ownServer : t.own}</span>
      <span className="layer-default">
        {t.defaultValue(valueText(d, l.inherited, p.summaryContext ?? DEFAULT_SUMMARY_CONTEXT))}
      </span>
      <button
        type="button"
        className="btn btn-small btn-ghost layer-use-default"
        aria-label={t.useDefaultFor(d.label())}
        data-action="use-default"
        onClick={() => l.onUseDefault([d.key])}
      >
        {t.useDefault}
      </button>
    </p>
  );
}

function settingClass(p: SessionBlockProps, key: string): string {
  if (p.layer) return p.layer.own.has(key) ? 'setting setting-changed setting-own' : 'setting';
  return p.changed.has(key) ? 'setting setting-changed' : 'setting';
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
  const control = (
    <Control
      d={d}
      s={p.values}
      onChange={p.onChange}
      onEditList={p.onEditList}
      ctx={p.summaryContext ?? DEFAULT_SUMMARY_CONTEXT}
    />
  );
  return (
    <div className={settingClass(p, d.key)} data-setting-key={d.key}>
      {/* No effect with the current values (or on this platform): shown, but not editable. */}
      {settingEnabled(d, p.values) ? (
        control
      ) : (
        <>
          <fieldset className="setting-inactive" disabled data-inactive="1">
            {control}
          </fieldset>
          {/* A slider shows no hint of its own: say when it applies. */}
          {d.control === 'range' && d.hint ? (
            <p className="field-hint">{d.hint(p.values)}</p>
          ) : null}
        </>
      )}
      <LayerNote d={d} p={p} />
      {p.below?.(d.key)}
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
            <div className={settingClass(p, toggle.key)} data-setting-key={toggle.key}>
              <Toggle
                label={item.name}
                hint={item.desc}
                checked={s[toggle.key] === true}
                onChange={(v) => p.onChange(settingPatch(toggle.key, v))}
              />
              <LayerNote d={toggle} p={p} />
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
