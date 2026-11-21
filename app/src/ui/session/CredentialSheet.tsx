import { useState, type FormEvent } from 'react';
import type { RequiredField } from '../../session/credentials/requiredParams.ts';
import { offersRemember, type RememberPolicy } from '../../session/credentials/rememberedParams.ts';
import { ChromeButton } from './ChromeButton.tsx';
import { IconEye } from './icons.tsx';
import { sessionStrings } from './sessionStrings.ts';
import { Sheet } from './Sheet.tsx';

export interface CredentialSheetProps {
  readonly title: string;
  readonly fields: readonly RequiredField[];
  /**
   * The "Remember connection passwords" setting, or null when nothing can be remembered
   * here (Demo, a joined or shared session). Null and `never` hide the Remember box.
   */
  readonly rememberPolicy?: RememberPolicy | null;
  /** `remember`: the Remember box was ticked (always false when it is hidden). */
  readonly onSubmit: (values: Record<string, string>, remember: boolean) => void;
  readonly onCancel: () => void;
}

/**
 * The server asked for connection parameters (`required`, SRV-11). The values live only in
 * this component's state until Continue. They are never logged; they are remembered only
 * when the Remember box (shown by the setting, ticked by default) is left ticked.
 */
export function CredentialSheet({
  title,
  fields,
  rememberPolicy,
  onSubmit,
  onCancel,
}: CredentialSheetProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [remember, setRemember] = useState(true);
  const t = sessionStrings.credentials;
  const offer = offersRemember(rememberPolicy);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(values, offer && remember);
    setValues({});
  };

  return (
    <Sheet
      title={t.title}
      onClose={onCancel}
      dismissible={false}
      closeLabel={t.cancelAndDisconnect}
      className="omg-sheet--prompt omg-sheet--card"
      layerClassName="omg-sheet-layer--card"
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
        {offer && (
          <div className="omg-field omg-prompt__remember">
            <label className="omg-prompt__check" htmlFor="omg-req-remember">
              <input
                id="omg-req-remember"
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                aria-describedby="omg-req-remember-hint"
              />
              <span>{t.remember}</span>
            </label>
            <p id="omg-req-remember-hint" className="omg-muted">
              {remember ? t.rememberFor[rememberPolicy] : t.notRemembered}
            </p>
          </div>
        )}
        <div className="omg-sheet__actions omg-sheet__actions--end omg-prompt__actions">
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
