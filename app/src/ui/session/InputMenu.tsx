import { useId, type ReactNode } from 'react';
import type { PointerMode } from '../../session/pointer/PointerModel.ts';
import { ChromeButton } from './ChromeButton.tsx';
import {
  INPUT_RANGES,
  type NumericInputSetting,
  type ResolvedSessionSettings,
  type SessionSettings,
} from './settings.ts';
import { sessionStrings } from './sessionStrings.ts';
import { Sheet } from './Sheet.tsx';

export interface InputMenuProps {
  readonly settings: ResolvedSessionSettings;
  /** Touches the server accepts; 0 hides the touch pass-through mode. */
  readonly touchSupport: number;
  readonly onChange: (patch: Partial<SessionSettings>) => void;
  readonly onEditKeyBar: () => void;
  readonly onClose: () => void;
}

function Switch({
  label,
  hint,
  on,
  onToggle,
}: {
  label: string;
  hint?: string;
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

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="omg-field">
      <span className="omg-label">{label}</span>
      <div className="omg-segmented" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <ChromeButton
            key={o.value}
            role="radio"
            aria-checked={o.value === value}
            className={o.value === value ? 'omg-seg omg-seg--on' : 'omg-seg'}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </ChromeButton>
        ))}
      </div>
    </div>
  );
}

function Slider({
  setting,
  label,
  value,
  format,
  onChange,
}: {
  setting: NumericInputSetting;
  label: string;
  value: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const id = useId();
  const [min, max, step] = INPUT_RANGES[setting];
  return (
    <div className="omg-field">
      <label htmlFor={id} className="omg-label omg-label--row">
        <span>{label}</span>
        <span className="omg-value">{format(value)}</span>
      </label>
      <input
        id={id}
        className="omg-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
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

const ms = (v: number) => `${Math.round(v)} ms`;
const times = (v: number) => `${v.toFixed(2)}×`;

/** In-session "Input options" (PTR-7, KEY-2, KEY-7, DSP-7, DSP-8). */
export function InputMenu({
  settings: s,
  touchSupport,
  onChange,
  onEditKeyBar,
  onClose,
}: InputMenuProps) {
  const modes: PointerMode[] =
    touchSupport > 0 || s.pointerMode === 'touch'
      ? ['direct', 'trackpad', 'touch']
      : ['direct', 'trackpad'];
  const t = sessionStrings.input;
  const pm = sessionStrings.pointerModes;
  return (
    <Sheet title={t.title} onClose={onClose}>
      <Section title={t.pointer}>
        <div className="omg-choice-list" role="radiogroup" aria-label={t.pointerModeGroup}>
          {modes.map((m) => (
            <ChromeButton
              key={m}
              role="radio"
              aria-checked={m === s.pointerMode}
              className={m === s.pointerMode ? 'omg-choice omg-choice--on' : 'omg-choice'}
              onClick={() => onChange({ pointerMode: m })}
            >
              <span className="omg-choice__label">{pm.labels[m]}</span>
              <span className="omg-choice__hint">
                {m === 'touch' && touchSupport <= 0 ? pm.touchNotOffered : pm.hints[m]}
              </span>
            </ChromeButton>
          ))}
        </div>
        <Slider
          setting="pointerSpeed"
          label={t.pointerSpeed}
          value={s.pointerSpeed}
          format={times}
          onChange={(v) => onChange({ pointerSpeed: v })}
        />
        <Slider
          setting="pointerAcceleration"
          label={t.acceleration}
          value={s.pointerAcceleration}
          format={(v) => (v === 0 ? t.off : times(v))}
          onChange={(v) => onChange({ pointerAcceleration: v })}
        />
        <Switch
          label={t.tapDrag}
          hint={s.tapDrag ? t.tapDragOn : t.tapDragOff}
          on={s.tapDrag}
          onToggle={(v) => onChange({ tapDrag: v })}
        />
        <Segmented
          label={t.directOneFinger}
          value={s.directOneFinger}
          options={[
            { value: 'pan', label: t.panView },
            { value: 'drag', label: t.dragRemote },
          ]}
          onChange={(v) => onChange({ directOneFinger: v })}
        />
        <p className="omg-muted">{t.fitsAlwaysDrags}</p>
        <Switch
          label={t.pointerLock}
          hint={t.pointerLockHint}
          on={s.pointerLock}
          onToggle={(v) => onChange({ pointerLock: v })}
        />
        <Switch
          label={t.largeCursor}
          hint={t.largeCursorHint}
          on={s.largeCursor}
          onToggle={(v) => onChange({ largeCursor: v })}
        />
      </Section>

      <Section title={t.scrolling}>
        <Segmented
          label={t.twoFingerDrag}
          value={s.twoFingerDrag}
          options={[
            { value: 'scroll', label: t.scrollRemote },
            { value: 'pan', label: t.panView },
          ]}
          onChange={(v) => onChange({ twoFingerDrag: v })}
        />
        <Switch
          label={t.naturalScroll}
          hint={t.naturalScrollHint}
          on={s.naturalScroll}
          onToggle={(v) => onChange({ naturalScroll: v })}
        />
        <Switch
          label={t.horizontalScroll}
          hint={t.horizontalScrollHint}
          on={s.horizontalScroll}
          onToggle={(v) => onChange({ horizontalScroll: v })}
        />
      </Section>

      <Section title={t.timing}>
        <Slider
          setting="longPressMs"
          label={t.longPress}
          value={s.longPressMs}
          format={ms}
          onChange={(v) => onChange({ longPressMs: v })}
        />
        <Slider
          setting="doubleTapWindowMs"
          label={t.doubleTap}
          value={s.doubleTapWindowMs}
          format={ms}
          onChange={(v) => onChange({ doubleTapWindowMs: v })}
        />
        <Slider
          setting="tapSlopPx"
          label={t.tapTolerance}
          value={s.tapSlopPx}
          format={(v) => `${Math.round(v)} px`}
          onChange={(v) => onChange({ tapSlopPx: v })}
        />
      </Section>

      <Section title={t.keyboard}>
        <Segmented
          label={t.softKeyboardText}
          value={s.textInputMode}
          options={[
            { value: 'live', label: t.live },
            { value: 'word', label: t.commitOnWord },
          ]}
          onChange={(v) => onChange({ textInputMode: v })}
        />
        <p className="omg-muted">{t.keyboardTip}</p>
        <Switch
          label={t.textInputBar}
          hint={t.textInputBarHint}
          on={s.textInputBar}
          onToggle={(v) => onChange({ textInputBar: v })}
        />
        <div className="omg-sheet__actions">
          <ChromeButton className="omg-btn--ghost" onClick={onEditKeyBar}>
            {t.editKeyBar}
          </ChromeButton>
        </div>
      </Section>

      <Section title={t.screen}>
        <Segmented
          label={t.splitLayout}
          value={s.splitLayout}
          options={[
            { value: 'auto', label: t.whenFolded },
            { value: 'on', label: t.on },
            { value: 'off', label: t.off },
          ]}
          onChange={(v) => onChange({ splitLayout: v })}
        />
        <Switch
          label={t.immersive}
          hint={t.immersiveHint}
          on={s.immersive}
          onToggle={(v) => onChange({ immersive: v })}
        />
      </Section>
    </Sheet>
  );
}
