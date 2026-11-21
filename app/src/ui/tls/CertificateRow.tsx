import { useState } from 'react';
import type { ServerProfile } from '../../core/models/ServerProfile.ts';
import { pinOrigin } from '../../core/tls/fingerprint.ts';
import { pinForBaseUrl } from '../../core/tls/TlsPin.ts';
import { Dialog } from '../components/Dialog.tsx';
import { Icon } from '../components/Icon.tsx';
import { useToast } from '../components/toastContext.ts';
import { useProfilesVersion, useServices } from '../services/context.ts';
import { strings } from '../strings.ts';
import { PinDetails } from './CertificatePanel.tsx';
import { tlsStrings } from './tlsStrings.ts';

/**
 * SRV-8: the "Certificate" row of a saved server: the pinned fingerprint with "Forget", or a
 * note that the device's trust store is used. Hidden on the web build and for http servers.
 */
export function CertificateRow({ profile }: { profile: ServerProfile }) {
  const services = useServices();
  const { bump } = useProfilesVersion();
  const toast = useToast();
  const t = tlsStrings();
  const [confirm, setConfirm] = useState(false);
  const [forgotten, setForgotten] = useState(false);
  const origin = pinOrigin(profile.baseUrl);
  if (!services.tls.available || origin === undefined) return null;
  const pin = forgotten ? undefined : pinForBaseUrl(profile.tlsPin, profile.baseUrl);

  const forget = async () => {
    setConfirm(false);
    await services.tls.forget(profile.baseUrl);
    setForgotten(true);
    bump();
    toast.show(t.row.forgotten);
  };

  return (
    <section className="settings-group" aria-labelledby="srv-tls">
      <h2 id="srv-tls" className="section-title">
        <Icon name="lock" size="1rem" /> {t.title}
      </h2>
      {pin ? (
        <>
          <p>{t.row.pinned}</p>
          <PinDetails pin={pin} />
          {pin.pinnedAt ? (
            <p className="field-hint">
              {t.row.pinnedAt(new Date(pin.pinnedAt).toLocaleDateString())}
            </p>
          ) : null}
          <p className="field-hint">{t.row.sharedNote}</p>
          <button
            type="button"
            className="btn btn-danger-ghost btn-block"
            onClick={() => setConfirm(true)}
          >
            <Icon name="trash" /> {t.row.forget}
          </button>
        </>
      ) : (
        <p className="muted">{t.row.none}</p>
      )}
      {confirm ? (
        <Dialog
          title={t.row.forgetTitle}
          tone="warning"
          onCancel={() => setConfirm(false)}
          actions={
            <>
              <button type="button" className="btn" onClick={() => setConfirm(false)}>
                {strings.common.cancel}
              </button>
              <button type="button" className="btn btn-danger" onClick={() => void forget()}>
                {t.row.forget}
              </button>
            </>
          }
        >
          <p>{t.row.forgetBody}</p>
        </Dialog>
      ) : null}
    </section>
  );
}
