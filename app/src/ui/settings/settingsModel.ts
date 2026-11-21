import { withoutRiskySessionValues } from '../../core/backup/backup.ts';
import {
  DEFAULT_AUTO_BACKUP,
  parseAutoBackupSettings,
  type AutoBackupSettings,
} from '../../core/backup/schedule.ts';
import type { JsonValue } from '../../core/storage/ProfileStore.ts';
import {
  DEFAULT_KEY_LIBRARY,
  migrateLegacyLibrary,
  normalizeKeyLibrary,
  type KeyLibrary,
} from '../../session/keys/KeySets.ts';
import type { SessionSettings } from '../integration/session.ts';
import { INPUT_SETTING_KEYS, sanitizeSessionSettingsPatch } from '../session/settings.ts';
import { parseLanguagePreference, type LanguagePreference } from '../i18n/locale.ts';
import { parseThemePreference, type ThemePreference } from '../theme/theme.ts';
import {
  DEFAULT_REMEMBER_POLICY,
  DEFAULT_REMEMBER_UNLOCK,
  parseRememberPolicy,
  parseRememberUnlock,
  type RememberPolicy,
  type RememberUnlock,
} from '../../session/credentials/rememberedParams.ts';

/**
 * Global app settings (SET-1) and the merge of session settings:
 * defaults ← global defaults ← per-connection overrides.
 *
 * Pure: storage I/O is in `SettingsStore`. Types only from the session module, so this file
 * is testable without React or the vendored library.
 */

export type SessionSettingsPatch = Partial<SessionSettings>;

export type ConnectionSort = 'server' | 'name' | 'protocol' | 'recent';

export interface LockSettings {
  /** SRV-6: biometric / device-credential gate. */
  readonly enabled: boolean;
  /** Lock again after this many seconds in the background (0 = every time). */
  readonly afterSeconds: number;
}

export interface AppSettings {
  readonly theme: ThemePreference;
  /** Only the session fields the user changed from the built-in defaults. */
  readonly sessionDefaults: SessionSettingsPatch;
  readonly language: LanguagePreference;
  readonly lock: LockSettings;
  /** T2.1: disconnect open sessions after this long in the background; `null` = never. */
  readonly backgroundDisconnectSeconds: number | null;
  /**
   * Sign out of every server after the app has been this long in the background; the next
   * sign-in then asks for the password even when one is saved. `null` = never (stay signed
   * in until the server itself ends the session).
   */
  readonly serverSignOutAfterSeconds: number | null;
  /**
   * SRV-11: how long values typed in the remote computer's sign-in prompt are remembered
   * for that connection. App-wide (a security choice, next to the lock and sign-out
   * settings); the prompt's own "Remember" box decides per connection.
   */
  readonly rememberConnectionPasswords: RememberPolicy;
  /**
   * SRV-11: ask for biometrics / the device passcode before a remembered connection
   * password is filled in (`rememberUnlockOn`). `auto` = on for "On this device" only.
   */
  readonly rememberConnectionUnlock: RememberUnlock;
  /** MUL-1: how many sessions may be open at once. */
  readonly maxSessions: number;
  /**
   * MUL-1: tapping a connection that already has a session open in the app: ask, go to the
   * open session, or open another one.
   */
  readonly openAgain: OpenAgain;
  /**
   * MUL-5: ask before connecting when the server reports active sessions on the connection
   * (`in-use`), before every connection (`always`), or never. About sessions on the server;
   * `openAgain` is about sessions open in this app.
   */
  readonly askInUse: AskInUse;
  /** CON-4: keep a small picture of the last screen per connection. */
  readonly thumbnails: boolean;
  readonly connectionSort: ConnectionSort;
  /** First-run introduction seen. */
  readonly onboardingDone: boolean;
  /** Diagnostics: hide host names when copying/sharing the log. */
  readonly logHideHosts: boolean;
  /** The built-in Demo in the server list: `auto` = only while no server is saved. */
  readonly showDemo: DemoVisibility;
  /** KEY-9: key sets, saved combos and per-protocol default sets (app-wide). */
  readonly keys: KeyLibrary;
  /**
   * Android: keep open sessions connected in the background with a foreground service and a
   * notification. Off = disconnect after `backgroundDisconnectSeconds`. No effect on iOS.
   */
  readonly keepAliveBackground: boolean;
  /** SRV-10: scheduled automatic backups (run when the app is opened after they are due). */
  readonly autoBackup: AutoBackupSettings;
}

export type DemoVisibility = 'auto' | 'show' | 'hide';

/** What tapping an already-open connection does (MUL-1). */
export type OpenAgain = 'ask' | 'switch' | 'new';
export const OPEN_AGAIN_CHOICES: readonly OpenAgain[] = ['ask', 'switch', 'new'];

/** "Ask before connecting" (MUL-5). */
export type AskInUse = 'in-use' | 'always' | 'never';
export const ASK_IN_USE_CHOICES: readonly AskInUse[] = ['in-use', 'always', 'never'];

/**
 * Whether the server list shows the Demo entry. `savedServers` is undefined while the list
 * is still loading (nothing is shown then, so the row does not flash).
 */
export function demoVisible(pref: DemoVisibility, savedServers: number | undefined): boolean {
  if (pref === 'show') return true;
  if (pref === 'hide') return false;
  return savedServers === 0;
}

export const LOCK_AFTER_CHOICES = [0, 30, 60, 300, 900] as const;
export const BACKGROUND_DISCONNECT_CHOICES = [30, 60, 300, 900, null] as const;
export const SERVER_SIGN_OUT_CHOICES = [60, 300, 900, 3600, null] as const;
export const MAX_SESSIONS_MIN = 1;
export const MAX_SESSIONS_MAX = 6;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'system',
  sessionDefaults: {},
  language: 'system',
  lock: { enabled: false, afterSeconds: 60 },
  backgroundDisconnectSeconds: 60,
  serverSignOutAfterSeconds: null,
  rememberConnectionPasswords: DEFAULT_REMEMBER_POLICY,
  rememberConnectionUnlock: DEFAULT_REMEMBER_UNLOCK,
  maxSessions: 3,
  openAgain: 'switch',
  askInUse: 'in-use',
  thumbnails: true,
  connectionSort: 'server',
  onboardingDone: false,
  logHideHosts: true,
  showDemo: 'auto',
  keys: DEFAULT_KEY_LIBRARY,
  keepAliveBackground: false,
  autoBackup: DEFAULT_AUTO_BACKUP,
};

const FIT_MODES = ['fit-screen', 'fit-width', 'fit-height', 'one-to-one', 'css-pixels'] as const;
const POINTER_MODES = ['direct', 'trackpad', 'touch'] as const;
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
  // The session screen's own input options: its sanitiser knows their types and ranges.
  const input = sanitizeSessionSettingsPatch(raw) as Record<string, unknown>;
  const target = out as Record<string, unknown>;
  for (const key of INPUT_SETTING_KEYS) {
    if (key in input && input[key] !== undefined) target[key] = input[key];
  }
  return out;
}

/**
 * defaults ← global ← connection, or defaults ← global ← server ← connection when a
 * per-server layer is given. Each layer is sanitized first.
 */
export function mergeSessionSettings(
  defaults: SessionSettings,
  global: unknown,
  connection: unknown,
  server?: unknown,
): SessionSettings {
  return {
    ...defaults,
    ...sanitizeSessionPatch(global),
    ...sanitizeSessionPatch(server),
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

/** "Use app default": drops the connection's own value for these keys. */
export function removeConnectionKeys(
  stored: unknown,
  keys: readonly string[],
): SessionSettingsPatch {
  const drop = new Set(keys);
  return Object.fromEntries(
    Object.entries(sanitizeSessionPatch(stored)).filter(([k]) => !drop.has(k)),
  ) as SessionSettingsPatch;
}

/** Keys a stored per-connection patch overrides. */
export function overriddenKeys(stored: unknown): string[] {
  return Object.keys(sanitizeSessionPatch(stored));
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

function pick<T>(raw: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

function parseLock(raw: unknown): LockSettings {
  const d = DEFAULT_APP_SETTINGS.lock;
  if (!isRecord(raw)) return d;
  return {
    enabled: typeof raw['enabled'] === 'boolean' ? raw['enabled'] : d.enabled,
    afterSeconds: pick(raw['afterSeconds'], LOCK_AFTER_CHOICES, d.afterSeconds as 60),
  };
}

/**
 * The key library, or (settings saved before key sets) one migrated from the app-wide
 * `keyBarLayout` and `customCombos`, which are then dropped from the session defaults.
 */
function keysAndDefaults(raw: Record<string, unknown>): {
  keys: KeyLibrary;
  sessionDefaults: SessionSettingsPatch;
} {
  const defaults = sanitizeSessionPatch(raw['sessionDefaults']);
  if (raw['keys'] !== undefined)
    return { keys: normalizeKeyLibrary(raw['keys']), sessionDefaults: defaults };
  const sd = isRecord(raw['sessionDefaults']) ? raw['sessionDefaults'] : {};
  if (sd['keyBarLayout'] === undefined && sd['customCombos'] === undefined) {
    return { keys: DEFAULT_KEY_LIBRARY, sessionDefaults: defaults };
  }
  const m = migrateLegacyLibrary(sd['keyBarLayout'], sd['customCombos']);
  const { keyBarLayout: _l, customCombos: _c, ...rest } = defaults;
  void _l;
  void _c;
  return {
    keys: m.library,
    sessionDefaults:
      m.defaultSet && rest.keySet === undefined ? { ...rest, keySet: m.defaultSet } : rest,
  };
}

export function parseAppSettings(raw: unknown): AppSettings {
  const d = DEFAULT_APP_SETTINGS;
  if (!isRecord(raw)) return d;
  const max = raw['maxSessions'];
  const kd = keysAndDefaults(raw);
  return {
    theme: parseThemePreference(raw['theme']),
    sessionDefaults: kd.sessionDefaults,
    language: parseLanguagePreference(raw['language']),
    lock: parseLock(raw['lock']),
    backgroundDisconnectSeconds: pick(
      raw['backgroundDisconnectSeconds'],
      BACKGROUND_DISCONNECT_CHOICES,
      d.backgroundDisconnectSeconds as 60,
    ),
    serverSignOutAfterSeconds: pick(
      raw['serverSignOutAfterSeconds'],
      SERVER_SIGN_OUT_CHOICES,
      d.serverSignOutAfterSeconds as null,
    ),
    rememberConnectionPasswords: parseRememberPolicy(raw['rememberConnectionPasswords']),
    rememberConnectionUnlock: parseRememberUnlock(raw['rememberConnectionUnlock']),
    maxSessions:
      typeof max === 'number' && Number.isInteger(max)
        ? Math.min(MAX_SESSIONS_MAX, Math.max(MAX_SESSIONS_MIN, max))
        : d.maxSessions,
    openAgain: pick(raw['openAgain'], OPEN_AGAIN_CHOICES, d.openAgain),
    askInUse: pick(raw['askInUse'], ASK_IN_USE_CHOICES, d.askInUse),
    thumbnails: typeof raw['thumbnails'] === 'boolean' ? raw['thumbnails'] : d.thumbnails,
    connectionSort: pick(
      raw['connectionSort'],
      ['server', 'name', 'protocol', 'recent'] as const,
      d.connectionSort,
    ),
    onboardingDone:
      typeof raw['onboardingDone'] === 'boolean' ? raw['onboardingDone'] : d.onboardingDone,
    logHideHosts: typeof raw['logHideHosts'] === 'boolean' ? raw['logHideHosts'] : d.logHideHosts,
    showDemo: pick(raw['showDemo'], ['auto', 'show', 'hide'] as const, d.showDemo),
    keys: kd.keys,
    keepAliveBackground:
      typeof raw['keepAliveBackground'] === 'boolean'
        ? raw['keepAliveBackground']
        : d.keepAliveBackground,
    autoBackup: parseAutoBackupSettings(raw['autoBackup']),
  };
}

/**
 * Settings restored from a backup: everything except what is device-specific (the lock,
 * which needs this device's biometrics, whether the introduction was seen, and what this
 * device may keep of connection passwords and how it releases them), and except security
 * choices a backup file must not change (pre-release review R6): "Sign out of servers
 * after …" stays as it is, and the session defaults never switch on accepting every pushed
 * file or the microphone (`withoutRiskySessionValues`).
 */
export function settingsFromBackup(current: AppSettings, raw: unknown): AppSettings {
  return settingsRestore(current, raw).settings;
}

/** `settingsFromBackup`, plus whether a security setting in the backup was left out. */
export function settingsRestore(
  current: AppSettings,
  raw: unknown,
): { readonly settings: AppSettings; readonly securityReset: boolean } {
  const parsed = parseAppSettings(raw);
  const defaults = withoutRiskySessionValues(
    parsed.sessionDefaults as Readonly<Record<string, JsonValue>>,
  );
  const signOutDiffers = parsed.serverSignOutAfterSeconds !== current.serverSignOutAfterSeconds;
  return {
    settings: {
      ...parsed,
      sessionDefaults: defaults.value as SessionSettingsPatch,
      lock: current.lock,
      onboardingDone: current.onboardingDone,
      rememberConnectionPasswords: current.rememberConnectionPasswords,
      rememberConnectionUnlock: current.rememberConnectionUnlock,
      serverSignOutAfterSeconds: current.serverSignOutAfterSeconds,
    },
    securityReset:
      defaults.changed ||
      (isRecord(raw) && raw['serverSignOutAfterSeconds'] !== undefined && signOutDiffers),
  };
}

// ---- per-server options (stored by ProfileStore as JSON) --------------------------------

export type SsoMode = 'webview' | 'app-callback';

export interface ServerOptions {
  /** Session-default overrides for this server (defaults ← global ← server ← connection). */
  readonly sessionDefaults: SessionSettingsPatch;
  readonly ssoMode: SsoMode;
  /** SRV-9: fill in TOTP codes from the stored seed. */
  readonly totpAutofill: boolean;
  /** Field names the server asked for at the last sign-in (hints). */
  readonly seenTotp: boolean;
  readonly seenSso: boolean;
  /** CON-5: ask "Open <connection> on <server>?" before an app link connects (AUDIT §3 #8). */
  readonly confirmLinks: boolean;
}

export const DEFAULT_SERVER_OPTIONS: ServerOptions = {
  sessionDefaults: {},
  ssoMode: 'webview',
  totpAutofill: false,
  seenTotp: false,
  seenSso: false,
  confirmLinks: true,
};

export function parseServerOptions(raw: unknown): ServerOptions {
  const d = DEFAULT_SERVER_OPTIONS;
  if (!isRecord(raw)) return d;
  const bool = (k: keyof ServerOptions, fallback: boolean) =>
    typeof raw[k] === 'boolean' ? (raw[k] as boolean) : fallback;
  return {
    sessionDefaults: sanitizeSessionPatch(raw['sessionDefaults']),
    ssoMode: raw['ssoMode'] === 'app-callback' ? 'app-callback' : 'webview',
    totpAutofill: bool('totpAutofill', d.totpAutofill),
    seenTotp: bool('seenTotp', d.seenTotp),
    seenSso: bool('seenSso', d.seenSso),
    confirmLinks: bool('confirmLinks', d.confirmLinks),
  };
}

/** Plain JSON for `ProfileStore.setOptions`. */
export function serverOptionsToJson(o: ServerOptions): Record<string, JsonLike> {
  return {
    sessionDefaults: { ...o.sessionDefaults } as Record<string, JsonLike>,
    ssoMode: o.ssoMode,
    totpAutofill: o.totpAutofill,
    seenTotp: o.seenTotp,
    seenSso: o.seenSso,
    confirmLinks: o.confirmLinks,
  };
}

type JsonLike =
  string | number | boolean | null | readonly JsonLike[] | { readonly [key: string]: JsonLike };

/** Clipboard policy shortcut over the two session clipboard fields. */
export type ClipboardPolicy = 'inherit' | 'both' | 'to-device' | 'off';

export function clipboardPolicyOf(patch: SessionSettingsPatch): ClipboardPolicy {
  const r = patch.clipboardRemoteToDevice;
  const a = patch.clipboardAutoSendOnFocus;
  if (r === undefined && a === undefined) return 'inherit';
  if (r === true && a === true) return 'both';
  if (r === true) return 'to-device';
  return 'off';
}

export function applyClipboardPolicy(
  patch: SessionSettingsPatch,
  policy: ClipboardPolicy,
): SessionSettingsPatch {
  const { clipboardRemoteToDevice: _r, clipboardAutoSendOnFocus: _a, ...rest } = patch;
  void _r;
  void _a;
  switch (policy) {
    case 'inherit':
      return rest;
    case 'both':
      return { ...rest, clipboardRemoteToDevice: true, clipboardAutoSendOnFocus: true };
    case 'to-device':
      return { ...rest, clipboardRemoteToDevice: true, clipboardAutoSendOnFocus: false };
    case 'off':
      return { ...rest, clipboardRemoteToDevice: false, clipboardAutoSendOnFocus: false };
  }
}
