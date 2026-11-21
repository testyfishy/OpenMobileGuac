import { useId, type ReactNode } from 'react';
import { ChromeButton } from './ChromeButton.tsx';
import type { ResolvedSessionSettings, SessionSettings } from './settings.ts';
import {
  SETTING_SECTIONS,
  descriptorOf,
  descriptorsIn,
  rangeOf,
  settingPatch,
  DEFAULT_SUMMARY_CONTEXT,
  type ListEditor,
  type SettingDescriptor,
  type SettingKey,
  type SummaryContext,
} from './settingsSchema.ts';
import { sessionStrings } from './sessionStrings.ts';
import { Sheet } from './Sheet.tsx';
import { GestureFigure } from './GestureFigure.tsx';
import {
  GESTURES,
  GESTURE_AREAS,
  gestureForKey,
  type GestureId,
  type GestureInfo,
} from './gestures.ts';

export interface InputMenuProps {
  readonly settings: ResolvedSessionSettings;
  /** Touches the server accepts; 0 hides the touch pass-through mode. */
  readonly touchSupport: number;
  /** Keys this connection overrides (shown with "Use app default"). */
  readonly overridden?: ReadonlySet<string>;
  readonly onChange: (patch: Partial<SessionSettings>) => void;
  /** Drop the connection's own value for these keys (back to the app / server default). */
  readonly onUseDefault?: (keys: SettingKey[]) => void;
  readonly onEditList: (editor: ListEditor) => void;
  /** Names for list summaries (the key set in use). */
  readonly summaryContext?: SummaryContext;
  readonly onClose: () => void;
}

function Switch({
  label,
  hint,
  on,
  onToggle,
}: {
  label: string;
  hint?: string | undefined;
  on: boolean;
  onToggle: (on: boolean) => void;
}) {
  return (
    <ChromeButton
      role="switch"
      aria-checked={on}
      className="omg-switch-row"
      onClick={() => onToggle(!on)}
    >
      <span>
        <span className="omg-choice__label">{label}</span>
        {hint && <span className="omg-choice__hint">{hint}</span>}
      </span>
      <span className={on ? 'omg-switch omg-switch--on' : 'omg-switch'} aria-hidden="true" />
    </ChromeButton>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="omg-section" aria-label={title}>
      <h3 className="omg-section__title">{title}</h3>
      {children}
    </section>
  );
}

function Control({
  d,
  s,
  touchSupport,
  onChange,
  onEditList,
  ctx,
}: {
  d: SettingDescriptor;
  s: ResolvedSessionSettings;
  touchSupport: number;
  onChange: (patch: Partial<SessionSettings>) => void;
  onEditList: (editor: ListEditor) => void;
  ctx: SummaryContext;
}) {
  const id = useId();
  const value = s[d.key];
  const set = (v: unknown) => onChange(settingPatch(d.key, v));
  switch (d.control) {
    case 'switch':
      return (
        <Switch label={d.label()} hint={d.hint?.(s)} on={value === true} onToggle={(v) => set(v)} />
      );
    case 'choice': {
      const options =
        d.key === 'pointerMode' && touchSupport <= 0 && value !== 'touch'
          ? d.options.filter((o) => o !== 'touch')
          : d.options;
      if (d.optionHint) {
        return (
          <div className="omg-field">
            <span className="omg-label">{d.label()}</span>
            <div className="omg-choice-list" role="radiogroup" aria-label={d.label()}>
              {options.map((o) => (
                <ChromeButton
                  key={o}
                  role="radio"
                  aria-checked={o === value}
                  className={o === value ? 'omg-choice omg-choice--on' : 'omg-choice'}
                  onClick={() => set(o)}
                >
                  <span className="omg-choice__label">{d.optionLabel(o)}</span>
                  <span className="omg-choice__hint">
                    {d.key === 'pointerMode' && o === 'touch' && touchSupport <= 0
                      ? sessionStrings.pointerModes.touchNotOffered
                      : d.optionHint?.(o)}
                  </span>
                </ChromeButton>
              ))}
            </div>
          </div>
        );
      }
      const hint = d.hint?.(s);
      return (
        <div className="omg-field">
          <span className="omg-label">{d.label()}</span>
          <div className="omg-segmented" role="radiogroup" aria-label={d.label()}>
            {options.map((o) => (
              <ChromeButton
                key={o}
                role="radio"
                aria-checked={o === value}
                className={o === value ? 'omg-seg omg-seg--on' : 'omg-seg'}
                onClick={() => set(o)}
              >
                {d.optionLabel(o)}
              </ChromeButton>
            ))}
          </div>
          {hint && <p className="omg-muted">{hint}</p>}
        </div>
      );
    }
    case 'range': {
      const [min, max, step] = rangeOf(d);
      const v = value as number;
      return (
        <div className="omg-field">
          <label htmlFor={id} className="omg-label omg-label--row">
            <span>{d.label()}</span>
            <span className="omg-value">{d.format(v)}</span>
          </label>
          <input
            id={id}
            className="omg-range"
            type="range"
            min={min}
            max={max}
            step={step}
            value={v}
            aria-valuetext={d.format(v)}
            onChange={(e) => set(Number(e.target.value))}
          />
        </div>
      );
    }
    case 'list':
      return (
        <div className="omg-field omg-list-setting">
          <span>
            <span className="omg-choice__label">{d.label()}</span>
            <span className="omg-choice__hint">{d.summary(s, ctx)}</span>
          </span>
          <ChromeButton className="omg-btn--ghost" onClick={() => onEditList(d.editor)}>
            {sessionStrings.options.edit}
          </ChromeButton>
        </div>
      );
  }
}

interface BlockProps {
  readonly s: ResolvedSessionSettings;
  readonly touchSupport: number;
  readonly overridden: ReadonlySet<string> | undefined;
  readonly onChange: (patch: Partial<SessionSettings>) => void;
  readonly onUseDefault: ((keys: SettingKey[]) => void) | undefined;
  readonly onEditList: (editor: ListEditor) => void;
  readonly ctx: SummaryContext;
}

/** "Custom for this connection · Use app default" under an overridden setting. */
function Override({ d, b }: { d: SettingDescriptor; b: BlockProps }) {
  const o = sessionStrings.options;
  if (!b.onUseDefault || !b.overridden?.has(d.key)) return null;
  const resetKeys = b.onUseDefault;
  return (
    <p className="omg-override">
      <span className="omg-override__tag">{o.overridden}</span>
      <ChromeButton
        className="omg-btn--small omg-btn--ghost"
        aria-label={o.useDefaultFor(d.label())}
        onClick={() => resetKeys([d.key])}
      >
        {o.useDefault}
      </ChromeButton>
    </p>
  );
}

function SettingBlock({ d, b }: { d: SettingDescriptor; b: BlockProps }) {
  return (
    <div className="omg-setting" data-setting-key={d.key}>
      <Control
        d={d}
        s={b.s}
        touchSupport={b.touchSupport}
        onChange={b.onChange}
        onEditList={b.onEditList}
        ctx={b.ctx}
      />
      <Override d={d} b={b} />
    </div>
  );
}

/** A gesture: its picture, name, what it does and its switch, then its settings. */
function GestureRow({ g, b }: { g: GestureInfo; b: BlockProps }) {
  const t = sessionStrings.gestures;
  const item = t.items[g.id];
  const toggle = g.toggle ? descriptorOf(g.toggle) : undefined;
  const why = (t.why as Partial<Record<GestureId, string>>)[g.id];
  const noTrackpadDrag = g.id === 'longPress' && !b.s.gestureLongPress && !b.s.tapDrag;
  return (
    <div className="omg-gopt" data-gesture={g.id}>
      <div className="omg-gopt__head">
        <GestureFigure kind={g.figure} />
        {toggle ? (
          <div className="omg-setting omg-gopt__main" data-setting-key={toggle.key}>
            <Switch
              label={item.name}
              hint={item.desc}
              on={b.s[toggle.key] === true}
              onToggle={(v) => b.onChange(settingPatch(toggle.key, v))}
            />
            <Override d={toggle} b={b} />
          </div>
        ) : (
          <div className="omg-gopt__main omg-gopt__text">
            <span className="omg-choice__label">
              {item.name}
              {g.alwaysOn && <span className="omg-gopt__always">{t.alwaysOn}</span>}
            </span>
            <span className="omg-choice__hint">{item.desc}</span>
            {why && <span className="omg-choice__hint omg-gopt__why">{why}</span>}
          </div>
        )}
      </div>
      {noTrackpadDrag && <p className="omg-muted">{t.noTrackpadDrag}</p>}
      {g.settings.map((k) => {
        const d = descriptorOf(k);
        return d ? <SettingBlock key={k} d={d} b={b} /> : null;
      })}
    </div>
  );
}

function GestureRows({ b }: { b: BlockProps }) {
  const t = sessionStrings.gestures;
  return (
    <>
      <p className="omg-muted">{sessionStrings.options.sectionHints.gestures}</p>
      {GESTURE_AREAS.map((area) => (
        <div key={area} className="omg-gopt-area">
          <h4 className="omg-gopt-area__title">{t.areas[area]}</h4>
          {GESTURES.filter((g) => g.area === area).map((g) => (
            <GestureRow key={g.id} g={g} b={b} />
          ))}
        </div>
      ))}
      {descriptorsIn('gestures')
        .filter((d) => !gestureForKey(d.key))
        .map((d) => (
          <SettingBlock key={d.key} d={d} b={b} />
        ))}
    </>
  );
}

/**
 * In-session "Session options": every session setting, rendered from the shared descriptor
 * table (`settingsSchema.ts`), saved for this connection. Values this connection overrides
 * are marked, with "Use app default".
 */
export function InputMenu({
  settings: s,
  touchSupport,
  overridden,
  onChange,
  onUseDefault,
  onEditList,
  summaryContext = DEFAULT_SUMMARY_CONTEXT,
  onClose,
}: InputMenuProps) {
  const o = sessionStrings.options;
  const custom = [...(overridden ?? [])] as SettingKey[];
  const b: BlockProps = {
    s,
    touchSupport,
    overridden,
    onChange,
    onUseDefault,
    onEditList,
    ctx: summaryContext,
  };
  return (
    <Sheet title={o.title} onClose={onClose}>
      <p className="omg-muted omg-options__intro">{o.savedForConnection}</p>
      {onUseDefault && custom.length > 0 && (
        <div className="omg-sheet__actions omg-options__reset-all">
          <ChromeButton className="omg-btn--ghost" onClick={() => onUseDefault(custom)}>
            {o.resetConnection}
          </ChromeButton>
        </div>
      )}
      {SETTING_SECTIONS.map((section) => (
        <Section key={section} title={o.sections[section]}>
          {section === 'gestures' ? (
            <GestureRows b={b} />
          ) : (
            descriptorsIn(section).map((d) => <SettingBlock key={d.key} d={d} b={b} />)
          )}
        </Section>
      ))}
    </Sheet>
  );
}
