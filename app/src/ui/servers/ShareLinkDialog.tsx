import { useState } from 'react';
import { isGuacApiError } from '../../core/api/errors.ts';
import { parseShareLink } from '../../core/links/links.ts';
import { Dialog } from '../components/Dialog.tsx';
import { InfoBanner } from '../components/Feedback.tsx';
import { TextField } from '../components/Form.tsx';
import { describeError } from '../errors/errorMessages.ts';
import { useNav } from '../nav/NavContext.ts';
import { useServices } from '../services/context.ts';
import { haptic } from '../services/native.ts';
import { makeShareProfile } from '../services/shareSessions.ts';
import { strings } from '../strings.ts';
import { HttpWarningDialog } from '../auth/HttpWarningDialog.tsx';
import { hostOf, isInsecureUrl } from './serverForm.ts';

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
    try {
      const existing = (await services.profiles.list()).find((p) => p.baseUrl === link.baseUrl);
      const baseUrl = existing?.baseUrl ?? (await services.probeApi.probe(link.baseUrl)).baseUrl;
      const profile = makeShareProfile(
        link,
        baseUrl,
        s.serverName(existing?.name || hostOf(baseUrl)),
        Date.now(),
        Math.random().toString(36).slice(2, 8),
      );
      await services.auth.loginWithParameters(profile, { key: link.key });
      services.shares.add(profile);
      haptic('success');
      onClose();
      nav.open({ name: 'connections', serverId: profile.id });
    } catch (err) {
      haptic('error');
      setError(
        isGuacApiError(err, 'invalid-credentials') ||
          isGuacApiError(err, 'additional-credentials-required')
          ? s.failed
          : describeError(err, { browser: !services.native }).title,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={s.title}
      onCancel={onClose}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>
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
