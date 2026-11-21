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
import { StatusBar } from '@capacitor/status-bar';
import type { HapticHint } from '../../session/pointer/PointerModel.ts';
import { sessionStrings } from './sessionStrings.ts';
import { foldFromSignals, NO_FOLD, type FoldInfo, type ViewportSegment } from './deviceShape.ts';

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
        return { ok: false, reason: sessionStrings.deviceClipboard.notText };
      }
      return { ok: true, text: r.value ?? '' };
    } catch {
      return { ok: false, reason: sessionStrings.deviceClipboard.readFailed };
    }
  }
  const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  if (!clip || typeof clip.readText !== 'function') {
    return { ok: false, reason: sessionStrings.deviceClipboard.browserUnsupported };
  }
  try {
    return { ok: true, text: await clip.readText() };
  } catch {
    return { ok: false, reason: sessionStrings.deviceClipboard.browserDenied };
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
// Keep-awake (DSP-7)
//
// A small seam so a native plugin can replace the Screen Wake Lock API without touching
// the session screen. The web implementation uses `navigator.wakeLock`, re-requested on
// visibility (the browser releases the lock whenever the page is hidden). Whether that API
// works inside Android WebView and WKWebView has NOT been verified on a device (see
// docs/checklists/session-device.md); MDN's compatibility data only "mirrors" the browser
// entries for the WebViews, and iOS before 16.4 has no Wake Lock at all.
//
// On native platforms the shell installs `@capacitor-community/keep-awake` through
// `setKeepAwakeImpl` (see `ui/launch/keepAwake.ts`). That implementation is one shared,
// process-wide switch, so `keepScreenAwake` counts its holders and only releases it when
// the last one is disposed (switching sessions must not let the screen sleep).

/** How the screen is being kept on, or why it is not. */
export type KeepAwakeState = 'native' | 'wake-lock' | 'unsupported' | 'denied' | 'released';

export interface KeepAwakeImpl {
  /** Keep the screen on; resolves to how (or why not). Called again after foregrounding. */
  acquire(): Promise<KeepAwakeState>;
  release(): Promise<void>;
}

type WakeLockSentinelLike = { release(): Promise<void> };
type WakeLockLike = { request(type: 'screen'): Promise<WakeLockSentinelLike> };

/** The Screen Wake Lock API implementation (web, and WebViews that support it). */
export function webKeepAwake(): KeepAwakeImpl {
  let lock: WakeLockSentinelLike | null = null;
  return {
    async acquire() {
      const wl = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
      if (!wl) return 'unsupported';
      if (document.visibilityState !== 'visible') return 'denied';
      try {
        const next = await wl.request('screen');
        await lock?.release().catch(() => undefined);
        lock = next;
        return 'wake-lock';
      } catch {
        return 'denied';
      }
    },
    async release() {
      const l = lock;
      lock = null;
      await l?.release().catch(() => undefined);
    },
  };
}

let keepAwakeImpl: KeepAwakeImpl | null = null;
/** Live `keepScreenAwake` handles using the shared (`setKeepAwakeImpl`) implementation. */
const sharedHolders = new Set<object>();

/**
 * Replace the keep-awake implementation (e.g. with a native plugin). The implementation is
 * shared by every session: it is released only when no session holds it any more.
 */
export function setKeepAwakeImpl(impl: KeepAwakeImpl | null): void {
  keepAwakeImpl = impl;
  sharedHolders.clear();
}

/**
 * Keep the screen awake until disposed. `onState` reports the outcome of every attempt,
 * so the UI or log can tell whether it actually worked.
 */
export function keepScreenAwake(onState?: (state: KeepAwakeState) => void): Disposable {
  const shared = keepAwakeImpl;
  const impl = shared ?? webKeepAwake();
  const token = {};
  if (shared) sharedHolders.add(token);
  let disposed = false;
  const acquire = () => {
    if (disposed || document.visibilityState !== 'visible') return;
    impl
      .acquire()
      .then((s) => {
        if (!disposed) onState?.(s);
        else if (!shared || sharedHolders.size === 0) impl.release().catch(() => undefined);
      })
      .catch(() => onState?.('denied'));
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') acquire();
  };
  document.addEventListener('visibilitychange', onVisible);
  acquire();
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (shared) sharedHolders.delete(token);
      if (!shared || sharedHolders.size === 0) impl.release().catch(() => undefined);
      onState?.('released');
    },
  };
}

// ---------------------------------------------------------------------------------------
// Lifecycle (DSP-9): app resume and network changes

/** Native app resumed (Capacitor App `resume`); on the web, the page became visible. */
export function onAppResume(cb: () => void): Disposable {
  if (isPluginAvailable('App')) return handles([App.addListener('resume', cb)]);
  const listener = () => {
    if (document.visibilityState === 'visible') cb();
  };
  document.addEventListener('visibilitychange', listener);
  return { dispose: () => document.removeEventListener('visibilitychange', listener) };
}

/** `online` / `offline` events (the WebView reports the device network state). */
export function onNetworkChange(cb: (online: boolean) => void): Disposable {
  const on = () => cb(true);
  const off = () => cb(false);
  window.addEventListener('online', on);
  window.addEventListener('offline', off);
  return {
    dispose() {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    },
  };
}

export function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

// ---------------------------------------------------------------------------------------
// Immersive mode (DSP-7): hide the system bars on native, full screen on the web.

/**
 * Enter immersive mode. Native: hides the status bar (StatusBar plugin, iOS and Android)
 * and, where the WebView supports the Fullscreen API (some Android WebViews do), also
 * requests full screen so the navigation bar can hide. Web: the Fullscreen API only.
 * Returns a disposable that restores the bars. Every step is best effort.
 */
export function enterImmersive(): Disposable {
  let disposed = false;
  if (isPluginAvailable('StatusBar')) StatusBar.hide().catch(() => undefined);
  const root = typeof document !== 'undefined' ? document.documentElement : null;
  const canFullscreen =
    root !== null &&
    typeof root.requestFullscreen === 'function' &&
    (typeof document.fullscreenEnabled !== 'boolean' || document.fullscreenEnabled);
  if (canFullscreen && !document.fullscreenElement) {
    root.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
  }
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (isPluginAvailable('StatusBar')) StatusBar.show().catch(() => undefined);
      if (typeof document !== 'undefined' && document.fullscreenElement) {
        document.exitFullscreen().catch(() => undefined);
      }
    },
  };
}

// ---------------------------------------------------------------------------------------
// Foldables (DSP-8)

export type { FoldInfo } from './deviceShape.ts';

interface ViewportSegmentsApi {
  readonly segments?: readonly ViewportSegment[] | null;
}

interface DevicePostureApi {
  readonly type?: string;
  addEventListener?(type: 'change', cb: () => void): void;
  removeEventListener?(type: 'change', cb: () => void): void;
}

/**
 * Current fold state from whichever API the WebView has: the Viewport Segments API
 * (`window.viewport.segments`), the `vertical-viewport-segments` media query (two
 * segments stacked vertically = a horizontal fold), and the Device Posture API
 * (`navigator.devicePosture.type === 'folded'`, without geometry, trusted only where the
 * hinge direction is unambiguous). Absent APIs = no fold. See `foldFromSignals`.
 */
export function readFold(): FoldInfo {
  if (typeof window === 'undefined') return NO_FOLD;
  let segments: readonly ViewportSegment[] | null | undefined;
  try {
    segments = (window as unknown as { viewport?: ViewportSegmentsApi }).viewport?.segments;
  } catch {
    segments = undefined;
  }
  const mq = (q: string) => {
    try {
      return typeof window.matchMedia === 'function' && window.matchMedia(q).matches;
    } catch {
      return false;
    }
  };
  const posture = (navigator as Navigator & { devicePosture?: DevicePostureApi }).devicePosture;
  const angle = typeof screen !== 'undefined' ? screen.orientation?.angle : undefined;
  return foldFromSignals({
    segments,
    stacked: mq('(vertical-viewport-segments: 2)'),
    sideBySide: mq('(horizontal-viewport-segments: 2)'),
    posture: posture?.type,
    angle,
    width: window.innerWidth,
    height: window.innerHeight,
  });
}

/** Calls `cb` whenever the fold state may have changed. */
export function onFoldChange(cb: () => void): Disposable {
  if (typeof window === 'undefined') return { dispose() {} };
  const queries: MediaQueryList[] = [];
  for (const q of ['(vertical-viewport-segments: 2)', '(horizontal-viewport-segments: 2)']) {
    try {
      if (typeof window.matchMedia === 'function') queries.push(window.matchMedia(q));
    } catch {
      // ignore
    }
  }
  for (const m of queries) m.addEventListener?.('change', cb);
  window.addEventListener('resize', cb);
  const posture = (navigator as Navigator & { devicePosture?: DevicePostureApi }).devicePosture;
  posture?.addEventListener?.('change', cb);
  return {
    dispose() {
      for (const m of queries) m.removeEventListener?.('change', cb);
      window.removeEventListener('resize', cb);
      posture?.removeEventListener?.('change', cb);
    },
  };
}
