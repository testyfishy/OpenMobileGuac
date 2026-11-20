import { useId, useMemo, useState } from 'react';
import { Icon } from '../components/Icon.tsx';
import { adminStrings } from './adminStrings.ts';
import { isSet, type FieldModel } from './formModel.ts';

/** IANA zones for the TIMEZONE datalist, when the runtime can list them. */
function timeZones(): readonly string[] {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf;
    return fn ? fn('timeZone') : [];
  } catch {
    return [];
  }
}

/**
 * One schema field with the control its type calls for (upstream `FE/form/templates/`):
 * a switch for BOOLEAN, a select for ENUM, a numeric keypad for NUMERIC, a masked input with
 * show/hide for PASSWORD, a text area for MULTILINE. Shows a "Set" badge and a reset button
 * when the field has a value; unset fields use the server's default.
 *
 * Values are never logged. Password inputs ask browsers and password managers not to save
 * them (`autocomplete="new-password"`, and the app never stores them).
 */
export function FieldControl({
  field,
  value,
  onChange,
  error,
  label,
  hint,
  optionLabel,
}: {
  field: FieldModel;
  value: string | undefined;
  onChange: (value: string) => void;
  error?: string | undefined;
  /** Overrides the schema label (the performance section's plain-language labels). */
  label?: string | undefined;
  hint?: string | undefined;
  optionLabel?: ((value: string) => string | undefined) | undefined;
}) {
  const a = adminStrings.editor;
  const id = useId();
  const [reveal, setReveal] = useState(false);
  const current = value ?? '';
  const set = isSet(value);
  const text = label ?? field.label;
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const describedBy = [hint ? hintId : null, error ? errId : null].filter(Boolean).join(' ');
  const zones = useMemo(() => (field.kind === 'timezone' ? timeZones() : []), [field.kind]);
  const common = {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy || undefined,
    'data-param': field.name,
  } as const;

  const head = (
    <div className="adm-field-head">
      <label htmlFor={id} className="field-label">
        {text}
      </label>
      {set ? (
        <>
          <span className="badge adm-set-badge">{a.setBadge}</span>
          <button
            type="button"
            className="icon-btn adm-reset"
            aria-label={a.reset(text)}
            title={a.reset(text)}
            onClick={() => onChange('')}
          >
            <Icon name="close" size="1.125rem" />
          </button>
        </>
      ) : null}
    </div>
  );

  const foot = (
    <>
      {error ? (
        <p id={errId} className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      ) : null}
    </>
  );

  if (field.kind === 'boolean') {
    const on = current === field.truthValue;
    return (
      <div className={set ? 'adm-field adm-field-set' : 'adm-field'}>
        <div className="toggle-row">
          <div className="adm-toggle-text">
            {head}
            {foot}
          </div>
          <input
            {...common}
            type="checkbox"
            role="switch"
            className="switch"
            checked={on}
            onChange={(e) => onChange(e.target.checked ? field.truthValue : '')}
          />
        </div>
      </div>
    );
  }

  let control;
  if (field.kind === 'enum') {
    const options = field.options.some((o) => o.value === '')
      ? field.options
      : [{ value: '', label: adminStrings.serverDefault }, ...field.options];
    const known = options.some((o) => o.value === current);
    control = (
      <select
        {...common}
        className="field-input"
        value={current}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {(o.value === '' ? undefined : optionLabel?.(o.value)) ?? o.label}
          </option>
        ))}
        {!known ? <option value={current}>{current}</option> : null}
      </select>
    );
  } else if (field.kind === 'multiline') {
    control = (
      <textarea
        {...common}
        className="field-input adm-textarea"
        value={current}
        rows={4}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
      />
    );
  } else if (field.kind === 'password') {
    control = (
      <div className="adm-password">
        <input
          {...common}
          className="field-input"
          type={reveal ? 'text' : 'password'}
          value={current}
          autoComplete="new-password"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="icon-btn"
          aria-pressed={reveal}
          aria-label={reveal ? a.hidePassword : a.showPassword}
          title={reveal ? a.hidePassword : a.showPassword}
          onClick={() => setReveal((r) => !r)}
        >
          <Icon name={reveal ? 'lock-open' : 'lock'} />
        </button>
      </div>
    );
  } else {
    const listId = `${id}-list`;
    const suggestions =
      field.kind === 'timezone'
        ? zones
        : field.kind === 'colorscheme'
          ? field.options.map((o) => o.value).filter(Boolean)
          : [];
    control = (
      <>
        <input
          {...common}
          className="field-input"
          type="text"
          value={current}
          inputMode={field.kind === 'number' ? 'numeric' : undefined}
          placeholder={adminStrings.serverDefault}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          list={suggestions.length ? listId : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
        {suggestions.length ? (
          <datalist id={listId}>
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        ) : null}
      </>
    );
  }

  return (
    <div
      className={['field', 'adm-field', set ? 'adm-field-set' : '', error ? 'field-invalid' : '']
        .filter(Boolean)
        .join(' ')}
    >
      {head}
      {control}
      {foot}
    </div>
  );
}
