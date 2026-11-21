import { useRef, useState } from 'react';
import { GuacApiError, isGuacApiError } from '../../core/api/errors.ts';
import { parseShareLink } from '../../core/links/links.ts';
import { Dialog } from '../components/Dialog.tsx';
import { InfoBanner } from '../components/Feedback.tsx';
import { TextField } from '../components/Form.tsx';
import { describeError, type UiError } from '../errors/errorMessages.ts';
import { useNav } from '../nav/NavContext.ts';
import { useServices } from '../services/context.ts';
import { haptic } from '../services/native.ts';
import { makeShareProfile } from '../services/shareSessions.ts';
import { strings } from '../strings.ts';
import { HttpWarningDialog } from '../auth/HttpWarningDialog.tsx';
import { CertificatePanel } from '../tls/CertificatePanel.tsx';
import { hostOf, isInsecureUrl } from './serverForm.ts';

/** The title and, when there is one, the detail: a field error has room for one line. */
function errorText(e: UiError): string {
  return e.detail ? `${e.title} ${e.detail}` : e.title;
}

/**
 * CON-6: open a Guacamole share link (`…/#/?key=…`). Signs in with the key (no username or
 * password); the resulting session lists the shared connection, which is then opened with
 * the normal `GUAC_TYPE=c` connect.
 *
 * The key session lives under its own temporary server entry (`shareSessions.ts`), even
 * when the link points at a saved server: that server's own sign-in, token and saved
 * credentials are left alone, and nothing about the share is persisted.
 */
export function ShareLinkDialog({ onClose }: { onClose: () => void }) {
  const services = useServices();
  const nav = useNav();
  const s = strings.shareLink;
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const link = parseShareLink(text);
  /** AUDIT §3 #9: a share key goes over plain http only after the same warning as sign-in. */
  const [httpAsk, setHttpAsk] = useState(false);
  /** SRV-8: the https address whose certificate failed, to offer trusting it. */
  const [certUrl, setCertUrl] = useState<string | undefined>();
  /** Cancel while signing in: the late result is dropped (and its key session ended). */
  const cancelled = useRef(false);
  const cancel = () => {
    cancelled.current = true;
    onClose();
  };

  const open = async (httpConfirmed = false) => {
    if (!link) {
      setError(s.invalid);
      return;
    }
    if (isInsecureUrl(link.baseUrl) && !httpConfirmed) {
      setHttpAsk(true);
      return;
    }
    setBusy(true);
    setError(undefined);
    setCertUrl(undefined);
    try {
      const existing = (await services.profiles.list()).find((p) => p.baseUrl === link.baseUrl);
      const baseUrl = existing?.baseUrl ?? (await services.probeApi.probe(link.baseUrl)).baseUrl;
      if (cancelled.current) return;
      const profile = makeShareProfile(
        link,
        baseUrl,
        s.serverName(existing?.name || hostOf(baseUrl)),
        Date.now(),
        Math.random().toString(36).slice(2, 8),
      );
      await services.auth.loginWithParameters(profile, { key: link.key });
      if (cancelled.current) {
        void services.auth.logout(profile.id).catch(() => undefined);
        return;
      }
      services.shares.add(profile);
      haptic('success');
      onClose();
      nav.open({ name: 'connections', serverId: profile.id });
    } catch (err) {
      if (cancelled.current) return;
      haptic('error');
      setError(
        isGuacApiError(err, 'invalid-credentials') ||
          isGuacApiError(err, 'additional-credentials-required')
          ? s.failed
          : errorText(describeError(err, { browser: !services.native })),
      );
      setCertUrl(err instanceof GuacApiError && err.info.kind === 'tls' ? err.info.url : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={s.title}
      onCancel={cancel}
      actions={
        <>
          <button type="button" className="btn" onClick={cancel}>
            {strings.common.cancel}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void open()}
            disabled={busy || text.trim() === ''}
          >
            {busy ? s.signingIn : s.open}
          </button>
        </>
      }
    >
      <TextField
        label={s.label}
        hint={s.hint}
        value={text}
        onChange={(v) => {
          setText(v);
          setError(undefined);
        }}
        type="url"
        inputMode="url"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        error={error}
      />
      {/* SRV-8: a self-signed server that is not saved can be trusted here, as when adding one. */}
      {error && certUrl ? (
        <CertificatePanel url={certUrl} onTrusted={() => void open(true)} />
      ) : null}
      {link && !error ? (
        <InfoBanner>
          {hostOf(link.baseUrl)}. {s.separate}
        </InfoBanner>
      ) : null}
      {httpAsk && link ? (
        <HttpWarningDialog
          host={hostOf(link.baseUrl)}
          rememberable={false}
          onCancel={() => setHttpAsk(false)}
          onProceed={() => {
            setHttpAsk(false);
            void open(true);
          }}
        />
      ) : null}
    </Dialog>
  );
}
