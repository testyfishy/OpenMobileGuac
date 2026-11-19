import { useState } from 'react';
import { isGuacApiError } from '../../core/api/errors.ts';
import { parseShareLink } from '../../core/links/links.ts';
import { Dialog } from '../components/Dialog.tsx';
import { InfoBanner } from '../components/Feedback.tsx';
import { TextField } from '../components/Form.tsx';
import { describeError } from '../errors/errorMessages.ts';
import { useNav } from '../nav/NavContext.ts';
import { useProfilesVersion, useServices } from '../services/context.ts';
import { haptic } from '../services/native.ts';
import { strings } from '../strings.ts';
import { hostOf } from './serverForm.ts';

/**
 * CON-6: open a Guacamole share link (`…/#/?key=…`). Signs in with the key (no username or
 * password); the resulting session lists the shared connection, which is then opened with
 * the normal `GUAC_TYPE=c` connect.
 */
export function ShareLinkDialog({ onClose }: { onClose: () => void }) {
  const services = useServices();
  const nav = useNav();
  const { bump } = useProfilesVersion();
  const s = strings.shareLink;
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const link = parseShareLink(text);

  const open = async () => {
    if (!link) {
      setError(s.invalid);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const existing = (await services.profiles.list()).find((p) => p.baseUrl === link.baseUrl);
      const profile =
        existing ??
        (await services.profiles.add({
          name: hostOf(link.baseUrl),
          baseUrl: (await services.probeApi.probe(link.baseUrl)).baseUrl,
        }));
      if (!existing) bump();
      await services.auth.loginWithParameters(profile, { key: link.key });
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
      {link && !error ? <InfoBanner>{hostOf(link.baseUrl)}</InfoBanner> : null}
    </Dialog>
  );
}
