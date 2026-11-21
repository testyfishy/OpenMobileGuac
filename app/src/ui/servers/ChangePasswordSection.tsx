import { useEffect, useState, type FormEvent } from 'react';
import { isGuacApiError } from '../../core/api/errors.ts';
import type { ServerProfile } from '../../core/models/ServerProfile.ts';
import type { TranslationTable } from '../admin/labels.ts';
import { loadTranslations } from '../admin/translations.ts';
import { serverTextOf } from '../auth/authFlow.ts';
import { serverMessageText } from '../auth/serverText.ts';
import { ErrorBanner } from '../components/Feedback.tsx';
import { TextField } from '../components/Form.tsx';
import { Icon } from '../components/Icon.tsx';
import { useToast } from '../components/toastContext.ts';
import { describeError, type UiError } from '../errors/errorMessages.ts';
import { haptic } from '../services/native.ts';
import { useServices } from '../services/context.ts';
import { strings } from '../strings.ts';

type Availability = 'checking' | 'signed-out' | 'allowed' | 'not-allowed';

/**
 * "Change password" for the account this server profile signs in with (Guacamole web client:
 * Settings › Preferences). Uses the live session, so it is offered only while signed in, and
 * only when the server lets the account update itself (`AuthService.canChangePassword`).
 * Not shown for the demo, the dev server or share links (the edit screen has no profile for
 * them). A password saved on this device is replaced on success. Passwords are never logged.
 */
export function ChangePasswordSection({ profile }: { profile: ServerProfile }) {
  const services = useServices();
  const toast = useToast();
  const c = strings.serverForm.changePassword;
  const [availability, setAvailability] = useState<Availability>('checking');
  const [open, setOpen] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<{ old?: string; confirm?: string; new?: string }>(
    {},
  );
  const [error, setError] = useState<UiError | undefined>(undefined);
  const [table, setTable] = useState<TranslationTable | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    const check = () => {
      if (!services.auth.current(profile.id)) {
        setAvailability('signed-out');
        return;
      }
      void services.auth.canChangePassword(profile.id).then((ok) => {
        if (live) setAvailability(ok ? 'allowed' : 'not-allowed');
      });
    };
    check();
    const off = services.auth.onSessionChange((id) => {
      if (id === profile.id) check();
    });
    return () => {
      live = false;
      off();
    };
  }, [services.auth, profile.id]);

  useEffect(() => {
    if (!open || table !== undefined) return undefined;
    let live = true;
    void loadTranslations(services.admin, profile.baseUrl).then((t) => {
      if (live) setTable(t);
    });
    return () => {
      live = false;
    };
  }, [open, table, services.admin, profile.baseUrl]);

  const reset = () => {
    setOldPassword('');
    setNewPassword('');
    setConfirm('');
    setFieldError({});
    setError(undefined);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(undefined);
    if (!newPassword) {
      setFieldError({ new: c.blank });
      return;
    }
    if (newPassword !== confirm) {
      setFieldError({ confirm: c.mismatch });
      return;
    }
    setFieldError({});
    setBusy(true);
    try {
      const { savedUpdated } = await services.auth.changePassword(
        profile,
        oldPassword,
        newPassword,
      );
      haptic('success');
      reset();
      setOpen(false);
      toast.show(savedUpdated ? c.doneSaved : c.done);
    } catch (err) {
      haptic('error');
      if (isGuacApiError(err, 'invalid-credentials')) {
        setFieldError({ old: c.wrongOld });
        setOldPassword('');
      } else if (isGuacApiError(err) && err.info.kind === 'server-error') {
        // Password policy and similar refusals: the server's own reason.
        const text = serverMessageText(serverTextOf(err.info), table);
        setError({
          code: `server-${err.info.type}`,
          title: c.rejectedTitle,
          ...(text ? { detail: text } : {}),
        });
      } else {
        setError(describeError(err, { browser: !services.native }));
        if (isGuacApiError(err, 'session-expired')) setAvailability('signed-out');
      }
    } finally {
      setBusy(false);
    }
  };

  if (availability === 'checking') return null;
  return (
    <section className="settings-group" aria-labelledby="srv-password">
      <h2 id="srv-password" className="section-title">
        <Icon name="key" size="1rem" /> {c.title}
      </h2>
      {availability === 'signed-out' ? (
        <p className="muted">{c.signInFirst}</p>
      ) : availability === 'not-allowed' ? (
        <p className="muted">{c.notAllowed}</p>
      ) : !open ? (
        <>
          <p className="muted">{c.hint}</p>
          <button type="button" className="btn" onClick={() => setOpen(true)}>
            <Icon name="key" /> {c.open}
          </button>
        </>
      ) : (
        <form className="form" onSubmit={(e) => void submit(e)} noValidate>
          {error ? <ErrorBanner error={error} /> : null}
          {/* Lets password managers tie the change to the right account. */}
          <input
            type="text"
            name="username"
            autoComplete="username"
            value={profile.username}
            readOnly
            hidden
          />
          <TextField
            label={c.oldPassword}
            value={oldPassword}
            onChange={setOldPassword}
            type="password"
            autoComplete="current-password"
            error={fieldError.old}
            disabled={busy}
          />
          <TextField
            label={c.newPassword}
            value={newPassword}
            onChange={setNewPassword}
            type="password"
            autoComplete="new-password"
            error={fieldError.new}
            disabled={busy}
          />
          <TextField
            label={c.confirmPassword}
            value={confirm}
            onChange={setConfirm}
            type="password"
            autoComplete="new-password"
            error={fieldError.confirm}
            disabled={busy}
          />
          <div className="form-actions">
            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
              {busy ? c.busy : c.submit}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-block"
              disabled={busy}
              onClick={() => {
                reset();
                setOpen(false);
              }}
            >
              {strings.common.cancel}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
