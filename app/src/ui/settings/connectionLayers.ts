/**
 * Settings per connection (SET-1): which connections keep their own session settings, what
 * they change, and how that reads in one line. The layers are
 * built-in ← app defaults (Settings) ← server defaults ← connection; a connection "has its
 * own value" for a key when that key is stored for it (as in the session's "This
 * connection"), whatever the value.
 *
 * Pure: no React, DOM or storage. Labels are read at call time (app language).
 */

import type { ConnectionRef } from '../../core/storage/ProfileStore.ts';
import {
  DEFAULT_SESSION_SETTINGS,
  normalizeSessionSettings,
  type ResolvedSessionSettings,
} from '../session/settings.ts';
import {
  DEFAULT_SUMMARY_CONTEXT,
  descriptorOf,
  type SettingDescriptor,
  type SettingKey,
  type SummaryContext,
} from '../session/settingsSchema.ts';
import { strings } from '../strings.ts';
import {
  SETTINGS_CATEGORIES,
  placedSessionKeys,
  sessionKeysOf,
  type SettingsPageId,
} from './settingsCatalog.ts';
import {
  mergeSessionSettings,
  removeConnectionKeys,
  sanitizeSessionPatch,
  type SessionSettingsPatch,
} from './settingsModel.ts';

/** One connection known on this device, with its own values and what it inherits. */
export interface ConnectionEntry {
  readonly serverId: string;
  readonly serverName: string;
  readonly ref: ConnectionRef;
  /** Display name when known (recents, the Demo); otherwise a fallback is shown. */
  readonly name: string | undefined;
  readonly protocol: string | undefined;
  /** Its own stored values (sanitised, only keys with a control). */
  readonly own: SessionSettingsPatch;
  /** What it would use without them: built-in ← app ← server. */
  readonly inherited: ResolvedSessionSettings;
  readonly lastUsed: number | undefined;
  readonly favourite: boolean;
}

/** One server's connections, plus the server's own defaults. */
export interface ServerGroup {
  readonly serverId: string;
  readonly serverName: string;
  /** The server's address, to tell servers with the same name apart. */
  readonly serverDetail?: string;
  /** Saved servers have a "Defaults for this server" editor (not the Demo). */
  readonly hasServerDefaults: boolean;
  /** The server's own defaults (over the app defaults). */
  readonly serverOwn: SessionSettingsPatch;
  /** App defaults the server layer inherits: built-in ← app. */
  readonly appInherited: ResolvedSessionSettings;
  readonly entries: readonly ConnectionEntry[];
}

/** The Settings pages that hold session settings (what a connection's editor lists). */
export const LAYER_PAGES: readonly SettingsPageId[] = SETTINGS_CATEGORIES.filter(
  (c) => !c.route && sessionKeysOf(c.id).length > 0,
).map((c) => c.id);

/** The order keys are summarised in: what differs most often per machine first. */
const SUMMARY_FIRST: readonly SettingKey[] = ['pointerMode', 'fitMode', 'quality', 'keySet'];

let catalogueOrder: readonly SettingKey[] | undefined;
function order(): readonly SettingKey[] {
  catalogueOrder ??= [
    ...SUMMARY_FIRST,
    ...placedSessionKeys().filter((k) => !SUMMARY_FIRST.includes(k)),
  ];
  return catalogueOrder;
}

/** The keys a stored patch sets that have a control, in summary order. */
export function ownKeys(patch: unknown): SettingKey[] {
  const clean = sanitizeSessionPatch(patch) as Record<string, unknown>;
  return order().filter((k) => k in clean && clean[k] !== undefined);
}

/** Only the keys with a control (legacy fields such as `keyBarLayout` are dropped). */
export function ownPatch(patch: unknown): SessionSettingsPatch {
  const clean = sanitizeSessionPatch(patch) as Record<string, unknown>;
  return Object.fromEntries(ownKeys(clean).map((k) => [k, clean[k]])) as SessionSettingsPatch;
}

/**
 * "Reset all": a stored patch without its own values. Legacy fields (an old key bar layout,
 * saved combos) have no control to restore them from, so they are kept.
 */
export function withoutOwnValues(patch: unknown): SessionSettingsPatch {
  return removeConnectionKeys(patch, ownKeys(patch));
}

/** What a layer inherits: built-in ← app defaults ← (server defaults). */
export function inheritedValues(
  appDefaults: SessionSettingsPatch,
  serverDefaults?: SessionSettingsPatch,
): ResolvedSessionSettings {
  return normalizeSessionSettings(
    mergeSessionSettings(DEFAULT_SESSION_SETTINGS, appDefaults, {}, serverDefaults ?? {}),
  );
}

/** The effective values of a layer: what it inherits with its own values on top. */
export function effectiveValues(
  inherited: ResolvedSessionSettings,
  own: SessionSettingsPatch,
): ResolvedSessionSettings {
  return normalizeSessionSettings({ ...inherited, ...sanitizeSessionPatch(own) });
}

/** Own keys whose value actually differs from what would be inherited. */
export function differingKeys(
  own: SessionSettingsPatch,
  inherited: ResolvedSessionSettings,
): SettingKey[] {
  const values = effectiveValues(inherited, own);
  return ownKeys(own).filter((k) => JSON.stringify(values[k]) !== JSON.stringify(inherited[k]));
}

function onOff(v: boolean): string {
  const t = strings.settings.perConnection;
  return v ? t.on : t.off;
}

/** A setting's value on its own ("Trackpad", "On", "1.50×", "Key set: Terminal"). */
export function valueText(
  d: SettingDescriptor,
  s: ResolvedSessionSettings,
  ctx: SummaryContext = DEFAULT_SUMMARY_CONTEXT,
): string {
  const v = s[d.key];
  switch (d.control) {
    case 'switch':
      return onOff(v === true);
    case 'choice':
      return d.optionLabel(String(v));
    case 'range':
      return d.format(v as number);
    case 'list':
      return d.summary(s, ctx);
  }
}

/** A setting's value with enough context to stand alone in a list ("Haptic feedback: Off"). */
export function settingText(
  d: SettingDescriptor,
  s: ResolvedSessionSettings,
  ctx: SummaryContext = DEFAULT_SUMMARY_CONTEXT,
): string {
  // A choice's option label names itself ("Trackpad", "Fit width"); the rest need the label.
  if (d.control === 'choice') return valueText(d, s, ctx);
  return `${d.label()}: ${valueText(d, s, ctx)}`;
}

/**
 * One line for a list row: up to two of the values that differ, then the count when there
 * are more ("Trackpad · Fit width · 3 changes"), or "Uses the defaults".
 */
export function summaryLine(
  own: SessionSettingsPatch,
  inherited: ResolvedSessionSettings,
  ctx: SummaryContext = DEFAULT_SUMMARY_CONTEXT,
): string {
  const t = strings.settings.perConnection;
  const keys = ownKeys(own);
  if (keys.length === 0) return t.usesDefaults;
  const differ = differingKeys(own, inherited);
  if (differ.length === 0) return t.sameAsDefaults(keys.length);
  const values = effectiveValues(inherited, own);
  const shown = differ.slice(0, 2).flatMap((k) => {
    const d = descriptorOf(k);
    return d ? [settingText(d, values, ctx)] : [];
  });
  return keys.length > shown.length
    ? [...shown, t.changes(keys.length)].join(' · ')
    : shown.join(' · ');
}

/** The name shown for a connection; one known only by its identifier gets a fallback. */
export function displayName(e: Pick<ConnectionEntry, 'name' | 'ref'>): string {
  const t = strings.settings.perConnection;
  if (e.name && e.name.trim() !== '') return e.name;
  return e.ref.type === 'g' ? t.unnamedGroup(e.ref.identifier) : t.unnamed(e.ref.identifier);
}

/** "A, B, C and 2 more" (at most `max` names). */
export function compactList(names: readonly string[], max = 3): string {
  const t = strings.settings.perConnection;
  if (names.length <= max) return names.join(', ');
  return t.andMore(names.slice(0, max).join(', '), names.length - max);
}

/** Connections with their own value for any of `keys` (all connections with any: no keys). */
export function entriesOverriding(
  entries: readonly ConnectionEntry[],
  keys?: readonly SettingKey[],
): ConnectionEntry[] {
  return entries.filter((e) => {
    const own = ownKeys(e.own);
    return keys ? own.some((k) => keys.includes(k)) : own.length > 0;
  });
}

/** Connections with their own value on a Settings page. */
export function entriesOverridingPage(
  entries: readonly ConnectionEntry[],
  page: SettingsPageId,
): ConnectionEntry[] {
  return entriesOverriding(entries, sessionKeysOf(page));
}

/** "Office desktop (Trackpad), Tablet (Touch pass-through) and 1 more" for one setting. */
export function overrideList(
  entries: readonly ConnectionEntry[],
  key: SettingKey,
  ctx: SummaryContext = DEFAULT_SUMMARY_CONTEXT,
  max = 3,
): string {
  const d = descriptorOf(key);
  const list = entriesOverriding(entries, [key]).map((e) =>
    d ? `${displayName(e)} (${valueText(d, effectiveValues(e.inherited, e.own), ctx)})` : '',
  );
  return compactList(list, max);
}

/** Names of the connections with their own value for `key` ("Also set for: …"). */
export function overrideNames(
  entries: readonly ConnectionEntry[],
  key: SettingKey,
  max = 3,
): string {
  return compactList(entriesOverriding(entries, [key]).map(displayName), max);
}

export interface ServerInput {
  readonly serverId: string;
  readonly serverName: string;
  readonly serverDetail?: string;
  readonly hasServerDefaults: boolean;
  /** The server's stored `sessionDefaults`. */
  readonly serverDefaults: SessionSettingsPatch;
  /** Every connection with stored settings. */
  readonly stored: readonly { readonly ref: ConnectionRef; readonly settings: unknown }[];
  readonly recents: readonly {
    readonly ref: ConnectionRef;
    readonly at: number;
    readonly name?: string;
    readonly protocol?: string;
  }[];
  readonly favourites: readonly ConnectionRef[];
  /** Names and protocols known otherwise (the Demo's built-in tree). */
  readonly known?: ReadonlyMap<string, { readonly name: string; readonly protocol: string }>;
}

/** A key for comparing refs (not the storage key). */
export function refId(ref: ConnectionRef): string {
  return `${ref.type}\u0000${ref.dataSource}\u0000${ref.identifier}`;
}

/**
 * Every connection known on this device for one server: those with stored settings,
 * recents and favourites, once each. With their own values first, then by name.
 */
export function buildServerGroup(
  input: ServerInput,
  appDefaults: SessionSettingsPatch,
): ServerGroup {
  const serverOwn = ownPatch(input.serverDefaults);
  const inherited = inheritedValues(appDefaults, serverOwn);
  const byId = new Map<
    string,
    {
      ref: ConnectionRef;
      own: SessionSettingsPatch;
      name?: string;
      protocol?: string;
      at?: number;
      fav: boolean;
    }
  >();
  const slot = (ref: ConnectionRef) => {
    const id = refId(ref);
    let s = byId.get(id);
    if (!s) {
      s = { ref, own: {}, fav: false };
      byId.set(id, s);
    }
    return s;
  };
  for (const x of input.stored) slot(x.ref).own = ownPatch(x.settings);
  for (const r of input.recents) {
    const s = slot(r.ref);
    if (r.name !== undefined && s.name === undefined) s.name = r.name;
    if (r.protocol !== undefined && s.protocol === undefined) s.protocol = r.protocol;
    if (s.at === undefined || r.at > s.at) s.at = r.at;
  }
  for (const f of input.favourites) slot(f).fav = true;
  const entries: ConnectionEntry[] = [...byId.values()].map((s) => {
    const k = input.known?.get(refId(s.ref));
    return {
      serverId: input.serverId,
      serverName: input.serverName,
      ref: s.ref,
      name: s.name ?? k?.name,
      protocol: s.protocol ?? k?.protocol,
      own: s.own,
      inherited,
      lastUsed: s.at,
      favourite: s.fav,
    };
  });
  entries.sort((a, b) => {
    const ao = ownKeys(a.own).length > 0 ? 0 : 1;
    const bo = ownKeys(b.own).length > 0 ? 0 : 1;
    return ao - bo || displayName(a).localeCompare(displayName(b));
  });
  return {
    serverId: input.serverId,
    serverName: input.serverName,
    ...(input.serverDetail ? { serverDetail: input.serverDetail } : {}),
    hasServerDefaults: input.hasServerDefaults,
    serverOwn,
    appInherited: inheritedValues(appDefaults),
    entries,
  };
}

/** Every entry of every group. */
export function allEntries(groups: readonly ServerGroup[]): ConnectionEntry[] {
  return groups.flatMap((g) => g.entries);
}
