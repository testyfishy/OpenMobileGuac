import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { describeRequiredParams } from '../../session/credentials/requiredParams.ts';
import type { RememberPolicy } from '../../session/credentials/rememberedParams.ts';
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
