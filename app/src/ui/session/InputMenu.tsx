import { useId, type ReactNode } from 'react';
import type { PointerMode } from '../../session/pointer/PointerModel.ts';
import { ChromeButton } from './ChromeButton.tsx';
import {
  INPUT_RANGES,
  POINTER_MODE_LABELS,
  type NumericInputSetting,
  type ResolvedSessionSettings,
  type SessionSettings,
} from './settings.ts';
import { Sheet } from './Sheet.tsx';

export interface InputMenuProps {
  readonly settings: ResolvedSessionSettings;
  /** Touches the server accepts; 0 hides the touch pass-through mode. */
  readonly touchSupport: number;
  readonly onChange: (patch: Partial<SessionSettings>) => void;
  readonly onEditKeyBar: () => void;
  readonly onClose: () => void;
}

const MODE_HINTS: Readonly<Record<PointerMode, string>> = {
  direct: 'Tap where you want to click',
  trackpad: 'The screen is a trackpad for the pointer',
  touch: 'Raw multi-touch to the remote (RDP touch)',
};

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
  return (
    <Sheet title="Input options" onClose={onClose}>
      <Section title="Pointer">
        <div className="omg-choice-list" role="radiogroup" aria-label="Pointer mode">
          {modes.map((m) => (
            <ChromeButton
              key={m}
              role="radio"
              aria-checked={m === s.pointerMode}
              className={m === s.pointerMode ? 'omg-choice omg-choice--on' : 'omg-choice'}
              onClick={() => onChange({ pointerMode: m })}
            >
              <span className="omg-choice__label">{POINTER_MODE_LABELS[m]}</span>
              <span className="omg-choice__hint">
                {m === 'touch' && touchSupport <= 0
                  ? 'Not offered by this connection: acts as direct touch'
                  : MODE_HINTS[m]}
              </span>
            </ChromeButton>
          ))}
        </div>
        <Slider
          setting="pointerSpeed"
          label="Trackpad pointer speed"
          value={s.pointerSpeed}
          format={times}
          onChange={(v) => onChange({ pointerSpeed: v })}
        />
        <Slider
          setting="pointerAcceleration"
          label="Trackpad acceleration"
          value={s.pointerAcceleration}
          format={(v) => (v === 0 ? 'Off' : times(v))}
          onChange={(v) => onChange({ pointerAcceleration: v })}
        />
        <Switch
          label="Tap and a half to drag (trackpad)"
          hint={
            s.tapDrag
              ? 'Tap, then touch again and move to drag. A tap’s button-up waits up to the double-tap time'
              : 'Off: every tap is an instant complete click; drag with a long press'
          }
          on={s.tapDrag}
          onToggle={(v) => onChange({ tapDrag: v })}
        />
        <Segmented
          label="Direct touch: one-finger drag when zoomed in"
          value={s.directOneFinger}
          options={[
            { value: 'pan', label: 'Pan the view' },
            { value: 'drag', label: 'Drag on the remote' },
          ]}
          onChange={(v) => onChange({ directOneFinger: v })}
        />
        <p className="omg-muted">When the whole desktop fits, a one-finger drag always drags.</p>
        <Switch
          label="Pointer lock for a mouse (trackpad mode)"
          hint="Desktops and tablets: capture the mouse for relative movement (Esc releases)"
          on={s.pointerLock}
          onToggle={(v) => onChange({ pointerLock: v })}
        />
        <Switch
          label="Large cursor"
          hint="Bigger, high-contrast pointer"
          on={s.largeCursor}
          onToggle={(v) => onChange({ largeCursor: v })}
        />
      </Section>

      <Section title="Scrolling">
        <Segmented
          label="Two-finger drag"
          value={s.twoFingerDrag}
          options={[
            { value: 'scroll', label: 'Scroll the remote' },
            { value: 'pan', label: 'Pan the view' },
          ]}
          onChange={(v) => onChange({ twoFingerDrag: v })}
        />
        <Switch
          label="Natural scrolling"
          hint="Content follows the fingers"
          on={s.naturalScroll}
          onToggle={(v) => onChange({ naturalScroll: v })}
        />
        <Switch
          label="Horizontal scrolling"
          hint="Sideways two-finger drag sends Shift + wheel"
          on={s.horizontalScroll}
          onToggle={(v) => onChange({ horizontalScroll: v })}
        />
      </Section>

      <Section title="Timing">
        <Slider
          setting="longPressMs"
          label="Long press"
          value={s.longPressMs}
          format={ms}
          onChange={(v) => onChange({ longPressMs: v })}
        />
        <Slider
          setting="doubleTapWindowMs"
          label="Double tap"
          value={s.doubleTapWindowMs}
          format={ms}
          onChange={(v) => onChange({ doubleTapWindowMs: v })}
        />
        <Slider
          setting="tapSlopPx"
          label="Tap tolerance"
          value={s.tapSlopPx}
          format={(v) => `${Math.round(v)} px`}
          onChange={(v) => onChange({ tapSlopPx: v })}
        />
      </Section>

      <Section title="Keyboard">
        <Segmented
          label="Soft keyboard text"
          value={s.textInputMode}
          options={[
            { value: 'live', label: 'Live' },
            { value: 'word', label: 'Commit on word' },
          ]}
          onChange={(v) => onChange({ textInputMode: v })}
        />
        <p className="omg-muted">
          If letters arrive wrong with your keyboard app, try Commit on word or the text input bar.
        </p>
        <Switch
          label="Text input bar"
          hint="A visible field above the keyboard: type, dictate or paste, then Send"
          on={s.textInputBar}
          onToggle={(v) => onChange({ textInputBar: v })}
        />
        <div className="omg-sheet__actions">
          <ChromeButton className="omg-btn--ghost" onClick={onEditKeyBar}>
            Edit key bar…
          </ChromeButton>
        </div>
      </Section>

      <Section title="Screen">
        <Segmented
          label="Split layout (display above a trackpad)"
          value={s.splitLayout}
          options={[
            { value: 'auto', label: 'When folded' },
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
          ]}
          onChange={(v) => onChange({ splitLayout: v })}
        />
        <Switch
          label="Immersive full screen"
          hint="Hide the system bars; the toolbar shrinks to an edge grip"
          on={s.immersive}
          onToggle={(v) => onChange({ immersive: v })}
        />
      </Section>
    </Sheet>
  );
}
