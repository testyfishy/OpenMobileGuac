import { useId, useState } from 'react';
import { Icon } from '../components/Icon.tsx';
import { adminStrings } from './adminStrings.ts';
import { isValidParameterName } from './validation.ts';

/**
 * Parameters by exact name, for ones the server's schema does not list (newer guacd
 * options, extension parameters). Lists the connection's current unlisted parameters and
 * adds new ones. Values are plain text: the schema gives no type for these.
 */
export function AdvancedParameters({
  names,
  values,
  known,
  onChange,
}: {
  /** Parameter names with a value that the schema does not list. */
  names: readonly string[];
  values: Readonly<Record<string, string>>;
  known: ReadonlySet<string>;
  onChange: (name: string, value: string) => void;
}) {
  const a = adminStrings.advanced;
  const id = useId();
  const [newName, setNewName] = useState('');
  const [newValue, setNewValue] = useState('');
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const add = () => {
    const name = newName.trim();
    if (!isValidParameterName(name)) {
      setProblem(a.invalidName);
      return;
    }
    if (known.has(name)) {
      setProblem(a.duplicate);
      return;
    }
    onChange(name, newValue);
    setNewName('');
    setNewValue('');
    setProblem(undefined);
  };

  return (
    <section className="adm-group adm-advanced" aria-labelledby={`${id}-t`}>
      <h2 className="subsection-title" id={`${id}-t`}>
        {a.title}
      </h2>
      <p className="field-hint">{a.hint}</p>
      {names.length === 0 ? <p className="muted">{a.none}</p> : null}
      {names.map((name) => (
        <div className="field adm-field adm-field-set" key={name}>
          <div className="adm-field-head">
            <label className="field-label" htmlFor={`${id}-${name}`}>
              <code>{name}</code>
            </label>
            <button
              type="button"
              className="icon-btn adm-reset"
              aria-label={a.remove(name)}
              title={a.remove(name)}
              onClick={() => onChange(name, '')}
            >
              <Icon name="trash" size="1.125rem" />
            </button>
          </div>
          <input
            id={`${id}-${name}`}
            className="field-input"
            value={values[name] ?? ''}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => onChange(name, e.target.value)}
          />
        </div>
      ))}
      <div className={problem ? 'adm-add-param field-invalid' : 'adm-add-param'}>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-new-name`}>
            {a.name}
          </label>
          <input
            id={`${id}-new-name`}
            className="field-input"
            value={newName}
            placeholder="disable-gfx"
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={problem ? true : undefined}
            onChange={(e) => setNewName(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-new-value`}>
            {a.value}
          </label>
          <input
            id={`${id}-new-value`}
            className="field-input"
            value={newValue}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
        </div>
        {problem ? (
          <p className="field-error" role="alert">
            {problem}
          </p>
        ) : null}
        <button
          type="button"
          className="btn"
          onClick={add}
          disabled={newName.trim() === '' || newValue === ''}
        >
          <Icon name="plus" /> {a.add}
        </button>
      </div>
    </section>
  );
}
