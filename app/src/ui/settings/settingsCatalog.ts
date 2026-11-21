/**
 * The Settings information architecture: a short list of categories, each a sub-page of
 * small groups, and one search index across all of them.
 *
 * Session settings are referenced by their `SettingKey` (their controls come from the
 * descriptor table, `session/settingsSchema.ts`, which keeps its own `section` for the
 * in-session sheet); app-level settings and the few read-only rows are `app:` items. Every
 * session key and every app item sits in exactly one category and group (tests check this),
 * so nothing is shown twice and nothing is left out.
 *
 * Pure: no React, DOM or CSS. Labels are read at call time, so they follow the app language.
 */

import type { IconName } from '../components/Icon.tsx';
import { LOCALE_NAMES } from '../i18n/locale.ts';
import { GESTURES, gestureForKey, gestureKeys, type GestureArea } from '../session/gestures.ts';
import { sessionStrings } from '../session/sessionStrings.ts';
import type { ResolvedSessionSettings } from '../session/settings.ts';
import {
  SETTING_DESCRIPTORS,
  descriptorOf,
  type SettingDescriptor,
  type SettingKey,
} from '../session/settingsSchema.ts';
import { strings } from '../strings.ts';
import { REMEMBER_POLICIES } from '../../session/credentials/rememberedParams.ts';

export const SETTINGS_PAGES = [
  'general',
  'display',
  'toolbar',
  'pointer',
  'gestures',
  'keyboard',
  'sessions',
  'connections',
  'security',
  'backup',
] as const;

export type SettingsPageId = (typeof SETTINGS_PAGES)[number];

/** App-level rows (not session settings). */
export const APP_ITEMS = [
  // General & about
  'theme',
  'language',
  'showDemo',
  'introduction',
  'diagnostics',
  'about',
  'resetAllSession',
  // Keyboard & keys
  'keySets',
  'combos',
  // Sessions
  'maxSessions',
  'openAgain',
  'askInUse',
  'backgroundDisconnect',
  'keepAlive',
  'thumbnails',
  'clearThumbnails',
  // Security & privacy
  'lock',
  'lockAfter',
  'rememberPolicy',
  'rememberUnlock',
  'serverSignOut',
  'privacy',
  'storage',
  'forgetPasswords',
  'signOutAll',
] as const;

export type AppItemId = (typeof APP_ITEMS)[number];

/**
 * Controls on their own screens (Backup, Diagnostics): found by search, which opens that
 * screen. Listed under the category whose row leads there.
 */
export const ROUTE_ITEMS = [
  'backupExport',
  'backupRestore',
  'backupAuto',
  'logLevel',
  'logHideHosts',
] as const;

export type RouteItemId = (typeof ROUTE_ITEMS)[number];

export type ItemRef = SettingKey | `app:${AppItemId}`;

export interface SettingsGroup {
  readonly id: string;
  readonly title: () => string;
  readonly items: readonly ItemRef[];
  /** Rarely needed: shown collapsed under "Advanced". */
  readonly advanced?: true;
  /** Destructive actions: shown last, under "Reset and remove". */
  readonly danger?: true;
  /** Rendered as the animated gesture rows of this area. */
  readonly gestureArea?: GestureArea;
}

export interface SettingsCategory {
  readonly id: SettingsPageId;
  readonly icon: IconName;
  readonly title: () => string;
  readonly groups: readonly SettingsGroup[];
  /** Opens this screen instead of a sub-page. */
  readonly route?: 'backup' | 'connection-settings';
}

const T = () => strings.settings;
const P = () => strings.settings.pages;
const O = () => sessionStrings.options;
const app = (id: AppItemId): ItemRef => `app:${id}`;
const gestureAreaKeys = (area: GestureArea): SettingKey[] =>
  GESTURES.filter((g) => g.area === area).flatMap(gestureKeys);

export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  {
    id: 'general',
    icon: 'gear',
    title: () => P().categories.general,
    groups: [
      { id: 'appearance', title: () => T().appearance, items: [app('theme'), app('language')] },
      { id: 'server-list', title: () => P().groups.serverList, items: [app('showDemo')] },
      {
        id: 'help',
        title: () => P().groups.help,
        items: [app('introduction'), app('diagnostics')],
      },
      { id: 'about', title: () => T().about, items: [app('about')] },
      { id: 'danger', title: () => P().danger, items: [app('resetAllSession')], danger: true },
    ],
  },
  {
    id: 'display',
    icon: 'monitor',
    title: () => P().categories.display,
    groups: [
      {
        id: 'picture',
        title: () => P().groups.picture,
        items: ['fitMode', 'displayAlign', 'quality'],
      },
      {
        id: 'remote-size',
        title: () => P().groups.remoteSize,
        items: [
          'remoteResolution',
          'matchDeviceSize',
          'remoteWidth',
          'remoteHeight',
          'remoteScale',
        ],
      },
      { id: 'screen', title: () => P().groups.screen, items: ['keepAwake', 'immersive'] },
    ],
  },
  {
    id: 'toolbar',
    icon: 'toolbar',
    title: () => P().categories.toolbar,
    groups: [
      {
        id: 'toolbar',
        title: () => O().sections.toolbar,
        items: ['toolbarStyle', 'toolbarItems', 'toolbarLabels', 'toolbarAutoHide'],
      },
      {
        id: 'layout',
        title: () => P().groups.layout,
        items: ['toolbarLandscape', 'keyBarLandscape', 'splitLayout'],
      },
    ],
  },
  {
    id: 'pointer',
    icon: 'pointer',
    title: () => P().categories.pointer,
    groups: [
      { id: 'mode', title: () => P().groups.mode, items: ['pointerMode', 'viewOnly'] },
      {
        id: 'trackpad',
        title: () => P().groups.trackpad,
        items: ['pointerSpeed', 'pointerAcceleration', 'largeCursor'],
      },
      { id: 'feedback', title: () => P().groups.feedback, items: ['haptics'] },
      { id: 'advanced', title: () => P().advanced, items: ['pointerLock'], advanced: true },
    ],
  },
  {
    id: 'gestures',
    icon: 'hand',
    title: () => P().categories.gestures,
    groups: [
      {
        id: 'desktop',
        title: () => sessionStrings.gestures.areas.desktop,
        items: gestureAreaKeys('desktop'),
        gestureArea: 'desktop',
      },
      {
        id: 'chrome',
        title: () => sessionStrings.gestures.areas.chrome,
        items: gestureAreaKeys('chrome'),
        gestureArea: 'chrome',
      },
    ],
  },
  {
    id: 'keyboard',
    icon: 'keyboard',
    title: () => P().categories.keyboard,
    groups: [
      {
        id: 'key-bar',
        title: () => P().groups.keyBar,
        items: ['keySet', app('keySets'), app('combos'), 'keyBarCollapseButton'],
      },
      {
        id: 'typing',
        title: () => P().groups.typing,
        items: ['textInputMode', 'textInputBar'],
      },
      { id: 'advanced', title: () => P().advanced, items: ['commandKey'], advanced: true },
    ],
  },
  {
    id: 'sessions',
    icon: 'layers',
    title: () => P().categories.sessions,
    groups: [
      {
        id: 'open',
        title: () => P().groups.openSessions,
        items: [app('maxSessions'), app('openAgain'), app('askInUse')],
      },
      {
        id: 'background',
        title: () => P().groups.background,
        items: [app('backgroundDisconnect'), app('keepAlive')],
      },
      {
        id: 'clipboard',
        title: () => O().sections.clipboard,
        items: [
          'clipboardRemoteToDevice',
          'sendPastes',
          'clipboardSendOnConnect',
          'clipboardAutoSendOnFocus',
        ],
      },
      { id: 'files', title: () => O().sections.files, items: ['remoteFiles', 'receivedFiles'] },
      { id: 'sound', title: () => O().sections.sound, items: ['audio', 'microphone'] },
      { id: 'thumbnails', title: () => P().groups.thumbnails, items: [app('thumbnails')] },
      { id: 'danger', title: () => P().danger, items: [app('clearThumbnails')], danger: true },
    ],
  },
  {
    // Settings per connection: its own screen (each connection's values over these defaults).
    id: 'connections',
    icon: 'server',
    title: () => P().categories.connections,
    groups: [],
    route: 'connection-settings',
  },
  {
    id: 'security',
    icon: 'shield',
    title: () => P().categories.security,
    groups: [
      { id: 'lock', title: () => P().groups.appLock, items: [app('lock'), app('lockAfter')] },
      {
        id: 'remembered',
        title: () => P().groups.connectionPasswords,
        items: [app('rememberPolicy'), app('rememberUnlock')],
      },
      {
        id: 'sign-in',
        title: () => P().groups.serverSignIn,
        items: [app('serverSignOut')],
      },
      { id: 'privacy', title: () => T().privacyTitle, items: [app('privacy'), app('storage')] },
      {
        id: 'danger',
        title: () => P().danger,
        items: [app('forgetPasswords'), app('signOutAll')],
        danger: true,
      },
    ],
  },
  {
    id: 'backup',
    icon: 'archive',
    title: () => P().categories.backup,
    groups: [],
    route: 'backup',
  },
];

export function categoryOf(id: SettingsPageId): SettingsCategory {
  const c = SETTINGS_CATEGORIES.find((x) => x.id === id);
  if (!c) throw new Error(`unknown settings page ${id}`);
  return c;
}

/** The session setting keys a page shows (what its "Reset this page" clears). */
export function sessionKeysOf(id: SettingsPageId): SettingKey[] {
  return categoryOf(id)
    .groups.flatMap((g) => g.items)
    .filter((r): r is SettingKey => !r.startsWith('app:'));
}

export function isAppRef(ref: ItemRef): ref is `app:${AppItemId}` {
  return ref.startsWith('app:');
}

/** Where an item is: its category and group. */
export function locate(ref: ItemRef): { page: SettingsPageId; group: SettingsGroup } | undefined {
  for (const c of SETTINGS_CATEGORIES) {
    for (const g of c.groups) if (g.items.includes(ref)) return { page: c.id, group: g };
  }
  return undefined;
}

// ---- Search -----------------------------------------------------------------------------

export interface SearchContext {
  readonly values: ResolvedSessionSettings;
  /** Device check wording ("Face ID", "your fingerprint", …). */
  readonly biometryLabel: string;
  /** Connections with their own value for a session setting ("Office desktop, Tablet"), if any. */
  readonly alsoSetFor?: (key: SettingKey) => string | undefined;
}

export interface SearchResult {
  /** A page item, or a control on the Backup / Diagnostics screen. */
  readonly ref: ItemRef | `route:${RouteItemId}`;
  readonly page: SettingsPageId;
  readonly label: string;
  /** "Category › Group". */
  readonly where: string;
  /** Session settings some connections override: their names (not searched). */
  readonly alsoSetFor?: string;
}

function durations(): string[] {
  const c = strings.common;
  return [c.never, c.immediately];
}

/** Label and searchable text of an app item. */
export function appItemText(id: AppItemId, ctx: SearchContext): { label: string; text: string[] } {
  const t = T();
  switch (id) {
    case 'theme':
      return { label: t.theme, text: [t.themeSystem, t.themeLight, t.themeDark] };
    case 'language':
      return { label: t.language, text: [t.languageSystem, ...Object.values(LOCALE_NAMES)] };
    case 'showDemo':
      return {
        label: t.showDemo,
        text: [t.showDemoAuto, t.showDemoShow, t.showDemoHide, t.showDemoHint],
      };
    case 'introduction':
      return { label: t.introduction, text: [] };
    case 'diagnostics':
      return { label: t.diagnostics, text: [strings.diagnostics.logTitle] };
    case 'about':
      return {
        label: t.about,
        text: [t.version, t.licence, t.licenceValue, t.source, t.disclaimer],
      };
    case 'resetAllSession':
      return { label: P().resetAllSession, text: [P().resetAllSessionHint, O().resetAll] };
    case 'keySets':
      return { label: t.keySetsButton, text: [t.keysTitle, t.keysHint] };
    case 'combos':
      return { label: t.combosButton, text: [t.keysTitle] };
    case 'maxSessions':
      return { label: t.maxSessions, text: [t.maxSessionsHint] };
    case 'openAgain':
      return {
        label: t.openAgain,
        text: [t.openAgainAsk, t.openAgainSwitch, t.openAgainNew, t.openAgainHint],
      };
    case 'askInUse':
      return {
        label: t.askInUse,
        text: [
          t.askInUseInUse,
          t.askInUseAlways,
          t.askInUseNever,
          t.askInUseHint,
          strings.connections.inUseShort,
        ],
      };
    case 'backgroundDisconnect':
      return {
        label: t.backgroundDisconnect,
        text: [t.backgroundDisconnectHint, t.backgroundDisconnectIos, ...durations()],
      };
    case 'keepAlive':
      return {
        label: t.keepAlive,
        text: [t.keepAliveHintAndroid, t.keepAliveHintIos, t.keepAliveBattery],
      };
    case 'thumbnails':
      return { label: t.thumbnails, text: [t.thumbnailsHint] };
    case 'clearThumbnails':
      return { label: t.clearThumbnails, text: [] };
    case 'lock':
      return {
        label: t.lockEnable,
        text: [t.lockHint, ...Object.values(t.biometryMethods)],
      };
    case 'lockAfter':
      return { label: t.lockAfter, text: durations() };
    case 'rememberPolicy':
      return {
        label: t.rememberConnection,
        text: [
          ...REMEMBER_POLICIES.map((p) => t.rememberConnectionOptions[p]),
          t.rememberConnectionHint,
        ],
      };
    case 'rememberUnlock':
      return {
        label: t.rememberConnectionUnlock(ctx.biometryLabel),
        // Every wording of the check, so "fingerprint" finds it on a Face ID phone too.
        text: [t.rememberConnectionUnlockHint, ...Object.values(t.biometryMethods)],
      };
    case 'serverSignOut':
      return { label: t.serverSignOut, text: [t.serverSignOutHint, ...durations()] };
    case 'privacy':
      return { label: t.privacyTitle, text: [t.privacy] };
    case 'storage':
      return {
        label: t.storageTitle,
        text: [t.storageSecure, t.storageDev, t.storageMemory],
      };
    case 'forgetPasswords':
      return { label: t.forgetConnectionPasswords, text: [] };
    case 'signOutAll':
      return { label: t.signOutAll, text: [t.signOutAllHint] };
  }
}

export function routeItemText(id: RouteItemId): {
  label: string;
  text: string[];
  page: SettingsPageId;
} {
  const b = strings.backup;
  const d = strings.diagnostics;
  switch (id) {
    case 'backupExport':
      return { label: b.exportButton, text: [b.exportTitle, b.includeSecrets], page: 'backup' };
    case 'backupRestore':
      return { label: b.importTitle, text: [b.chooseFile, b.restoreSettings], page: 'backup' };
    case 'backupAuto':
      return {
        label: b.autoEnable,
        text: [b.autoTitle, b.frequency, b.keep, ...Object.values(b.frequencies)],
        page: 'backup',
      };
    case 'logLevel':
      return {
        label: `${d.title} › ${d.logTitle}`,
        text: [d.level, ...Object.values(d.levels)],
        page: 'general',
      };
    case 'logHideHosts':
      return { label: d.hideHosts, text: [d.title, d.hideHostsHint], page: 'general' };
  }
}

/** Label and searchable text of a session setting (gesture rows add the gesture's text). */
export function sessionItemText(
  d: SettingDescriptor,
  s: ResolvedSessionSettings,
): { label: string; text: string[] } {
  const g = gestureForKey(d.key);
  const gesture = g ? sessionStrings.gestures.items[g.id] : undefined;
  return {
    label: d.label(),
    text: [
      ...(gesture ? [gesture.name, gesture.desc] : []),
      d.hint?.(s) ?? '',
      ...(d.control === 'choice' ? d.options.map((o) => d.optionLabel(o)) : []),
    ],
  };
}

/**
 * A long hint split into a short lead and the rest: hints over ~140 characters show their
 * first sentence, the rest behind "More". Nothing is dropped.
 */
export function splitHint(text: string): readonly [string, string] {
  if (text.length <= 140) return [text, ''];
  // Sentence ends only (not ":"), followed by a capital, so "e.g. x" or "1:1" never split.
  const m = /^(.{30,}?[.!?])\s+(?=[\p{Lu}¿¡“«"(])/su.exec(text);
  // Only worth it when a real remainder is folded away.
  if (!m?.[1] || text.length - m[0].length < 60) return [text, ''];
  return [m[1], text.slice(m[0].length)];
}

export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Every word of the query appears in the label, text or group title. */
function matches(words: readonly string[], parts: readonly string[]): boolean {
  const hay = parts.map(fold).join(' ');
  return words.every((w) => hay.includes(w));
}

/**
 * Every setting matching `query` (case- and accent-insensitive, every word must appear in
 * its label, hint, option labels or group title), in page order. Empty query: nothing.
 */
export function searchSettings(query: string, ctx: SearchContext): SearchResult[] {
  const words = fold(query.trim()).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const out: SearchResult[] = [];
  for (const c of SETTINGS_CATEGORIES) {
    for (const g of c.groups) {
      const groupTitle = g.title();
      for (const ref of g.items) {
        const item = itemText(ref, ctx);
        if (!item) continue;
        if (matches(words, [item.label, ...item.text, groupTitle])) {
          const also = isAppRef(ref) ? undefined : ctx.alsoSetFor?.(ref);
          out.push({
            ref,
            page: c.id,
            label: item.label,
            where: `${c.title()} › ${groupTitle}`,
            ...(also ? { alsoSetFor: also } : {}),
          });
        }
      }
    }
    for (const id of ROUTE_ITEMS) {
      const r = routeItemText(id);
      if (r.page !== c.id) continue;
      if (matches(words, [r.label, ...r.text])) {
        const where =
          id === 'logLevel' || id === 'logHideHosts'
            ? `${c.title()} › ${strings.diagnostics.title}`
            : c.title();
        out.push({ ref: `route:${id}`, page: c.id, label: r.label, where });
      }
    }
  }
  return out;
}

function itemText(ref: ItemRef, ctx: SearchContext): { label: string; text: string[] } | undefined {
  if (isAppRef(ref)) return appItemText(ref.slice(4) as AppItemId, ctx);
  const d = descriptorOf(ref);
  return d ? sessionItemText(d, ctx.values) : undefined;
}

/** Every session key the catalogue places (for the completeness tests). */
export function placedSessionKeys(): SettingKey[] {
  return SETTINGS_CATEGORIES.flatMap((c) => c.groups.flatMap((g) => g.items)).filter(
    (r): r is SettingKey => !isAppRef(r),
  );
}

/** Descriptor keys, for tests and the "no setting left out" check. */
export const ALL_SESSION_KEYS: readonly SettingKey[] = SETTING_DESCRIPTORS.map((d) => d.key);
