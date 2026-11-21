import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { describeRequiredParams } from '../../session/credentials/requiredParams.ts';
import { BiometryType } from '@aparajita/capacitor-biometric-auth';
import {
  rememberUnlockOn,
  type RememberPolicy,
} from '../../session/credentials/rememberedParams.ts';
import { en } from '../i18n/en.ts';
import { es } from '../i18n/es.ts';
import { biometryMethodFor } from '../services/native.ts';
import {
  DEFAULT_APP_SETTINGS,
  parseAppSettings,
  settingsFromBackup,
} from '../settings/settingsModel.ts';
import { CredentialSheet } from './CredentialSheet.tsx';
import { sessionStrings } from './sessionStrings.ts';

const fields = describeRequiredParams(['username', 'password']);

function render(policy: RememberPolicy | null | undefined): string {
  return renderToStaticMarkup(
    <CredentialSheet
      title="Lab desktop"
      fields={fields}
      rememberPolicy={policy}
      onSubmit={() => undefined}
      onCancel={() => undefined}
    />,
  );
}

describe('CredentialSheet Remember box (SRV-11)', () => {
  it('is ticked by default and says how long', () => {
    const html = render('app');
    expect(html).toContain(sessionStrings.credentials.remember);
    expect(html).toMatch(/type="checkbox"[^>]*checked=""/);
    expect(html).toContain(sessionStrings.credentials.rememberFor.app);
    expect(render('5m')).toContain(sessionStrings.credentials.rememberFor['5m']);
    expect(render('device')).toContain(sessionStrings.credentials.rememberFor.device);
  });

  it('is hidden for "never" and where nothing can be remembered', () => {
    for (const p of ['never', null, undefined] as const) {
      const html = render(p);
      expect(html).not.toContain('type="checkbox"');
      expect(html).not.toContain(sessionStrings.credentials.remember);
    }
  });

  it('is a centred card with Continue pinned in view', () => {
    const html = render('app');
    expect(html).toContain('omg-sheet-layer omg-sheet-layer--card');
    expect(html).toContain('omg-sheet--card');
    expect(html).toContain('omg-prompt__actions');
  });

  it('no longer claims the values are never saved', () => {
    expect(sessionStrings.credentials.intro('Lab', 2)).not.toMatch(/not saved/);
  });
});

describe('"Remember connection passwords" setting', () => {
  it('defaults to until the app is closed and parses stored values', () => {
    expect(DEFAULT_APP_SETTINGS.rememberConnectionPasswords).toBe('app');
    expect(
      parseAppSettings({ rememberConnectionPasswords: 'device' }).rememberConnectionPasswords,
    ).toBe('device');
    expect(
      parseAppSettings({ rememberConnectionPasswords: '1h' }).rememberConnectionPasswords,
    ).toBe('1h');
    expect(parseAppSettings({ rememberConnectionPasswords: 42 }).rememberConnectionPasswords).toBe(
      'app',
    );
    expect(parseAppSettings({}).rememberConnectionPasswords).toBe('app');
  });

  it('is kept from this device when settings are restored from a backup', () => {
    const current = { ...DEFAULT_APP_SETTINGS, rememberConnectionPasswords: 'never' as const };
    const restored = settingsFromBackup(current, { rememberConnectionPasswords: 'device' });
    expect(restored.rememberConnectionPasswords).toBe('never');
  });
});

describe('"Ask for Face ID / fingerprint before filling" setting', () => {
  it('defaults to auto and parses stored values', () => {
    expect(DEFAULT_APP_SETTINGS.rememberConnectionUnlock).toBe('auto');
    expect(parseAppSettings({}).rememberConnectionUnlock).toBe('auto');
    expect(parseAppSettings({ rememberConnectionUnlock: 'on' }).rememberConnectionUnlock).toBe(
      'on',
    );
    expect(parseAppSettings({ rememberConnectionUnlock: 'off' }).rememberConnectionUnlock).toBe(
      'off',
    );
    expect(parseAppSettings({ rememberConnectionUnlock: true }).rememberConnectionUnlock).toBe(
      'auto',
    );
  });

  it('auto = on for "On this device" only; on/off apply to every remembered value', () => {
    expect(rememberUnlockOn('auto', 'device')).toBe(true);
    for (const p of ['5m', '15m', '1h', 'app'] as const) {
      expect(rememberUnlockOn('auto', p)).toBe(false);
      expect(rememberUnlockOn('on', p)).toBe(true);
    }
    expect(rememberUnlockOn('off', 'device')).toBe(false);
    expect(rememberUnlockOn('on', 'never')).toBe(false);
  });

  it('is off where the device has no biometrics or passcode (no check, no lock-out)', () => {
    expect(rememberUnlockOn('on', 'device', false)).toBe(false);
    expect(rememberUnlockOn('auto', 'device', false)).toBe(false);
  });

  it('is kept from this device when settings are restored from a backup', () => {
    const current = { ...DEFAULT_APP_SETTINGS, rememberConnectionUnlock: 'off' as const };
    expect(
      settingsFromBackup(current, { rememberConnectionUnlock: 'on' }).rememberConnectionUnlock,
    ).toBe('off');
  });

  it('names the device method in the label and the connection in the prompt', () => {
    expect(biometryMethodFor([BiometryType.faceId])).toBe('face-id');
    expect(biometryMethodFor([BiometryType.fingerprintAuthentication])).toBe('fingerprint');
    expect(biometryMethodFor([BiometryType.none])).toBe('generic');
    expect(
      biometryMethodFor([BiometryType.fingerprintAuthentication, BiometryType.faceAuthentication]),
    ).toBe('generic');
    expect(en.settings.rememberConnectionUnlock(en.settings.biometryMethods['face-id'])).toBe(
      'Ask for Face ID before filling a remembered password',
    );
    expect(en.lock.connectionReason('Lab desktop')).toBe(
      'Unlock the saved password for Lab desktop',
    );
    expect(es.lock.connectionReason('Lab desktop')).toBe(
      'Desbloquear la contraseña guardada de Lab desktop',
    );
  });
});
