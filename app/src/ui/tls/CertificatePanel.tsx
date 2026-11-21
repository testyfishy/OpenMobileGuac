import { useEffect, useState } from 'react';
import { formatFingerprint, pinOrigin } from '../../core/tls/fingerprint.ts';
import type { TlsPin } from '../../core/tls/TlsPin.ts';
import type { CertificateVerdict, PresentedCertificate } from '../../core/tls/TlsTrustService.ts';
import { formatName } from '../../core/tls/x509.ts';
import { Dialog } from '../components/Dialog.tsx';
import { InfoBanner, Spinner } from '../components/Feedback.tsx';
import { Icon } from '../components/Icon.tsx';
import { useServices } from '../services/context.ts';
import { activeLocale, strings } from '../strings.ts';
import { tlsStrings } from './tlsStrings.ts';

/** Shown next to the fingerprint so the user can compare it on the server. */
export const FINGERPRINT_COMMAND = 'openssl x509 -noout -fingerprint -sha256 -in cert.pem';

function formatDate(ms: number): string {
  if (!ms) return '?';
  try {
    return new Date(ms).toLocaleDateString(activeLocale(), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

/** Fingerprint in groups, wrapped so it stays readable on a phone. */
export function Fingerprint({ sha256 }: { sha256: string }) {
  return (
    <code className="mono tls-fingerprint" style={{ wordBreak: 'break-all' }}>
      {formatFingerprint(sha256)}
    </code>
  );
}

/** Subject, issuer, validity and fingerprint of a presented certificate. */
export function PresentedDetails({ cert, now }: { cert: PresentedCertificate; now: number }) {
  const t = tlsStrings();
  const d = cert.details;
  return (
    <dl className="tls-details">
      <dt>{t.fingerprint}</dt>
      <dd>
        <Fingerprint sha256={cert.sha256} />
      </dd>
      {d ? (
        <>
          <dt>{t.subject}</dt>
          <dd>{formatName(d.subject) || '?'}</dd>
          <dt>{t.issuer}</dt>
          <dd>{d.selfIssued ? t.selfSigned : formatName(d.issuer) || '?'}</dd>
          <dt>{t.validity}</dt>
          <dd>{t.validRange(formatDate(d.notBefore), formatDate(d.notAfter))}</dd>
          {d.altNames.length > 0 ? (
            <>
              <dt>{t.altNames}</dt>
              <dd className="mono">{d.altNames.join(', ')}</dd>
            </>
          ) : null}
        </>
      ) : (
        <dd className="muted">{t.unparsed}</dd>
      )}
      {d && d.notAfter < now ? <dd className="field-error">{t.expired}</dd> : null}
      {d && d.notBefore > now ? <dd className="field-error">{t.notYetValid}</dd> : null}
    </dl>
  );
}

/** A stored pin, for the "old" side of a changed certificate and the settings row. */
export function PinDetails({ pin }: { pin: TlsPin }) {
  const t = tlsStrings();
  return (
    <dl className="tls-details">
      <dt>{t.fingerprint}</dt>
      <dd>
        <Fingerprint sha256={pin.sha256} />
      </dd>
      {pin.subject ? (
        <>
          <dt>{t.subject}</dt>
          <dd>{pin.subject}</dd>
        </>
      ) : null}
      {pin.notAfter ? (
        <>
          <dt>{t.validity}</dt>
          <dd>{t.validRange(formatDate(pin.notBefore), formatDate(pin.notAfter))}</dd>
        </>
      ) : null}
    </dl>
  );
}

/**
 * The offer for an address with no trusted certificate yet. When the address was signed in
 * to with a publicly trusted certificate before (`seenWithSystemTrust`, review R2), it is a
 * warning with an explicit confirmation dialog instead of the one-tap button.
 */
export function FirstUseOffer({
  verdict,
  origin,
  now,
  busy,
  confirm,
  setConfirm,
  onTrust,
}: {
  verdict: Extract<CertificateVerdict, { kind: 'first-use' }>;
  origin: string;
  now: number;
  busy: boolean;
  confirm: boolean;
  setConfirm: (open: boolean) => void;
  onTrust: () => void;
}) {
  const t = tlsStrings();
  const details = (
    <>
      <code className="mono" style={{ wordBreak: 'break-all' }}>
        {FINGERPRINT_COMMAND}
      </code>
      <PresentedDetails cert={verdict.presented} now={now} />
      <p className="field-hint">
        {t.firstUse.scope(origin)} {t.firstUse.passwordOnce}
      </p>
    </>
  );
  if (!verdict.seenWithSystemTrust) {
    return (
      <>
        <p className="banner-title">{t.firstUse.title}</p>
        <p>{t.firstUse.body}</p>
        {details}
        <button type="button" className="btn btn-block" disabled={busy} onClick={onTrust}>
          <Icon name="lock" /> {t.firstUse.trust}
        </button>
      </>
    );
  }
  return (
    <>
      <InfoBanner tone="warning">
        <p className="banner-title">{t.firstUse.seenTitle}</p>
        <p>{t.firstUse.seenBody}</p>
      </InfoBanner>
      {details}
      <button
        type="button"
        className="btn btn-danger-ghost btn-block"
        disabled={busy}
        onClick={() => setConfirm(true)}
      >
        {t.firstUse.seenTrust}
      </button>
      {confirm ? (
        <Dialog
          title={t.firstUse.seenConfirmTitle}
          tone="warning"
          onCancel={() => setConfirm(false)}
          actions={
            <>
              <button type="button" className="btn" onClick={() => setConfirm(false)}>
                {strings.common.cancel}
              </button>
              <button type="button" className="btn btn-danger" disabled={busy} onClick={onTrust}>
                {t.firstUse.seenConfirm}
              </button>
            </>
          }
        >
          <p>{t.firstUse.seenConfirmBody}</p>
          <Fingerprint sha256={verdict.presented.sha256} />
        </Dialog>
      ) : null}
    </>
  );
}

type PanelState =
  | { readonly phase: 'checking' }
  | { readonly phase: 'failed' }
  | { readonly phase: 'verdict'; readonly verdict: CertificateVerdict }
  | { readonly phase: 'trusted' };

/**
 * SRV-8: under a certificate error, reads what the server presents and offers to trust it
 * for this one address (first use), or shows old vs new and asks for an explicit re-trust
 * (changed). Renders nothing when the native transport is missing (web build) or the
 * address is not https.
 */
export function CertificatePanel({ url, onTrusted }: { url: string; onTrusted?: () => void }) {
  const services = useServices();
  const tls = services.tls;
  const t = tlsStrings();
  const origin = pinOrigin(url);
  // Results are kept with the URL they are for; a new URL shows "checking" until its own.
  const [result, setResult] = useState<{ readonly url: string; readonly state: PanelState }>();
  const state: PanelState = result?.url === url ? result.state : { phase: 'checking' };
  const setState = (next: PanelState) => setResult({ url, state: next });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now());
  const enabled = tls.available && origin !== undefined;

  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    tls.check(url).then(
      (verdict) => {
        if (live) setResult({ url, state: { phase: 'verdict', verdict } });
      },
      () => {
        if (live) setResult({ url, state: { phase: 'failed' } });
      },
    );
    return () => {
      live = false;
    };
  }, [enabled, tls, url]);

  if (!enabled || !origin) return null;

  const trust = async (presented: PresentedCertificate, seenWithSystemTrust?: boolean) => {
    setBusy(true);
    try {
      await tls.trust(presented);
      // Keep the answer the warning was based on, so forgetting the pin later does not turn
      // a server that once had a public certificate into a casual first use again.
      if (seenWithSystemTrust !== undefined) {
        await services.profiles
          .setSystemTrustSeenForOrigin(presented.origin, seenWithSystemTrust)
          .catch(() => undefined);
      }
      // Review R2: no stored token or saved password goes to a certificate just accepted on
      // trust; every server at this address asks for the password once.
      await services.auth.requirePasswordAfterNewCertificate(presented.origin);
      setConfirm(false);
      setState({ phase: 'trusted' });
    } catch {
      setState({ phase: 'failed' });
    } finally {
      setBusy(false);
    }
  };

  let body;
  if (state.phase === 'checking') body = <Spinner label={t.checking} />;
  else if (state.phase === 'failed') body = <p className="muted">{t.inspectFailed}</p>;
  else if (state.phase === 'trusted') {
    body = (
      <>
        <p>{t.trusted}</p>
        {onTrusted ? (
          <button type="button" className="btn btn-primary btn-block" onClick={onTrusted}>
            {t.retry}
          </button>
        ) : null}
      </>
    );
  } else {
    const v = state.verdict;
    if (v.kind === 'already-trusted') body = <p>{t.alreadyTrusted}</p>;
    else if (v.kind === 'first-use') {
      body = (
        <FirstUseOffer
          verdict={v}
          origin={origin}
          now={now}
          busy={busy}
          confirm={confirm}
          setConfirm={setConfirm}
          onTrust={() => void trust(v.presented, v.seenWithSystemTrust)}
        />
      );
    } else {
      body = (
        <>
          <InfoBanner tone="warning">
            <p className="banner-title">{t.changed.title}</p>
            <p>{t.changed.body}</p>
          </InfoBanner>
          <h3 className="section-title">{t.changed.trusted}</h3>
          <PinDetails pin={v.pinned} />
          <h3 className="section-title">{t.changed.presented}</h3>
          <PresentedDetails cert={v.presented} now={now} />
          <button
            type="button"
            className="btn btn-danger-ghost btn-block"
            disabled={busy}
            onClick={() => setConfirm(true)}
          >
            {t.changed.retrust}
          </button>
          {confirm ? (
            <Dialog
              title={t.changed.confirmTitle}
              tone="warning"
              onCancel={() => setConfirm(false)}
              actions={
                <>
                  <button type="button" className="btn" onClick={() => setConfirm(false)}>
                    {strings.common.cancel}
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={busy}
                    onClick={() => void trust(v.presented)}
                  >
                    {t.changed.confirm}
                  </button>
                </>
              }
            >
              <p>{t.changed.confirmBody}</p>
              <Fingerprint sha256={v.presented.sha256} />
            </Dialog>
          ) : null}
        </>
      );
    }
  }

  return (
    <section className="tls-panel" aria-label={t.title} data-tls-origin={origin}>
      {body}
    </section>
  );
}
