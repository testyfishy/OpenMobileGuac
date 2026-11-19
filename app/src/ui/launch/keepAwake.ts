import { KeepAwake } from '@capacitor-community/keep-awake';
import { Capacitor } from '@capacitor/core';
import { setKeepAwakeImpl, type KeepAwakeImpl } from '../integration/session.ts';

/**
 * DSP-7 on native platforms: `@capacitor-community/keep-awake` (Android `FLAG_KEEP_SCREEN_ON`,
 * iOS `isIdleTimerDisabled`) instead of the Screen Wake Lock API, whose support inside the
 * WebViews is unverified. The web build keeps the Wake Lock API. Not yet tested on a device.
 */
export function nativeKeepAwake(plugin: Pick<typeof KeepAwake, 'keepAwake' | 'allowSleep'>) {
  const impl: KeepAwakeImpl = {
    async acquire() {
      try {
        await plugin.keepAwake();
        return 'native';
      } catch {
        return 'denied';
      }
    },
    async release() {
      await plugin.allowSleep().catch(() => undefined);
    },
  };
  return impl;
}

let installed = false;

/** Installs the native implementation once (no-op on the web). */
export function installKeepAwake(): void {
  if (installed || !Capacitor.isNativePlatform()) return;
  installed = true;
  setKeepAwakeImpl(nativeKeepAwake(KeepAwake));
}
