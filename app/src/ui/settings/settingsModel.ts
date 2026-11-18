import type { SessionSettings } from '../integration/session.ts';
import { parseThemePreference, type ThemePreference } from '../theme/theme.ts';

/**
 * Global app settings (SET-1) and the merge of session settings:
 * defaults ← global defaults ← per-connection overrides.
 *
 * Pure: storage I/O is in `SettingsStore`. Types only from the session module, so this file
 * is testable without React or the vendored library.
 */

export type SessionSettingsPatch = Partial<SessionSettings>;

export interface AppSettings {
  readonly theme: ThemePreference;
  /** Only the session fields the user changed from the built-in defaults. */
  readonly sessionDefaults: SessionSettingsPatch;
}

export const DEFAULT_APP_SETTINGS: AppSettings = { theme: 'system', sessionDefaults: {} };

const FIT_MODES = ['fit-screen', 'fit-width', 'fit-height', 'one-to-one'] as const;
const POINTER_MODES = ['direct', 'trackpad'] as const;
const BOOLEAN_KEYS = [
  'matchDeviceSize',
  'naturalScroll',
  'haptics',
  'clipboardRemoteToDevice',
  'clipboardAutoSendOnFocus',
  'keepAwake',
] as const;

export const POINTER_SPEED_MIN = 0.25;
export const POINTER_SPEED_MAX = 4;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Keeps only well-typed, in-range session fields from untrusted stored JSON. Unknown keys
 * and bad values are dropped, so a corrupt entry falls back to the next layer.
 */
export function sanitizeSessionPatch(raw: unknown): SessionSettingsPatch {
  if (!isRecord(raw)) return {};
  const out: { -readonly [K in keyof SessionSettings]?: SessionSettings[K] } = {};
  const fit = raw['fitMode'];
  if (typeof fit === 'string' && (FIT_MODES as readonly string[]).includes(fit)) {
    out.fitMode = fit as SessionSettings['fitMode'];
  }
  const pm = raw['pointerMode'];
  if (typeof pm === 'string' && (POINTER_MODES as readonly string[]).includes(pm)) {
    out.pointerMode = pm as SessionSettings['pointerMode'];
  }
  const speed = raw['pointerSpeed'];
  if (typeof speed === 'number' && Number.isFinite(speed)) {
    out.pointerSpeed = Math.min(POINTER_SPEED_MAX, Math.max(POINTER_SPEED_MIN, speed));
  }
  for (const key of BOOLEAN_KEYS) {
    const v = raw[key];
    if (typeof v === 'boolean') out[key] = v;
  }
  const combos = raw['customCombos'];
  if (Array.isArray(combos) && combos.every((c) => typeof c === 'string')) {
    out.customCombos = [...(combos as string[])];
  }
  return out;
}

/** defaults ← global ← connection. Each layer is sanitized first. */
export function mergeSessionSettings(
  defaults: SessionSettings,
  global: unknown,
  connection: unknown,
): SessionSettings {
  return {
    ...defaults,
    ...sanitizeSessionPatch(global),
    ...sanitizeSessionPatch(connection),
  };
}

/** Applies an in-session change to the stored per-connection overrides. */
export function applyConnectionPatch(
  stored: unknown,
  patch: SessionSettingsPatch,
): SessionSettingsPatch {
  return { ...sanitizeSessionPatch(stored), ...sanitizeSessionPatch(patch) };
}

/**
 * Global defaults as edited in Settings: keeps only fields that differ from the built-in
 * defaults, so a later change to a built-in default still reaches users who never touched it.
 */
export function diffFromDefaults(
  defaults: SessionSettings,
  values: SessionSettingsPatch,
): SessionSettingsPatch {
  const clean = sanitizeSessionPatch(values);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(clean)) {
    const d = defaults[k as keyof SessionSettings];
    if (JSON.stringify(d) !== JSON.stringify(v)) out[k] = v;
  }
  return out as SessionSettingsPatch;
}

export function parseAppSettings(raw: unknown): AppSettings {
  if (!isRecord(raw)) return DEFAULT_APP_SETTINGS;
  return {
    theme: parseThemePreference(raw['theme']),
    sessionDefaults: sanitizeSessionPatch(raw['sessionDefaults']),
  };
}
