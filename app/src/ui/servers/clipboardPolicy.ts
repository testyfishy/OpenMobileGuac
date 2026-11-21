import type { ResolvedSessionSettings } from '../session/settings.ts';
import type { ClipboardPolicy, SessionSettingsPatch } from '../settings/settingsModel.ts';

/**
 * What the server form's Clipboard control shows. A field the server does not set takes the
 * app's value, so the preset is the one that matches the pair in effect. `custom` (device to
 * remote on focus, nothing back) has no preset: "Defaults for this server" shows it.
 */
export function serverClipboardPolicy(
  patch: SessionSettingsPatch,
  inherited: Pick<ResolvedSessionSettings, 'clipboardRemoteToDevice' | 'clipboardAutoSendOnFocus'>,
): ClipboardPolicy | 'custom' {
  const ownR = patch.clipboardRemoteToDevice;
  const ownA = patch.clipboardAutoSendOnFocus;
  if (ownR === undefined && ownA === undefined) return 'inherit';
  const r = ownR ?? inherited.clipboardRemoteToDevice;
  const a = ownA ?? inherited.clipboardAutoSendOnFocus;
  if (r && a) return 'both';
  if (r) return 'to-device';
  if (!a) return 'off';
  return 'custom';
}
