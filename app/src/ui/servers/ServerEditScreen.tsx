import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ServerProfile } from '../../core/models/ServerProfile.ts';
import { GuacApiError } from '../../core/api/errors.ts';
import { sameServerEndpoint, serverHostLabel } from '../../core/url/normalizeServerUrl.ts';
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
  signInChangeOf,
  suggestName,
  urlUnchanged,
  validateServerForm,
  type ServerFormErrors,
  type ServerFormValues,
} from './serverForm.ts';
import { useServerProfile } from './useServers.ts';
import { ChangePasswordSection } from './ChangePasswordSection.tsx';
import { ConnectionTestPanel, ServerOptionsSection, TotpSeedSection } from './ServerExtras.tsx';
import { useSessions } from '../sessions/SessionsContext.ts';
import { useToast } from '../components/toastContext.ts';
import { CertificatePanel } from '../tls/CertificatePanel.tsx';
import { CertificateRow } from '../tls/CertificateRow.tsx';

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
  /** https failed and no scheme was typed: offer plain http explicitly (AUDIT #11). */
  const [offerHttp, setOfferHttp] = useState(false);
  /** SRV-8: the https URL whose certificate failed, to offer trusting it. */
  const [certUrl, setCertUrl] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [hasSavedPassword, setHasSavedPassword] = useState(false);
  /** Address change waiting for the user's OK: old → new endpoint (AUDIT #2). */
  const [pendingMove, setPendingMove] = useState<
    { readonly values: ServerFormValues; readonly baseUrl: string } | undefined
  >();
  const sessions = useSessions();
  const toast = useToast();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!profile?.rememberPassword) return;
    let live = true;
    void services.auth.hasSavedPassword(profile).then((has) => {
      if (live) setHasSavedPassword(has);
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

  const onSubmit = async (e: FormEvent | null, allowHttp = false) => {
    e?.preventDefault();
    if (busy) return;
    setOfferHttp(false);
    setCertUrl(undefined);
    const withName = values.name.trim() ? values : { ...values, name: suggestName(values.url) };
    const found = validateServerForm(withName);
    setErrors(found);
    if (hasErrors(found)) return;
    setBusy(true);
    setSubmitError(undefined);
    try {
      let baseUrl = profile?.baseUrl ?? '';
      const urlChanged = !profile || !urlUnchanged(withName.url, profile.baseUrl);
      // The probe is unauthenticated (no credential is sent) and decides the real address.
      if (urlChanged)
        baseUrl = (await services.probeApi.probe(withName.url, { allowHttp })).baseUrl;
      // Back during "Checking server…" abandons the form: nothing is saved.
      if (!alive.current) return;
      if (profile && !sameServerEndpoint(profile.baseUrl, baseUrl)) {
        // Saved secrets belong to the old address: ask first, showing old → new.
        setPendingMove({ values: withName, baseUrl });
        return;
      }
      await commit(withName, baseUrl);
    } catch (err) {
      setSubmitError(describeError(err, { browser: !services.native }));
      setOfferHttp(err instanceof GuacApiError && err.httpFallbackAvailable);
      setCertUrl(err instanceof GuacApiError && err.info.kind === 'tls' ? err.info.url : undefined);
    } finally {
      setBusy(false);
    }
  };

  const commit = async (withName: ServerFormValues, baseUrl: string) => {
    const fields = {
      name: withName.name.trim(),
      baseUrl,
      username: withName.username.trim(),
      rememberPassword: withName.rememberPassword,
    };
    const moved = profile !== undefined && !sameServerEndpoint(profile.baseUrl, baseUrl);
    const change = profile ? signInChangeOf(profile, moved, fields.username) : 'none';
    if (profile && change === 'moved') {
      // Sign out on the old host and drop its token, password and TOTP seed *before* the
      // profile points anywhere else, so none of them can reach the new host.
      sessions.closeServer(profile.id);
      await services.auth.reset(profile.id);
      await services.settings.setHttpWarningDismissed(profile.id, false);
    } else if (profile && change === 'account') {
      // Another account: the old one's session and token must not answer for it, nor its
      // saved password be sent as the new one's. (The TOTP seed is kept: it may be the
      // only copy.)
      sessions.closeServer(profile.id);
      await services.auth.logout(profile.id);
      if (!withName.password) await services.auth.savePassword(profile.id, null);
    }
    const saved = profile
      ? await services.profiles.update(profile.id, fields)
      : await services.profiles.add(fields);
    // SRV-8: a certificate trusted during this probe is saved with the profile.
    await services.tls.adoptPending(saved);
    if (!withName.rememberPassword) {
      await services.auth.savePassword(saved.id, null);
      if (withName.password) services.auth.setTransientPassword(saved.id, withName.password);
    } else if (withName.password) {
      await services.auth.savePassword(saved.id, withName.password);
    }
    bump();
    // Left with Back while this ran: the save stands, but do not jump to it.
    if (alive.current) nav.open({ name: 'connections', serverId: saved.id });
  };

  const confirmMove = async () => {
    const move = pendingMove;
    if (!move) return;
    setPendingMove(undefined);
    setBusy(true);
    try {
      await commit(move.values, move.baseUrl);
    } catch (err) {
      setSubmitError(describeError(err, { browser: !services.native }));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!profile) return;
    setConfirmDelete(false);
    sessions.closeServer(profile.id);
    // Ends the session on the server too (with the stored token when none is live), then
    // removes every secret (AUDIT §3 #10).
    await services.auth.signOutLocally([profile]);
    await services.profiles.remove(profile.id);
    await services.settings.setHttpWarningDismissed(profile.id, false);
    bump();
    nav.open({ name: 'servers' });
  };

  const onDuplicate = async () => {
    if (!profile) return;
    const copy = await services.profiles.duplicate(profile.id, f.duplicateName(profile.name));
    bump();
    nav.open({ name: 'server-edit', serverId: copy.id });
  };

  const onClearCredentials = async () => {
    if (!profile) return;
    setConfirmClear(false);
    sessions.closeServer(profile.id);
    await services.auth.signOutLocally([profile]);
    setHasSavedPassword(false);
    toast.show(f.credentialsCleared);
  };

  const addressEdited = profile !== undefined && !urlUnchanged(values.url, profile.baseUrl);
  // Delete and Clear credentials close these too: their dialogs say so.
  const openHere = profile
    ? sessions.state.sessions.filter((s) => s.serverId === profile.id).length
    : 0;
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
          placeholder={hasSavedPassword && !addressEdited ? f.passwordKeep : undefined}
          hint={
            addressEdited ? f.passwordNewAddress : hasSavedPassword ? f.passwordKeep : undefined
          }
        />
        <Toggle
          label={f.remember}
          checked={values.rememberPassword}
          onChange={(v) => set('rememberPassword', v)}
          hint={rememberHint}
        />
        {submitError ? <ErrorBanner error={submitError} /> : null}
        {submitError && certUrl ? (
          <CertificatePanel url={certUrl} onTrusted={() => void onSubmit(null)} />
        ) : null}
        {offerHttp ? (
          <div className="http-fallback">
            <p className="field-hint">{f.httpFallbackHint}</p>
            <button
              type="button"
              className="btn btn-block"
              disabled={busy}
              onClick={() => void onSubmit(null, true)}
            >
              <Icon name="alert" /> {f.httpFallback}
            </button>
          </div>
        ) : null}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? f.checking : strings.common.save}
          </button>
          <ConnectionTestPanel url={values.url} />
        </div>
      </form>
      {profile ? (
        <div className="form server-extras">
          <ServerOptionsSection profile={profile} />
          <TotpSeedSection profile={profile} />
          <ChangePasswordSection profile={profile} />
          <CertificateRow profile={profile} />
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-block"
              onClick={() => void onDuplicate()}
              disabled={busy}
            >
              <Icon name="copy" /> {f.duplicate}
            </button>
            <button
              type="button"
              className="btn btn-block"
              onClick={() => setConfirmClear(true)}
              disabled={busy}
            >
              <Icon name="key" /> {f.clearCredentials}
            </button>
            <button
              type="button"
              className="btn btn-danger-ghost btn-block"
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
            >
              <Icon name="trash" /> {f.deleteServer}
            </button>
          </div>
        </div>
      ) : null}
      {pendingMove && profile ? (
        <Dialog
          title={f.moveTitle}
          tone="warning"
          onCancel={() => setPendingMove(undefined)}
          actions={
            <>
              <button type="button" className="btn" onClick={() => setPendingMove(undefined)}>
                {strings.common.cancel}
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void confirmMove()}>
                {f.moveConfirm}
              </button>
            </>
          }
        >
          <p>
            <span className="mono">{serverHostLabel(profile.baseUrl)}</span>
            {' → '}
            <span className="mono">{serverHostLabel(pendingMove.baseUrl)}</span>
          </p>
          <p>{f.moveBody}</p>
        </Dialog>
      ) : null}
      {confirmClear && profile ? (
        <Dialog
          title={f.clearCredentialsTitle}
          tone="warning"
          onCancel={() => setConfirmClear(false)}
          actions={
            <>
              <button type="button" className="btn" onClick={() => setConfirmClear(false)}>
                {strings.common.cancel}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void onClearCredentials()}
              >
                {strings.common.remove}
              </button>
            </>
          }
        >
          <p>{f.clearCredentialsBody}</p>
          {openHere > 0 ? <p>{strings.settings.signOutSessions(openHere)}</p> : null}
        </Dialog>
      ) : null}
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
          {openHere > 0 ? <p>{strings.settings.signOutSessions(openHere)}</p> : null}
        </Dialog>
      ) : null}
    </Screen>
  );
}
