import {
  BiometricAuth,
  BiometryErrorType,
  BiometryType,
  type BiometryError,
} from '@aparajita/capacitor-biometric-auth';
import { App as CapApp } from '@capacitor/app';
import { Clipboard } from '@capacitor/clipboard';
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { PrivacyScreen } from '@capacitor/privacy-screen';
import { Share } from '@capacitor/share';

/**
 * Thin wrappers over the Capacitor plugins the app shell uses, each with a safe web
 * fallback. Every call swallows plugin errors: a missing native feature must never break
 * the flow that uses it.
 */

export interface Disposable {
  dispose(): void;
}

const native = (): boolean => Capacitor.isNativePlatform();

function listen(add: () => Promise<{ remove: () => Promise<void> }>): Disposable {
  let removed = false;
  let handle: { remove: () => Promise<void> } | undefined;
  void add()
    .then((h) => {
      if (removed) void h.remove();
      else handle = h;
    })
    .catch(() => undefined);
  return {
    dispose: () => {
      removed = true;
      void handle?.remove().catch(() => undefined);
    },
  };
}

// ---- app lifecycle ---------------------------------------------------------------------

/**
 * Foreground/background changes. Native: `@capacitor/app` `appStateChange`. Web: the page
 * visibility, so the same logic can be exercised in a desktop browser.
 */
export function onAppActiveChange(cb: (active: boolean) => void): Disposable {
  if (native()) return listen(() => CapApp.addListener('appStateChange', (s) => cb(s.isActive)));
  const onVis = () => cb(document.visibilityState === 'visible');
  document.addEventListener('visibilitychange', onVis);
  return { dispose: () => document.removeEventListener('visibilitychange', onVis) };
}

/** Deep links (`openmobileguac://...`). Also delivers the launch URL, if any. */
export function onAppUrlOpen(cb: (url: string) => void): Disposable {
  if (!native()) return { dispose: () => undefined };
  let live = true;
  void CapApp.getLaunchUrl()
    .then((r) => {
      if (live && r?.url) cb(r.url);
    })
    .catch(() => undefined);
  const sub = listen(() => CapApp.addListener('appUrlOpen', (e) => cb(e.url)));
  return {
    dispose: () => {
      live = false;
      sub.dispose();
    },
  };
}

// ---- haptics ---------------------------------------------------------------------------

export type HapticKind = 'light' | 'medium' | 'success' | 'warning' | 'error';

export function haptic(kind: HapticKind): void {
  if (!native()) {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(kind === 'light' ? 8 : 15);
      } catch {
        // not allowed
      }
    }
    return;
  }
  const p =
    kind === 'light' || kind === 'medium'
      ? Haptics.impact({ style: kind === 'light' ? ImpactStyle.Light : ImpactStyle.Medium })
      : Haptics.notification({
          type:
            kind === 'success'
              ? NotificationType.Success
              : kind === 'warning'
                ? NotificationType.Warning
                : NotificationType.Error,
        });
  void p.catch(() => undefined);
}

// ---- clipboard, files, share -----------------------------------------------------------

export async function copyText(text: string): Promise<boolean> {
  try {
    if (native()) {
      await Clipboard.write({ string: text });
      return true;
    }
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Saves a text file for the user. Native: writes it to the app cache and opens the share
 * sheet (save to Files, send, …). Web: a normal browser download.
 */
export async function saveTextFile(
  fileName: string,
  text: string,
  mime = 'application/json',
): Promise<boolean> {
  try {
    if (native()) {
      const written = await Filesystem.writeFile({
        path: fileName,
        data: text,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
      });
      await Share.share({ title: fileName, url: written.uri, dialogTitle: fileName });
      return true;
    }
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  } catch (err) {
    // The user dismissing the share sheet is not a failure.
    return err instanceof Error && /cancel/i.test(err.message);
  }
}

/** Shares plain text through the share sheet, or copies it where sharing is unavailable. */
export async function shareText(
  title: string,
  text: string,
): Promise<'shared' | 'copied' | 'failed'> {
  try {
    if (native() || (await Share.canShare()).value) {
      await Share.share({ title, text, dialogTitle: title });
      return 'shared';
    }
  } catch (err) {
    if (err instanceof Error && /cancel/i.test(err.message)) return 'shared';
  }
  return (await copyText(text)) ? 'copied' : 'failed';
}

// ---- biometrics and privacy screen (SRV-6) ---------------------------------------------

/**
 * - `available`: biometrics or a device passcode can be checked.
 * - `no-device-security`: the plugin answered that neither is set up.
 * - `error`: the plugin failed, so nothing is known. Never treated as "no security": that
 *   would skip the SRV-11 check (pre-release review R8). Callers fail closed.
 * - `web`: the browser build (no lock at all).
 */
export type BiometryAvailability = 'available' | 'no-device-security' | 'error' | 'web';

export async function biometryAvailability(
  check: () => Promise<{ isAvailable: boolean; deviceIsSecure: boolean }> = () =>
    BiometricAuth.checkBiometry(),
  isNative: () => boolean = native,
): Promise<BiometryAvailability> {
  if (!isNative()) return 'web';
  try {
    const r = await check();
    // Device credential (passcode/PIN/pattern) is an accepted fallback.
    return r.isAvailable || r.deviceIsSecure ? 'available' : 'no-device-security';
  } catch {
    return 'error';
  }
}

/**
 * The device's biometric method, for wording only ("Ask for Face ID …"). `generic`: no
 * biometrics enrolled (passcode only), several kinds, an unknown kind, or the web build.
 */
export type BiometryMethod = 'face-id' | 'touch-id' | 'fingerprint' | 'face' | 'iris' | 'generic';

export function biometryMethodFor(types: readonly number[]): BiometryMethod {
  const kinds = [...new Set(types.filter((t) => t !== BiometryType.none))];
  if (kinds.length !== 1) return 'generic';
  switch (kinds[0]) {
    case BiometryType.faceId:
      return 'face-id';
    case BiometryType.touchId:
      return 'touch-id';
    case BiometryType.fingerprintAuthentication:
      return 'fingerprint';
    case BiometryType.faceAuthentication:
      return 'face';
    case BiometryType.irisAuthentication:
      return 'iris';
    default:
      return 'generic';
  }
}

export async function biometryMethod(): Promise<BiometryMethod> {
  if (!native()) return 'generic';
  try {
    const r = await BiometricAuth.checkBiometry();
    if (!r.isAvailable) return 'generic';
    const types = Array.isArray(r.biometryTypes) ? r.biometryTypes : [r.biometryType];
    return biometryMethodFor(types);
  } catch {
    return 'generic';
  }
}

export type AuthOutcome = 'ok' | 'cancelled' | 'failed' | 'unavailable';

export async function authenticateUser(reason: string, cancelTitle: string): Promise<AuthOutcome> {
  if (!native()) return 'unavailable';
  try {
    await BiometricAuth.authenticate({
      reason,
      cancelTitle,
      allowDeviceCredential: true,
      androidTitle: reason,
      androidConfirmationRequired: false,
    });
    return 'ok';
  } catch (err) {
    const code = (err as BiometryError | undefined)?.code;
    if (
      code === BiometryErrorType.userCancel ||
      code === BiometryErrorType.appCancel ||
      code === BiometryErrorType.systemCancel
    ) {
      return 'cancelled';
    }
    if (
      code === BiometryErrorType.biometryNotAvailable ||
      code === BiometryErrorType.noDeviceCredential ||
      code === BiometryErrorType.passcodeNotSet
    ) {
      return 'unavailable';
    }
    return 'failed';
  }
}

/** Hides app content in the app switcher and blocks screenshots while on (native only). */
export async function setPrivacyScreen(on: boolean): Promise<void> {
  if (!native() || !Capacitor.isPluginAvailable('PrivacyScreen')) return;
  try {
    if (on) {
      await PrivacyScreen.enable({
        android: { dimBackground: true, privacyModeOnActivityHidden: 'none' },
        ios: { blurEffect: 'dark' },
      });
    } else {
      await PrivacyScreen.disable();
    }
  } catch {
    // Plugin not synced into the native project yet.
  }
}

// ---- device info -----------------------------------------------------------------------

export function platformName(): string {
  return Capacitor.getPlatform();
}

export function isNative(): boolean {
  return native();
}
