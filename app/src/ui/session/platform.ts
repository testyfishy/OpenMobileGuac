/**
 * Platform glue for the session screen: haptics, device clipboard, soft keyboard events,
 * app foreground events and the screen wake lock. Every function degrades to a no-op (or a
 * `null` result) where the API is missing, so the screen works in a plain desktop browser.
 */

import { App } from '@capacitor/app';
import { Clipboard } from '@capacitor/clipboard';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Keyboard } from '@capacitor/keyboard';
import type { HapticHint } from '../../session/pointer/PointerModel.ts';

export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function isPluginAvailable(name: string): boolean {
  try {
    return isNative() && Capacitor.isPluginAvailable(name);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------
// Haptics (PTR-4). No-op on the web.

export function playHaptic(hint: HapticHint): void {
  if (!isPluginAvailable('Haptics')) return;
  const style = hint === 'click' ? ImpactStyle.Light : ImpactStyle.Medium;
  Haptics.impact({ style }).catch(() => undefined);
}

// ---------------------------------------------------------------------------------------
// Clipboard (CLP-1, CLP-2)

export type ClipboardReadResult =
  { readonly ok: true; readonly text: string } | { readonly ok: false; readonly reason: string };

/**
 * Read text from the device clipboard. Only call this from an explicit user action (or
 * the opt-in auto-send): on iOS every read can show the system "Allow Paste" prompt.
 */
export async function readDeviceClipboard(): Promise<ClipboardReadResult> {
  if (isPluginAvailable('Clipboard')) {
    try {
      const r = await Clipboard.read();
      if (r.type && !r.type.startsWith('text')) {
        return { ok: false, reason: 'The clipboard does not contain text.' };
      }
      return { ok: true, text: r.value ?? '' };
    } catch {
      return { ok: false, reason: 'The clipboard could not be read.' };
    }
  }
  const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  if (!clip || typeof clip.readText !== 'function') {
    return { ok: false, reason: 'This browser does not allow reading the clipboard.' };
  }
  try {
    return { ok: true, text: await clip.readText() };
  } catch {
    return { ok: false, reason: 'Clipboard access was denied by the browser.' };
  }
}

export async function writeDeviceClipboard(text: string): Promise<boolean> {
  if (isPluginAvailable('Clipboard')) {
    try {
      await Clipboard.write({ string: text });
      return true;
    } catch {
      return false;
    }
  }
  const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  if (!clip || typeof clip.writeText !== 'function') return false;
  try {
    await clip.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------
// Soft keyboard (native) and app foreground

export interface Disposable {
  dispose(): void;
}

function handles(promises: Promise<PluginListenerHandle>[]): Disposable {
  let disposed = false;
  const list: PluginListenerHandle[] = [];
  for (const p of promises) {
    p.then((h) => {
      if (disposed) h.remove().catch(() => undefined);
      else list.push(h);
    }).catch(() => undefined);
  }
  return {
    dispose() {
      disposed = true;
      for (const h of list) h.remove().catch(() => undefined);
      list.length = 0;
    },
  };
}

/** Native keyboard show/hide with its height (CSS px). No-op on the web. */
export function onNativeKeyboard(cb: (open: boolean, height: number) => void): Disposable {
  if (!isPluginAvailable('Keyboard')) return { dispose() {} };
  return handles([
    Keyboard.addListener('keyboardWillShow', (info) => cb(true, info.keyboardHeight)),
    Keyboard.addListener('keyboardDidShow', (info) => cb(true, info.keyboardHeight)),
    Keyboard.addListener('keyboardWillHide', () => cb(false, 0)),
  ]);
}

/** Ask the native layer to show the keyboard (Android only; iOS needs a focused field). */
export function nativeShowKeyboard(): void {
  if (!isPluginAvailable('Keyboard') || Capacitor.getPlatform() !== 'android') return;
  Keyboard.show().catch(() => undefined);
}

export function nativeHideKeyboard(): void {
  if (!isPluginAvailable('Keyboard')) return;
  Keyboard.hide().catch(() => undefined);
}

/** App came to the foreground (native app state, or page visibility on the web). */
export function onForeground(cb: () => void): Disposable {
  if (isPluginAvailable('App')) {
    return handles([
      App.addListener('appStateChange', (s) => {
        if (s.isActive) cb();
      }),
    ]);
  }
  const listener = () => {
    if (document.visibilityState === 'visible') cb();
  };
  document.addEventListener('visibilitychange', listener);
  return { dispose: () => document.removeEventListener('visibilitychange', listener) };
}

// ---------------------------------------------------------------------------------------
// Keep-awake (DSP-7) with the Screen Wake Lock API. The lock is released by the browser
// whenever the page is hidden, so it is re-requested on visibility.

export function keepScreenAwake(): Disposable {
  const nav = navigator as Navigator & {
    wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> };
  };
  if (!nav.wakeLock) return { dispose() {} };
  let lock: { release(): Promise<void> } | null = null;
  let disposed = false;
  const acquire = () => {
    if (disposed || document.visibilityState !== 'visible' || !nav.wakeLock) return;
    nav.wakeLock
      .request('screen')
      .then((l) => {
        if (disposed) l.release().catch(() => undefined);
        else lock = l;
      })
      .catch(() => undefined);
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') acquire();
  };
  document.addEventListener('visibilitychange', onVisible);
  acquire();
  return {
    dispose() {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release().catch(() => undefined);
      lock = null;
    },
  };
}
