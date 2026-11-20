import { useId } from 'react';
import { Icon } from '../components/Icon.tsx';
import { adminStrings } from './adminStrings.ts';
import { FieldControl } from './FieldControl.tsx';
import { countSet, type SectionModel } from './formModel.ts';
import { problemText } from './problemText.ts';
import type { FieldProblem } from './validation.ts';

/** Collapsible schema sections (one per server form). */
export function SchemaSections({
  sections,
  values,
  onChange,
  errors,
  errorPrefix,
  open,
  onToggle,
  forceOpen,
  idPrefix,
}: {
  sections: readonly SectionModel[];
  values: Readonly<Record<string, string>>;
  onChange: (name: string, value: string) => void;
  errors: Readonly<Record<string, FieldProblem>>;
  /** `param:` or `attr:`. */
  errorPrefix: string;
  open: ReadonlySet<string>;
  onToggle: (key: string) => void;
  /** While searching every matching section is shown expanded. */
  forceOpen: boolean;
  /** Keeps open-state keys of parameter and attribute sections apart. */
  idPrefix: string;
}) {
  const a = adminStrings.editor;
  const baseId = useId();
  return (
    <>
      {sections.map((section) => {
        const key = `${idPrefix}${section.id}`;
        const expanded = forceOpen || open.has(key);
        const n = countSet(section, values);
        const label = section.label || a.parameters;
        const bodyId = `${baseId}-${key}`;
        return (
          <section key={key} className="adm-section">
            <button
              type="button"
              className="adm-section-head"
              aria-expanded={expanded}
              aria-controls={bodyId}
              aria-label={expanded ? a.collapse(label) : a.expand(label)}
              onClick={() => onToggle(key)}
              disabled={forceOpen}
            >
              <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size="1.25rem" />
              <span className="adm-section-title">{label}</span>
              {n > 0 ? <span className="badge adm-set-badge">{a.setCount(n)}</span> : null}
            </button>
            {expanded ? (
              <div className="adm-section-body" id={bodyId}>
                {section.fields.map((f) => (
                  <FieldControl
                    key={f.name}
                    field={f}
                    value={values[f.name]}
                    onChange={(v) => onChange(f.name, v)}
                    error={problemText(errors[`${errorPrefix}${f.name}`], f.name)}
                  />
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </>
  );
}
