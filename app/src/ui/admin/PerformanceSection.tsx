import { useMemo, useState } from 'react';
import { Dialog } from '../components/Dialog.tsx';
import { strings } from '../strings.ts';
import { adminStrings } from './adminStrings.ts';
import { FieldControl } from './FieldControl.tsx';
import type { FieldModel, SectionModel } from './formModel.ts';
import {
  PRESET_IDS,
  matchingPreset,
  presetChanges,
  quickFields,
  type ParameterChange,
  type PresetId,
} from './presets.ts';

/**
 * "Performance & quality" for RDP and VNC: the bandwidth-relevant parameters with plain
 * labels, and three presets. Applying a preset first lists exactly which parameters it will
 * change; it only edits the form (nothing is sent until Save).
 */
export function PerformanceSection({
  protocol,
  sections,
  values,
  known,
  onChange,
  onApply,
}: {
  protocol: string;
  sections: readonly SectionModel[];
  values: Readonly<Record<string, string>>;
  known: ReadonlySet<string>;
  onChange: (name: string, value: string) => void;
  onApply: (changes: readonly ParameterChange[], preset: PresetId) => void;
}) {
  const p = adminStrings.perf;
  const [preview, setPreview] = useState<PresetId | null>(null);
  const fields = useMemo(() => {
    const byName = new Map<string, FieldModel>();
    for (const s of sections) for (const f of s.fields) byName.set(f.name, f);
    return quickFields(protocol, known)
      .map((n) => byName.get(n))
      .filter((f): f is FieldModel => f !== undefined);
  }, [protocol, sections, known]);
  const current = matchingPreset(protocol, values, known);
  const changes = preview ? presetChanges(protocol, preview, values, known) : [];
  const fieldByName = new Map(fields.map((f) => [f.name, f]));

  const describe = (name: string, value: string): string => {
    const f = fieldByName.get(name);
    if (value === '') return f?.kind === 'boolean' ? p.off : p.unset;
    if (f?.kind === 'boolean') return value === f.truthValue ? p.on : value;
    return (
      p.options[`${name}=${value}`] ?? f?.options.find((o) => o.value === value)?.label ?? value
    );
  };

  return (
    <section className="adm-perf" aria-labelledby="adm-perf-title">
      <h2 className="subsection-title" id="adm-perf-title">
        {p.title}
      </h2>
      <p className="field-hint">{p.hint}</p>
      <div className="adm-presets" role="group" aria-label={p.title}>
        {PRESET_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className={current === id ? 'adm-preset adm-preset-on' : 'adm-preset'}
            aria-pressed={current === id}
            onClick={() => setPreview(id)}
          >
            <span className="adm-preset-name">{p.presets[id]}</span>
            <span className="adm-preset-hint">{p.presetHints[id]}</span>
          </button>
        ))}
      </div>
      <p className="muted adm-preset-status">
        {current ? p.current(p.presets[current]) : p.custom}
      </p>
      <div className="adm-section-body adm-perf-fields">
        {fields.map((f) => (
          <FieldControl
            key={f.name}
            field={f}
            value={values[f.name]}
            onChange={(v) => onChange(f.name, v)}
            label={p.labels[f.name] ?? f.label}
            hint={p.hints[f.name]}
            optionLabel={(v) => p.options[`${f.name}=${v}`]}
          />
        ))}
      </div>
      {preview ? (
        <Dialog
          title={p.previewTitle(p.presets[preview])}
          onCancel={() => setPreview(null)}
          actions={
            <>
              <button type="button" className="btn" onClick={() => setPreview(null)}>
                {strings.common.cancel}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={changes.length === 0}
                onClick={() => {
                  onApply(changes, preview);
                  setPreview(null);
                }}
              >
                {p.apply}
              </button>
            </>
          }
        >
          {changes.length === 0 ? (
            <p>{p.noChanges}</p>
          ) : (
            <>
              <p>{p.previewIntro}</p>
              <ul className="adm-diff" aria-label={p.previewIntro}>
                {changes.map((c) => (
                  <li key={c.name}>
                    <span className="adm-diff-label">
                      {p.labels[c.name] ?? fieldByName.get(c.name)?.label ?? c.name}
                    </span>{' '}
                    <code className="adm-diff-name">{c.name}</code>
                    <span className="adm-diff-values">
                      <span className="adm-diff-from">{describe(c.name, c.from)}</span>
                      {' → '}
                      <strong className="adm-diff-to">{describe(c.name, c.to)}</strong>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="muted">{p.previewOutro}</p>
            </>
          )}
        </Dialog>
      ) : null}
    </section>
  );
}
