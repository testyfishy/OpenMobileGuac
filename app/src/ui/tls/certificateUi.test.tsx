import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ServerProfile } from '../../core/models/ServerProfile.ts';
import type { PinnedTlsPlugin } from '../../core/tls/plugin.ts';
import { TlsTrustService } from '../../core/tls/TlsTrustService.ts';
import { MemoryKeyValueStore } from '../../core/storage/KeyValueStore.ts';
import { ProfileStore } from '../../core/storage/ProfileStore.ts';
import type { AppServices } from '../services/AppServices.ts';
import { ServicesContext } from '../services/context.ts';
import { CertificatePanel, FirstUseOffer } from './CertificatePanel.tsx';
import { CertificateRow } from './CertificateRow.tsx';
import { tlsEn } from './tlsStrings.ts';

const SHA = '0123456789abcdef'.repeat(4);
const profile: ServerProfile = {
  id: 'p',
  name: 'P',
  baseUrl: 'https://guac.example.test:8443/guacamole',
  username: '',
  rememberPassword: false,
  createdAt: 0,
  tlsPin: {
    origin: 'https://guac.example.test:8443',
    sha256: SHA,
    subject: 'CN=guac.example.test',
    issuer: 'CN=guac.example.test',
    notBefore: Date.UTC(2026, 0, 1),
    notAfter: Date.UTC(2027, 0, 1),
    pinnedAt: Date.UTC(2026, 5, 1),
  },
};

function render(node: ReactNode, native: boolean) {
  const tls = new TlsTrustService({
    plugin: native ? ({} as PinnedTlsPlugin) : undefined,
    store: new ProfileStore(new MemoryKeyValueStore()),
  });
  const services = { tls } as unknown as AppServices;
  return renderToStaticMarkup(
    <ServicesContext.Provider value={services}>{node}</ServicesContext.Provider>,
  );
}

describe('certificate UI (SRV-8)', () => {
  it('is hidden on the web build (no native plugin)', () => {
    expect(render(<CertificateRow profile={profile} />, false)).toBe('');
    expect(render(<CertificatePanel url={profile.baseUrl} />, false)).toBe('');
  });

  it('is hidden for plain http servers', () => {
    const http = { ...profile, baseUrl: 'http://guac.example.test/guacamole' };
    expect(render(<CertificateRow profile={http} />, true)).toBe('');
    expect(render(<CertificatePanel url={http.baseUrl} />, true)).toBe('');
  });

  it('shows the pinned fingerprint with Forget', () => {
    const html = render(<CertificateRow profile={profile} />, true);
    expect(html).toContain(tlsEn.row.pinned);
    expect(html).toContain('01:23:45:67:89:AB:CD:EF');
    expect(html).toContain(tlsEn.row.forget);
  });

  it('says the device trust store is used when nothing is pinned', () => {
    const { tlsPin: _pin, ...unpinned } = profile;
    void _pin;
    expect(render(<CertificateRow profile={unpinned} />, true)).toContain(tlsEn.row.none);
  });

  it('first use: the casual offer, or a warning with a confirmation after system trust (R2)', () => {
    const presented = { origin: 'https://guac.example.test:8443', sha256: SHA, details: undefined };
    const offer = (seenWithSystemTrust: boolean, confirm = false) =>
      render(
        <FirstUseOffer
          verdict={{ kind: 'first-use', presented, seenWithSystemTrust }}
          origin={presented.origin}
          now={0}
          busy={false}
          confirm={confirm}
          setConfirm={() => undefined}
          onTrust={() => undefined}
        />,
        true,
      );
    const casual = offer(false);
    expect(casual).toContain(tlsEn.firstUse.trust);
    expect(casual).not.toContain(tlsEn.firstUse.seenTitle);
    const warned = offer(true);
    expect(warned).toContain(tlsEn.firstUse.seenTitle);
    expect(warned).toContain('A self-signed certificate now can mean someone is intercepting');
    expect(warned).toContain(tlsEn.firstUse.seenTrust);
    expect(warned).not.toContain(tlsEn.firstUse.trust);
    // The trust action itself is only in the confirmation dialog (closed here; the Dialog
    // needs the navigation context, which this static render does not provide).
    expect(warned).not.toContain(tlsEn.firstUse.seenConfirmTitle);
    expect(warned).not.toContain(`>${tlsEn.firstUse.seenConfirm}<`);
    for (const html of [casual, warned]) expect(html).toContain(tlsEn.firstUse.passwordOnce);
  });

  it('starts by reading the certificate', () => {
    expect(render(<CertificatePanel url={profile.baseUrl} />, true)).toContain(tlsEn.checking);
  });
});
