import { useState, type FormEvent } from 'react';
import type { RequiredField } from '../../session/credentials/requiredParams.ts';
import { ChromeButton } from './ChromeButton.tsx';
import { IconEye } from './icons.tsx';
import { sessionStrings } from './sessionStrings.ts';
import { Sheet } from './Sheet.tsx';

export interface CredentialSheetProps {
  readonly title: string;
  readonly fields: readonly RequiredField[];
  readonly onSubmit: (values: Record<string, string>) => void;
  readonly onCancel: () => void;
}

/**
 * The server asked for connection parameters (`required`, SRV-11). The values live only in
 * this component's state until Continue; they are never logged or stored.
 */
export function CredentialSheet({ title, fields, onSubmit, onCancel }: CredentialSheetProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const t = sessionStrings.credentials;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(values);
    setValues({});
  };

  return (
    <Sheet
      title={t.title}
      onClose={onCancel}
      dismissible={false}
      closeLabel={t.cancelAndDisconnect}
      className="omg-sheet--prompt"
    >
      <form onSubmit={submit} autoComplete="on">
        <p className="omg-muted omg-prompt__intro">{t.intro(title, fields.length)}</p>
        {fields.map((f, i) => {
          const id = `omg-req-${f.name}`;
          const visible = shown[f.name] === true;
          const common = {
            id,
            name: f.name,
            className: 'omg-input',
            value: values[f.name] ?? '',
            autoFocus: i === 0,
            autoCapitalize: 'off',
            autoCorrect: 'off',
            spellCheck: false,
            'aria-describedby': f.hint ? `${id}-hint` : undefined,
          } as const;
          return (
            <div key={f.name} className="omg-field">
              <label className="omg-label" htmlFor={id}>
                {f.label}
              </label>
              <div className="omg-prompt__row">
                {f.multiline ? (
                  <textarea
                    {...common}
                    rows={4}
                    className={
                      visible ? 'omg-input omg-textarea' : 'omg-input omg-textarea omg-masked'
                    }
                    autoComplete="off"
                    onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                  />
                ) : (
                  <input
                    {...common}
                    type={f.secret && !visible ? 'password' : 'text'}
                    autoComplete={f.autocomplete}
                    onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                  />
                )}
                {f.secret && (
                  <ChromeButton
                    className="omg-btn--icon"
                    aria-label={
                      visible ? t.hide(f.label.toLowerCase()) : t.show(f.label.toLowerCase())
                    }
                    aria-pressed={visible}
                    aria-controls={id}
                    onClick={() => setShown((s) => ({ ...s, [f.name]: !visible }))}
                  >
                    <IconEye off={visible} />
                  </ChromeButton>
                )}
              </div>
              {f.hint && (
                <p id={`${id}-hint`} className="omg-muted">
                  {f.hint}
                </p>
              )}
            </div>
          );
        })}
        <div className="omg-sheet__actions omg-sheet__actions--end">
          <ChromeButton className="omg-btn--ghost" onClick={onCancel}>
            {sessionStrings.common.cancel}
          </ChromeButton>
          <ChromeButton type="submit" className="omg-btn--primary">
            {t.continue}
          </ChromeButton>
        </div>
      </form>
    </Sheet>
  );
}
