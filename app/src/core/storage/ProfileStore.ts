import {
  assertHttpBaseUrl,
  parseServerProfile,
  type ServerProfile,
} from '../models/ServerProfile.ts';
import { isRecord } from '../models/json.ts';
import type { KeyValueStore } from './KeyValueStore.ts';
import { secretKeys, type SecureStore } from './SecureStore.ts';

/**
 * Local, per-device app data for server profiles (SPEC SRV-1, CON-3):
 * - profiles, in user order;
 * - favourites per profile;
 * - recents per profile, newest first and capped;
 * - remembered settings per connection (display mode, keyboard layout, and so on).
 *
 * Stores no secrets. When a `SecureStore` is given, `remove()` also deletes that profile's
 * secrets. Every mutation runs through one queue, so concurrent calls cannot lose updates.
 *
 * Layout (all values JSON):
 * - `profiles`: `{ v: 1, profiles: ServerProfile[] }`
 * - `profile/<id>/favourites`: `ConnectionRef[]`
 * - `profile/<id>/recents`: `RecentEntry[]`
 * - `profile/<id>/connectionSettings`: `{ [refKey]: JsonObject }`
 */

/** Identifies a connectable item on a server. `type` uses tunnel `GUAC_TYPE` values. */
export interface ConnectionRef {
  readonly dataSource: string;
  readonly identifier: string;
  /** `c` = connection, `g` = connection group. */
  readonly type: 'c' | 'g';
}

export interface RecentEntry {
  readonly ref: ConnectionRef;
  /** Epoch milliseconds of the last use. */
  readonly at: number;
}

export type JsonValue =
  string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type ConnectionSettings = Readonly<Record<string, JsonValue>>;

export interface NewServerProfile {
  readonly name: string;
  readonly baseUrl: string;
  readonly username?: string;
  readonly rememberPassword?: boolean;
}

export type ServerProfilePatch = Partial<Omit<ServerProfile, 'id' | 'createdAt'>>;

export interface ProfileStoreOptions {
  readonly secureStore?: SecureStore;
  readonly generateId?: () => string;
  readonly now?: () => number;
  /** Maximum number of recents kept per profile. Default 20. */
  readonly maxRecents?: number;
}

const PROFILES_KEY = 'profiles';
const SCHEMA_VERSION = 1;
const profileKey = (id: string, part: string): string => `profile/${id}/${part}`;

export function connectionRefKey(ref: ConnectionRef): string {
  return `${ref.type}/${encodeURIComponent(ref.dataSource)}/${encodeURIComponent(ref.identifier)}`;
}

function sameRef(a: ConnectionRef, b: ConnectionRef): boolean {
  return a.type === b.type && a.dataSource === b.dataSource && a.identifier === b.identifier;
}

function parseRef(raw: unknown): ConnectionRef | undefined {
  if (!isRecord(raw)) return undefined;
  const { dataSource, identifier, type } = raw;
  if (typeof dataSource !== 'string' || typeof identifier !== 'string') return undefined;
  if (type !== 'c' && type !== 'g') return undefined;
  return { dataSource, identifier, type };
}

function parseJson(text: string | null): unknown {
  if (text === null) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export class ProfileStore {
  private readonly kv: KeyValueStore;
  private readonly secureStore: SecureStore | undefined;
  private readonly generateId: () => string;
  private readonly now: () => number;
  private readonly maxRecents: number;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(kv: KeyValueStore, options: ProfileStoreOptions = {}) {
    this.kv = kv;
    this.secureStore = options.secureStore;
    this.generateId = options.generateId ?? (() => globalThis.crypto.randomUUID());
    this.now = options.now ?? (() => Date.now());
    this.maxRecents = options.maxRecents ?? 20;
  }

  // ---- profiles -------------------------------------------------------------------------

  /** Profiles in user order. Corrupt entries are skipped, not thrown. */
  list(): Promise<ServerProfile[]> {
    return this.serialized(() => this.readProfiles());
  }

  async get(id: string): Promise<ServerProfile | undefined> {
    return (await this.list()).find((p) => p.id === id);
  }

  add(input: NewServerProfile): Promise<ServerProfile> {
    return this.serialized(async () => {
      assertHttpBaseUrl(input.baseUrl);
      const profiles = await this.readProfiles();
      const profile: ServerProfile = {
        id: this.generateId(),
        name: input.name,
        baseUrl: input.baseUrl,
        username: input.username ?? '',
        rememberPassword: input.rememberPassword ?? false,
        createdAt: this.now(),
      };
      if (profiles.some((p) => p.id === profile.id)) throw new Error('Generated a duplicate id');
      await this.writeProfiles([...profiles, profile]);
      return profile;
    });
  }

  update(id: string, patch: ServerProfilePatch): Promise<ServerProfile> {
    return this.serialized(async () => {
      if (patch.baseUrl !== undefined) assertHttpBaseUrl(patch.baseUrl);
      const profiles = await this.readProfiles();
      const index = profiles.findIndex((p) => p.id === id);
      const current = profiles[index];
      if (!current) throw new Error(`No profile with id ${id}`);
      const defined = Object.fromEntries(
        Object.entries(patch).filter(([, v]) => v !== undefined),
      ) as ServerProfilePatch;
      const updated: ServerProfile = {
        ...current,
        ...defined,
        id: current.id,
        createdAt: current.createdAt,
      };
      const next = [...profiles];
      next[index] = updated;
      await this.writeProfiles(next);
      return updated;
    });
  }

  /** Deletes the profile, its favourites, recents and settings, and its secrets. */
  remove(id: string): Promise<void> {
    return this.serialized(async () => {
      const profiles = await this.readProfiles();
      await this.writeProfiles(profiles.filter((p) => p.id !== id));
      for (const part of ['favourites', 'recents', 'connectionSettings']) {
        await this.kv.remove(profileKey(id, part));
      }
      if (this.secureStore) {
        for (const key of secretKeys.all(id)) await this.secureStore.remove(key);
      }
    });
  }

  /** Reorders profiles. `orderedIds` must be a permutation of the current ids. */
  reorder(orderedIds: readonly string[]): Promise<ServerProfile[]> {
    return this.serialized(async () => {
      const profiles = await this.readProfiles();
      const byId = new Map(profiles.map((p) => [p.id, p]));
      if (orderedIds.length !== profiles.length || new Set(orderedIds).size !== orderedIds.length) {
        throw new Error('reorder() needs every profile id exactly once');
      }
      const next = orderedIds.map((id) => {
        const p = byId.get(id);
        if (!p) throw new Error(`No profile with id ${id}`);
        return p;
      });
      await this.writeProfiles(next);
      return next;
    });
  }

  /** Moves one profile to `toIndex` (clamped). */
  async move(id: string, toIndex: number): Promise<ServerProfile[]> {
    const ids = (await this.list()).map((p) => p.id);
    const from = ids.indexOf(id);
    if (from < 0) throw new Error(`No profile with id ${id}`);
    ids.splice(from, 1);
    ids.splice(Math.max(0, Math.min(toIndex, ids.length)), 0, id);
    return this.reorder(ids);
  }

  // ---- favourites -----------------------------------------------------------------------

  listFavourites(profileId: string): Promise<ConnectionRef[]> {
    return this.serialized(() => this.readRefs(profileKey(profileId, 'favourites')));
  }

  async isFavourite(profileId: string, ref: ConnectionRef): Promise<boolean> {
    return (await this.listFavourites(profileId)).some((r) => sameRef(r, ref));
  }

  setFavourite(profileId: string, ref: ConnectionRef, favourite: boolean): Promise<void> {
    return this.serialized(async () => {
      const key = profileKey(profileId, 'favourites');
      const refs = (await this.readRefs(key)).filter((r) => !sameRef(r, ref));
      if (favourite)
        refs.push({ dataSource: ref.dataSource, identifier: ref.identifier, type: ref.type });
      await this.kv.set(key, JSON.stringify(refs));
    });
  }

  // ---- recents --------------------------------------------------------------------------

  /** Newest first. */
  listRecents(profileId: string): Promise<RecentEntry[]> {
    return this.serialized(() => this.readRecents(profileId));
  }

  recordRecent(profileId: string, ref: ConnectionRef, at: number = this.now()): Promise<void> {
    return this.serialized(async () => {
      const others = (await this.readRecents(profileId)).filter((e) => !sameRef(e.ref, ref));
      const entry: RecentEntry = {
        ref: { dataSource: ref.dataSource, identifier: ref.identifier, type: ref.type },
        at,
      };
      const next = [entry, ...others].sort((a, b) => b.at - a.at).slice(0, this.maxRecents);
      await this.kv.set(profileKey(profileId, 'recents'), JSON.stringify(next));
    });
  }

  clearRecents(profileId: string): Promise<void> {
    return this.serialized(() => this.kv.remove(profileKey(profileId, 'recents')));
  }

  // ---- per-connection settings ----------------------------------------------------------

  getConnectionSettings(
    profileId: string,
    ref: ConnectionRef,
  ): Promise<ConnectionSettings | undefined> {
    return this.serialized(async () => (await this.readSettings(profileId))[connectionRefKey(ref)]);
  }

  /** Replaces the remembered settings for one connection. `undefined` clears them. */
  setConnectionSettings(
    profileId: string,
    ref: ConnectionRef,
    settings: ConnectionSettings | undefined,
  ): Promise<void> {
    return this.serialized(async () => {
      const key = connectionRefKey(ref);
      const others = Object.entries(await this.readSettings(profileId)).filter(([k]) => k !== key);
      const next = Object.fromEntries(
        settings === undefined ? others : [...others, [key, settings]],
      );
      await this.kv.set(profileKey(profileId, 'connectionSettings'), JSON.stringify(next));
    });
  }

  // ---- internals ------------------------------------------------------------------------

  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async readProfiles(): Promise<ServerProfile[]> {
    const data = parseJson(await this.kv.get(PROFILES_KEY));
    if (!isRecord(data) || !Array.isArray(data['profiles'])) return [];
    const out: ServerProfile[] = [];
    const seen = new Set<string>();
    for (const raw of data['profiles'] as unknown[]) {
      try {
        const p = parseServerProfile(raw);
        if (!seen.has(p.id)) {
          seen.add(p.id);
          out.push(p);
        }
      } catch {
        // Skip a corrupt entry rather than losing every profile.
      }
    }
    return out;
  }

  private async writeProfiles(profiles: readonly ServerProfile[]): Promise<void> {
    await this.kv.set(PROFILES_KEY, JSON.stringify({ v: SCHEMA_VERSION, profiles }));
  }

  private async readRefs(key: string): Promise<ConnectionRef[]> {
    const data = parseJson(await this.kv.get(key));
    if (!Array.isArray(data)) return [];
    return data.map(parseRef).filter((r): r is ConnectionRef => r !== undefined);
  }

  private async readRecents(profileId: string): Promise<RecentEntry[]> {
    const data = parseJson(await this.kv.get(profileKey(profileId, 'recents')));
    if (!Array.isArray(data)) return [];
    const out: RecentEntry[] = [];
    for (const raw of data) {
      if (!isRecord(raw) || typeof raw['at'] !== 'number') continue;
      const ref = parseRef(raw['ref']);
      if (ref) out.push({ ref, at: raw['at'] });
    }
    return out.sort((a, b) => b.at - a.at);
  }

  private async readSettings(profileId: string): Promise<Record<string, ConnectionSettings>> {
    const data = parseJson(await this.kv.get(profileKey(profileId, 'connectionSettings')));
    if (!isRecord(data)) return {};
    const out: Record<string, ConnectionSettings> = {};
    for (const [k, v] of Object.entries(data)) {
      if (isRecord(v)) out[k] = v as ConnectionSettings;
    }
    return out;
  }
}
