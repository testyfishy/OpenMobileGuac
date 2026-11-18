import { useEffect, useState, type FormEvent } from 'react';
import type { ServerProfile } from '../../core/models/ServerProfile.ts';
import { Dialog } from '../components/Dialog.tsx';
import { ErrorBanner, InfoBanner, Spinner } from '../components/Feedback.tsx';
import { TextField, Toggle } from '../components/Form.tsx';
import { Icon } from '../components/Icon.tsx';
import { Screen } from '../components/Screen.tsx';
import { describeError, type UiError } from '../errors/errorMessages.ts';
import { useNav } from '../nav/NavContext.ts';
import { useProfilesVersion, useServices } from '../services/context.ts';
import { strings } from '../strings.ts';
import {
  emptyServerForm,
  hasErrors,
  isInsecureUrl,
  suggestName,
  urlUnchanged,
  validateServerForm,
  type ServerFormErrors,
  type ServerFormValues,
} from './serverForm.ts';
import { useServerProfile } from './useServers.ts';

/** Add / edit a server (SRV-1, SRV-2). Editing an unknown id shows the add form. */
export function ServerEditScreen({ serverId }: { serverId?: string }) {
  const lookup = useServerProfile(serverId);
  if (serverId !== undefined && lookup.status === 'loading') {
    return (
      <Screen title={strings.serverForm.editTitle}>
        <Spinner label={strings.common.loading} />
      </Screen>
    );
  }
  const profile = lookup.status === 'ready' && !lookup.virtual ? lookup.profile : undefined;
  return <ServerForm key={profile?.id ?? 'new'} profile={profile} />;
}

function ServerForm({ profile }: { profile: ServerProfile | undefined }) {
  const nav = useNav();
  const services = useServices();
  const { bump } = useProfilesVersion();
  const f = strings.serverForm;
  const editing = profile !== undefined;

  const [values, setValues] = useState<ServerFormValues>(() =>
    profile
      ? {
          name: profile.name,
          url: profile.baseUrl,
          username: profile.username,
          password: '',
          rememberPassword: profile.rememberPassword,
        }
      : emptyServerForm(),
  );
  const [errors, setErrors] = useState<ServerFormErrors>({});
  const [submitError, setSubmitError] = useState<UiError | undefined>();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [hasSavedPassword, setHasSavedPassword] = useState(false);

  useEffect(() => {
    if (!profile?.rememberPassword) return;
    let live = true;
    void services.auth.loadSecrets(profile).then((s) => {
      if (live) setHasSavedPassword(s.password !== null);
    });
    return () => {
      live = false;
    };
  }, [services.auth, profile]);

  const set = <K extends keyof ServerFormValues>(key: K, value: ServerFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (key === 'name' || key === 'url') setErrors((e) => ({ ...e, [key]: undefined }));
    setSubmitError(undefined);
  };

  const rememberHint =
    services.secretStorage === 'secure'
      ? f.rememberHintSecure
      : services.secretStorage === 'insecure-dev'
        ? f.rememberHintDev
        : f.rememberHintMemory;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const withName = values.name.trim() ? values : { ...values, name: suggestName(values.url) };
    const found = validateServerForm(withName);
    setErrors(found);
    if (hasErrors(found)) return;
    setBusy(true);
    setSubmitError(undefined);
    try {
      let baseUrl = profile?.baseUrl ?? '';
      const urlChanged = !profile || !urlUnchanged(withName.url, profile.baseUrl);
      if (urlChanged) baseUrl = (await services.probeApi.probe(withName.url)).baseUrl;

      const fields = {
        name: withName.name.trim(),
        baseUrl,
        username: withName.username.trim(),
        rememberPassword: withName.rememberPassword,
      };
      const saved = profile
        ? await services.profiles.update(profile.id, fields)
        : await services.profiles.add(fields);
      if (profile && urlChanged) {
        await services.auth.reset(profile.id);
        await services.settings.setHttpWarningDismissed(profile.id, false);
      }
      if (!withName.rememberPassword) {
        await services.auth.savePassword(saved.id, null);
        if (withName.password) services.auth.setTransientPassword(saved.id, withName.password);
      } else if (withName.password) {
        await services.auth.savePassword(saved.id, withName.password);
      }
      bump();
      nav.open({ name: 'connections', serverId: saved.id });
    } catch (err) {
      setSubmitError(describeError(err, { browser: !services.native }));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!profile) return;
    setConfirmDelete(false);
    await services.auth.forgetToken(profile.id);
    await services.profiles.remove(profile.id);
    await services.settings.setHttpWarningDismissed(profile.id, false);
    bump();
    nav.open({ name: 'servers' });
  };

  const typedInsecure = /^\s*http:\/\//i.test(values.url) || (editing && isInsecureUrl(values.url));

  return (
    <Screen title={editing ? f.editTitle : f.addTitle} onBack={nav.back}>
      <form className="form" onSubmit={(e) => void onSubmit(e)} noValidate>
        <TextField
          label={f.url}
          value={values.url}
          onChange={(v) => set('url', v)}
          onBlur={() => {
            if (!values.name.trim()) set('name', suggestName(values.url));
          }}
          placeholder={f.urlPlaceholder}
          hint={f.urlHint}
          error={errors.url}
          type="url"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="url"
          required
        />
        {typedInsecure ? <InfoBanner tone="warning">{f.insecureNote}</InfoBanner> : null}
        <TextField
          label={f.name}
          value={values.name}
          onChange={(v) => set('name', v)}
          placeholder={f.namePlaceholder}
          hint={f.nameHint}
          error={errors.name}
          autoComplete="off"
          required
        />
        <TextField
          label={f.username}
          value={values.username}
          onChange={(v) => set('username', v)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="username"
        />
        <TextField
          label={f.password}
          value={values.password}
          onChange={(v) => set('password', v)}
          type="password"
          autoComplete="current-password"
          placeholder={hasSavedPassword ? f.passwordKeep : undefined}
          hint={hasSavedPassword ? f.passwordKeep : undefined}
        />
        <Toggle
          label={f.remember}
          checked={values.rememberPassword}
          onChange={(v) => set('rememberPassword', v)}
          hint={rememberHint}
        />
        {submitError ? <ErrorBanner error={submitError} /> : null}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? f.checking : strings.common.save}
          </button>
          {editing ? (
            <button
              type="button"
              className="btn btn-danger-ghost btn-block"
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
            >
              <Icon name="trash" /> {f.deleteServer}
            </button>
          ) : null}
        </div>
      </form>
      {confirmDelete && profile ? (
        <Dialog
          title={f.deleteTitle(profile.name)}
          tone="danger"
          onCancel={() => setConfirmDelete(false)}
          actions={
            <>
              <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
                {strings.common.cancel}
              </button>
              <button type="button" className="btn btn-danger" onClick={() => void onDelete()}>
                {strings.common.delete}
              </button>
            </>
          }
        >
          <p>{f.deleteBody}</p>
        </Dialog>
      ) : null}
    </Screen>
  );
}
