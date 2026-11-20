import { useEffect, useId, useState, type FormEvent } from 'react';
import { FieldType, type FieldDescriptor } from '../../core/models/ApiErrorBody.ts';
import type { SsoKind } from '../../core/sso/sso.ts';
import { secondsRemaining, totpAt, totpCounter, type TotpParams } from '../../core/totp/totp.ts';
import { ErrorBanner, InfoBanner } from '../components/Feedback.tsx';
import { TextField, Toggle } from '../components/Form.tsx';
import { Icon } from '../components/Icon.tsx';
import { strings } from '../strings.ts';
import { visibleExtraFields, type AuthFlowState, type LoginValues } from './authFlow.ts';

export interface SsoProps {
  readonly kind: SsoKind;
  readonly available: boolean;
  readonly busy: boolean;
  readonly error?: string;
  readonly onStart: () => void;
}

export interface TotpAutofillProps {
  readonly seed: TotpParams;
  /** Time step of the last code this app sent to the server (reuse is refused). */
  readonly lastCounter: number | undefined;
  readonly onSent: (period: number) => void;
}

export interface LoginFormProps {
  serverName: string;
  state:
    Extract<AuthFlowState, { phase: 'form' }> | Extract<AuthFlowState, { phase: 'signing-in' }>;
  rememberHint: string;
  onSubmit: (values: Partial<LoginValues>) => void;
  onStartOver: () => void;
  /** SRV-7: the server signs in through an identity provider. */
  sso?: SsoProps;
  /** SRV-9: fill the TOTP field from the stored seed. */
  totp?: TotpAutofillProps;
  /** Offer to store an enrolment key (shown only when storing is allowed). */
  onEnrollSecret?: (secret: string, field: FieldDescriptor) => void;
  /** A banner above the form (for example "unlock was cancelled"). */
  notice?: string;
}

/** Username/password, then any additional fields the server asks for (SRV-4, SRV-5). */
export function LoginForm({
  serverName,
  state,
  rememberHint,
  onSubmit,
  onStartOver,
  sso,
  totp,
  onEnrollSecret,
  notice,
}: LoginFormProps) {
  const l = strings.login;
  const busy = state.phase === 'signing-in';
  const step = state.step;
  const [username, setUsername] = useState(state.values.username);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(state.values.remember);
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [saveEnrolment, setSaveEnrolment] = useState(false);
  const fields = visibleExtraFields(state.expected);
  const totpField = fields.find((f) => f.type === FieldType.GUAC_TOTP_CODE);
  const auto = useTotpCode(totp && totpField ? totp : undefined);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (step === 'credentials') {
      onSubmit({ username: username.trim(), password, remember });
      setPassword('');
    } else {
      const values = { ...extra };
      if (totpField && auto.code && !values[totpField.name]) {
        if (auto.waiting) return;
        values[totpField.name] = auto.code;
        totp?.onSent(totp.seed.period);
      }
      const enrolSecret =
        totpField && typeof totpField.extra['secret'] === 'string'
          ? totpField.extra['secret']
          : undefined;
      if (enrolSecret && saveEnrolment && onEnrollSecret && totpField)
        onEnrollSecret(enrolSecret, totpField);
      onSubmit({ extra: values });
      setExtra({});
    }
  };

  return (
    <form className="form login-form" onSubmit={submit} noValidate>
      <h2 className="form-title">{step === 'extra' ? l.additionalTitle : l.title(serverName)}</h2>
      {notice ? <InfoBanner>{notice}</InfoBanner> : null}
      {state.phase === 'form' && state.notice ? <InfoBanner>{state.notice}</InfoBanner> : null}
      {state.phase === 'form' && state.error ? <ErrorBanner error={state.error} /> : null}
      {sso && step === 'credentials' ? <SsoSection sso={sso} /> : null}
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
              value={extra[f.name] ?? (f === totpField && auto.code ? auto.code : '')}
              autoFocus={i === 0 && !(f === totpField && auto.code)}
              disabled={busy}
              autofill={f === totpField ? auto : undefined}
              saveEnrolment={f === totpField && onEnrollSecret ? saveEnrolment : undefined}
              onSaveEnrolment={setSaveEnrolment}
              onChange={(v) => setExtra((x) => ({ ...x, [f.name]: v }))}
            />
          ))}
        </>
      )}
      <div className="form-actions">
        <button
          type="submit"
          className="btn btn-primary btn-block"
          disabled={
            busy || (step === 'extra' && auto.waiting && !(totpField && extra[totpField.name]))
          }
        >
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

function SsoSection({ sso }: { sso: SsoProps }) {
  const s = strings.login.sso;
  return (
    <div className="sso-box">
      <p className="sso-title">
        <Icon name="globe" /> {s.title}
      </p>
      <p>{s.body(s.providers[sso.kind] ?? s.providers['unknown'] ?? '')}</p>
      {sso.error ? <p className="field-error">{sso.error}</p> : null}
      {sso.available ? (
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={sso.onStart}
          disabled={sso.busy}
        >
          {sso.busy ? s.waiting : s.button}
        </button>
      ) : (
        <p className="muted">{s.unavailable}</p>
      )}
      <p className="field-hint">{s.experimental}</p>
    </div>
  );
}

interface AutoCode {
  readonly code: string | undefined;
  readonly secondsLeft: number;
  /** The current step's code was already sent; waiting for the next. */
  readonly waiting: boolean;
}

/** The live code from the stored seed, refreshed every second. */
function useTotpCode(p: TotpAutofillProps | undefined): AutoCode {
  const [now, setNow] = useState(() => Date.now());
  const [code, setCode] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!p) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [p]);
  const seed = p?.seed;
  const counter = seed ? totpCounter(now, seed.period) : undefined;
  useEffect(() => {
    if (!seed || counter === undefined) return;
    let live = true;
    void totpAt(seed, counter * seed.period * 1000).then((c) => {
      if (live) setCode(c);
    });
    return () => {
      live = false;
    };
  }, [seed, counter]);
  if (!seed || counter === undefined) return { code: undefined, secondsLeft: 0, waiting: false };
  return {
    code,
    secondsLeft: secondsRemaining(now, seed.period),
    waiting: p?.lastCounter !== undefined && counter <= p.lastCounter,
  };
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
  autofill,
  saveEnrolment,
  onSaveEnrolment,
}: {
  field: FieldDescriptor;
  value: string;
  onChange: (value: string) => void;
  autoFocus: boolean;
  disabled: boolean;
  autofill?: AutoCode;
  saveEnrolment?: boolean;
  onSaveEnrolment: (v: boolean) => void;
}) {
  const selectId = useId();
  const l = strings.login;
  switch (field.type) {
    case FieldType.GUAC_TOTP_CODE: {
      const secret = typeof field.extra['secret'] === 'string' ? field.extra['secret'] : undefined;
      const qr = typeof field.extra['qrCode'] === 'string' ? field.extra['qrCode'] : undefined;
      const hint = autofill?.code
        ? autofill.waiting
          ? l.totpWaiting(autofill.secondsLeft)
          : l.totpAutofilled(autofill.secondsLeft)
        : l.totpHint;
      return (
        <>
          {secret ? (
            <div className="totp-enroll">
              <p className="muted">{l.totpEnrollHint}</p>
              {qr && qr.startsWith('data:image/') ? (
                <img className="totp-qr" src={qr} alt={l.totpQrAlt} width={180} height={180} />
              ) : null}
              <p>
                {l.totpSecret}: <code className="totp-secret">{secret}</code>
              </p>
              <p className="muted">{l.totpParams(enrolmentParams(field.extra))}</p>
              {saveEnrolment !== undefined ? (
                <Toggle
                  label={strings.serverForm.totp.enable}
                  hint={strings.serverForm.totp.warning}
                  checked={saveEnrolment}
                  onChange={onSaveEnrolment}
                  disabled={disabled}
                />
              ) : null}
            </div>
          ) : null}
          <TextField
            label={l.totpLabel}
            hint={hint}
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

/** "6 digits, every 30 s, SHA1" for the setup-key text (what an authenticator app needs). */
function enrolmentParams(extra: Readonly<Record<string, unknown>>): {
  digits: number;
  period: number;
  algorithm: string;
} {
  const n = (v: unknown, d: number) =>
    typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : d;
  return {
    digits: n(extra['digits'], 6),
    period: n(extra['period'], 30),
    algorithm: typeof extra['mode'] === 'string' ? extra['mode'].toUpperCase() : 'SHA1',
  };
}
