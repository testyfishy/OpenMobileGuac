import { useId, useState, type FormEvent } from 'react';
import { FieldType, type FieldDescriptor } from '../../core/models/ApiErrorBody.ts';
import { ErrorBanner, InfoBanner } from '../components/Feedback.tsx';
import { TextField, Toggle } from '../components/Form.tsx';
import { strings } from '../strings.ts';
import { visibleExtraFields, type AuthFlowState, type LoginValues } from './authFlow.ts';

export interface LoginFormProps {
  serverName: string;
  state:
    Extract<AuthFlowState, { phase: 'form' }> | Extract<AuthFlowState, { phase: 'signing-in' }>;
  rememberHint: string;
  onSubmit: (values: Partial<LoginValues>) => void;
  onStartOver: () => void;
}

/** Username/password, then any additional fields the server asks for (SRV-4, SRV-5). */
export function LoginForm({
  serverName,
  state,
  rememberHint,
  onSubmit,
  onStartOver,
}: LoginFormProps) {
  const l = strings.login;
  const busy = state.phase === 'signing-in';
  const step = state.step;
  const [username, setUsername] = useState(state.values.username);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(state.values.remember);
  const [extra, setExtra] = useState<Record<string, string>>({});
  const fields = visibleExtraFields(state.expected);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (step === 'credentials') {
      onSubmit({ username: username.trim(), password, remember });
      setPassword('');
    } else {
      onSubmit({ extra });
      setExtra({});
    }
  };

  return (
    <form className="form login-form" onSubmit={submit} noValidate>
      <h2 className="form-title">{step === 'extra' ? l.additionalTitle : l.title(serverName)}</h2>
      {state.phase === 'form' && state.notice ? <InfoBanner>{state.notice}</InfoBanner> : null}
      {state.phase === 'form' && state.error ? <ErrorBanner error={state.error} /> : null}
      {step === 'credentials' ? (
        <>
          <TextField
            label={strings.serverForm.username}
            value={username}
            onChange={setUsername}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="username"
            disabled={busy}
          />
          <TextField
            label={strings.serverForm.password}
            value={password}
            onChange={setPassword}
            type="password"
            autoComplete="current-password"
            disabled={busy}
          />
          <Toggle
            label={strings.serverForm.remember}
            checked={remember}
            onChange={setRemember}
            hint={rememberHint}
            disabled={busy}
          />
        </>
      ) : (
        <>
          <p className="muted">{l.additionalHint}</p>
          {fields.map((f, i) => (
            <ExtraField
              key={f.name}
              field={f}
              value={extra[f.name] ?? ''}
              autoFocus={i === 0}
              disabled={busy}
              onChange={(v) => setExtra((x) => ({ ...x, [f.name]: v }))}
            />
          ))}
        </>
      )}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? l.signingIn : l.signIn}
        </button>
        {step === 'extra' ? (
          <button
            type="button"
            className="btn btn-ghost btn-block"
            onClick={onStartOver}
            disabled={busy}
          >
            {l.useDifferentAccount}
          </button>
        ) : null}
      </div>
    </form>
  );
}

function prettyName(name: string): string {
  const s = name.replace(/^guac-/, '').replace(/[-_]+/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Renders one server-requested field from its descriptor. */
function ExtraField({
  field,
  value,
  onChange,
  autoFocus,
  disabled,
}: {
  field: FieldDescriptor;
  value: string;
  onChange: (value: string) => void;
  autoFocus: boolean;
  disabled: boolean;
}) {
  const selectId = useId();
  const l = strings.login;
  switch (field.type) {
    case FieldType.GUAC_TOTP_CODE: {
      const secret = typeof field.extra['secret'] === 'string' ? field.extra['secret'] : undefined;
      const qr = typeof field.extra['qrCode'] === 'string' ? field.extra['qrCode'] : undefined;
      return (
        <>
          {secret ? (
            <div className="totp-enroll">
              <p className="muted">{l.totpEnrollHint}</p>
              {qr && qr.startsWith('data:image/') ? (
                <img className="totp-qr" src={qr} alt="" width={180} height={180} />
              ) : null}
              <p>
                {l.totpSecret}: <code className="totp-secret">{secret}</code>
              </p>
            </div>
          ) : null}
          <TextField
            label={l.totpLabel}
            hint={l.totpHint}
            value={value}
            onChange={(v) => onChange(v.replace(/\s+/g, ''))}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            autoFocus={autoFocus}
            disabled={disabled}
          />
        </>
      );
    }
    case FieldType.BOOLEAN:
      return (
        <Toggle
          label={prettyName(field.name)}
          checked={value === 'true'}
          onChange={(c) => onChange(c ? 'true' : '')}
          disabled={disabled}
        />
      );
    case FieldType.ENUM:
      return (
        <div className="field">
          <label htmlFor={selectId} className="field-label">
            {prettyName(field.name)}
          </label>
          <select
            id={selectId}
            className="field-input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
          >
            <option value="" />
            {(field.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
      );
    default:
      return (
        <TextField
          label={prettyName(field.name)}
          value={value}
          onChange={onChange}
          type={
            field.type === FieldType.PASSWORD
              ? 'password'
              : field.type === FieldType.EMAIL
                ? 'email'
                : 'text'
          }
          inputMode={field.type === FieldType.NUMERIC ? 'numeric' : undefined}
          autoCapitalize="none"
          autoCorrect="off"
          autoFocus={autoFocus}
          disabled={disabled}
        />
      );
  }
}
