/**
 * Per-connection session settings (the contract the app shell persists) and their mapping
 * onto the pure session models.
 */

import type { FitMode } from '../../session/viewport/Viewport.ts';
import type { PointerConfig, PointerMode } from '../../session/pointer/PointerModel.ts';

export interface SessionSettings {
  fitMode: FitMode;
  pointerMode: PointerMode;
  /** DSP-4: ask the server to resize the remote to the device. */
  matchDeviceSize: boolean;
  /** 0.25..4, 1 = default. */
  pointerSpeed: number;
  naturalScroll: boolean;
  haptics: boolean;
  clipboardRemoteToDevice: boolean;
  clipboardAutoSendOnFocus: boolean;
  keepAwake: boolean;
  /** e.g. "Ctrl+Shift+Esc", parsed by KeyModel.parseCombo. */
  customCombos: string[];
}

export const DEFAULT_SESSION_SETTINGS: SessionSettings = {
  fitMode: 'fit-screen',
  pointerMode: 'direct',
  matchDeviceSize: false,
  pointerSpeed: 1,
  naturalScroll: true,
  haptics: true,
  clipboardRemoteToDevice: true,
  clipboardAutoSendOnFocus: false,
  keepAwake: true,
  customCombos: [],
};

export const MIN_POINTER_SPEED = 0.25;
export const MAX_POINTER_SPEED = 4;

export function clampPointerSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return 1;
  return Math.min(MAX_POINTER_SPEED, Math.max(MIN_POINTER_SPEED, speed));
}

/** Fill gaps and repair out-of-range values in settings coming from storage. */
export function normalizeSessionSettings(
  input: Partial<SessionSettings> | null | undefined,
): SessionSettings {
  const s = { ...DEFAULT_SESSION_SETTINGS, ...(input ?? {}) };
  const fitModes: FitMode[] = ['fit-screen', 'fit-width', 'fit-height', 'one-to-one'];
  return {
    ...s,
    fitMode: fitModes.includes(s.fitMode) ? s.fitMode : DEFAULT_SESSION_SETTINGS.fitMode,
    pointerMode: s.pointerMode === 'trackpad' ? 'trackpad' : 'direct',
    pointerSpeed: clampPointerSpeed(s.pointerSpeed),
    customCombos: Array.isArray(s.customCombos)
      ? s.customCombos.filter((c): c is string => typeof c === 'string')
      : [],
  };
}

/** The part of the PointerModel config that comes from session settings. */
export function pointerConfigFromSettings(
  s: Pick<SessionSettings, 'pointerMode' | 'pointerSpeed' | 'naturalScroll'>,
): Partial<PointerConfig> {
  return {
    mode: s.pointerMode,
    pointerSpeed: clampPointerSpeed(s.pointerSpeed),
    naturalScroll: s.naturalScroll,
  };
}

export const FIT_MODE_LABELS: Readonly<Record<FitMode, string>> = {
  'fit-screen': 'Fit screen',
  'fit-width': 'Fit width',
  'fit-height': 'Fit height',
  'one-to-one': '1:1 pixels',
};

export const POINTER_MODE_LABELS: Readonly<Record<PointerMode, string>> = {
  direct: 'Direct touch',
  trackpad: 'Trackpad',
};
