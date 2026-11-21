import { isRecord } from '../models/json.ts';
import { sameServerEndpoint } from '../url/normalizeServerUrl.ts';
import { parseServerProfile, type ServerProfile } from '../models/ServerProfile.ts';
import type { TlsPin } from '../tls/TlsPin.ts';
import type {
  ConnectionRef,
  ConnectionSettings,
  JsonValue,
  ProfileData,
  RecentEntry,
  RestoreEntry,
} from '../storage/ProfileStore.ts';

/**
 * Backup and restore (SPEC SRV-10). Pure: building, validating and planning a restore of a
 * versioned JSON file. Storage I/O is `ProfileStore.exportAll` / `applyRestore`.
 *
 * By default a backup holds no secrets at all (no passwords, tokens or TOTP seeds). The user
 * may opt in to include saved passwords and TOTP seeds, which are then encrypted with a
 * passphrase (PBKDF2-SHA256 + AES-GCM, WebCrypto). Session tokens are never exported.
 */

export const BACKUP_FORMAT = 'openmobileguac-backup';
export const BACKUP_VERSION = 1;

export interface BackupServer {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly username: string;
  readonly rememberPassword: boolean;
  readonly createdAt: number;
  readonly favourites: readonly ConnectionRef[];
  readonly recents: readonly RecentEntry[];
  readonly connectionSettings: Readonly<Record<string, ConnectionSettings>>;
  readonly options?: ConnectionSettings;
  /** SRV-8: the trusted certificate; restored only under the rules in `ProfileStore.applyRestore`. */
  readonly tlsPin?: TlsPin;
}

export interface EncryptedSecrets {
  readonly alg: 'AES-GCM';
  readonly kdf: 'PBKDF2-SHA256';
  readonly iterations: number;
  readonly salt: string;
  readonly iv: string;
  readonly data: string;
}

export interface BackupFile {
  readonly format: typeof BACKUP_FORMAT;
  readonly version: number;
  readonly exportedAt: string;
  readonly appVersion: string;
  /** Global app settings as stored; the UI sanitises them on import. */
  readonly settings?: Readonly<Record<string, JsonValue>>;
  readonly servers: readonly BackupServer[];
  readonly secrets?: EncryptedSecrets;
}

/** Per server id in the backup. */
export type BackupSecrets = Readonly<
  Record<
    string,
    {
      readonly password?: string;
      readonly totpSeed?: string;
      /** The server address the secrets were saved for (newer backups). */
      readonly baseUrl?: string;
      /** SHA-256 of the trusted certificate when the secrets were saved (SRV-8). */
      readonly tlsPin?: string;
    }
  >
>;

export function createBackup(input: {
  readonly profiles: readonly ProfileData[];
  readonly settings?: Readonly<Record<string, JsonValue>>;
  readonly appVersion: string;
  readonly now: number;
  readonly secrets?: EncryptedSecrets;
}): BackupFile {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date(input.now).toISOString(),
    appVersion: input.appVersion,
    ...(input.settings ? { settings: input.settings } : {}),
    servers: input.profiles.map((d) => ({
      id: d.profile.id,
      name: d.profile.name,
      baseUrl: d.profile.baseUrl,
      username: d.profile.username,
      rememberPassword: d.profile.rememberPassword,
      createdAt: d.profile.createdAt,
      favourites: d.favourites,
      recents: d.recents,
      connectionSettings: d.connectionSettings,
      ...(d.options ? { options: d.options } : {}),
      ...(d.profile.tlsPin ? { tlsPin: d.profile.tlsPin } : {}),
    })),
    ...(input.secrets ? { secrets: input.secrets } : {}),
  };
}

export type BackupParseError = 'json' | 'format' | 'version' | 'shape';

export type BackupParseResult =
  | {
      readonly ok: true;
      readonly backup: BackupFile;
      /** Server entries that were invalid and skipped. */
      readonly skipped: number;
    }
  | { readonly ok: false; readonly error: BackupParseError };

const MAX_SERVERS = 500;

function parseRef(raw: unknown): ConnectionRef | undefined {
  if (!isRecord(raw)) return undefined;
  const { dataSource, identifier, type } = raw;
  if (typeof dataSource !== 'string' || typeof identifier !== 'string') return undefined;
  if (type !== 'c' && type !== 'g') return undefined;
  return { dataSource, identifier, type };
}

function parseRecent(raw: unknown): RecentEntry | undefined {
  if (!isRecord(raw) || typeof raw['at'] !== 'number' || !Number.isFinite(raw['at'])) {
    return undefined;
  }
  const ref = parseRef(raw['ref']);
  if (!ref) return undefined;
  return {
    ref,
    at: raw['at'],
    ...(typeof raw['name'] === 'string' ? { name: raw['name'] } : {}),
    ...(typeof raw['protocol'] === 'string' ? { protocol: raw['protocol'] } : {}),
  };
}

function parseJsonObject(raw: unknown): ConnectionSettings | undefined {
  if (!isRecord(raw)) return undefined;
  // Round-trip through JSON so only plain JSON values survive.
  try {
    const v = JSON.parse(JSON.stringify(raw)) as unknown;
    return isRecord(v) ? (v as ConnectionSettings) : undefined;
  } catch {
    return undefined;
  }
}

function parseServer(raw: unknown): BackupServer | undefined {
  let profile: ServerProfile;
  try {
    profile = parseServerProfile(raw);
  } catch {
    return undefined;
  }
  const obj = raw as Record<string, unknown>;
  const favourites = Array.isArray(obj['favourites'])
    ? obj['favourites'].map(parseRef).filter((r): r is ConnectionRef => r !== undefined)
    : [];
  const recents = Array.isArray(obj['recents'])
    ? obj['recents'].map(parseRecent).filter((r): r is RecentEntry => r !== undefined)
    : [];
  const settingsRaw = isRecord(obj['connectionSettings']) ? obj['connectionSettings'] : {};
  const connectionSettings: Record<string, ConnectionSettings> = {};
  for (const [k, v] of Object.entries(settingsRaw)) {
    const s = parseJsonObject(v);
    if (s) connectionSettings[k] = s;
  }
  const options = parseJsonObject(obj['options']);
  return {
    ...profile,
    favourites,
    recents,
    connectionSettings,
    ...(options ? { options } : {}),
  };
}

function parseSecretsBlob(raw: unknown): EncryptedSecrets | undefined {
  if (!isRecord(raw)) return undefined;
  const { alg, kdf, iterations, salt, iv, data } = raw;
  if (alg !== 'AES-GCM' || kdf !== 'PBKDF2-SHA256') return undefined;
  if (typeof iterations !== 'number' || iterations < 10_000 || iterations > 10_000_000) {
    return undefined;
  }
  if (typeof salt !== 'string' || typeof iv !== 'string' || typeof data !== 'string') {
    return undefined;
  }
  return { alg, kdf, iterations, salt, iv, data };
}

export function parseBackup(text: string): BackupParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, error: 'json' };
  }
  if (!isRecord(raw) || raw['format'] !== BACKUP_FORMAT) return { ok: false, error: 'format' };
  const version = raw['version'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: 'version' };
  }
  // Newer files: refuse rather than silently dropping data we do not understand.
  if (version > BACKUP_VERSION) return { ok: false, error: 'version' };
  const serversRaw = raw['servers'];
  if (!Array.isArray(serversRaw) || serversRaw.length > MAX_SERVERS) {
    return { ok: false, error: 'shape' };
  }
  const servers: BackupServer[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const s of serversRaw) {
    const parsed = parseServer(s);
    if (!parsed || seen.has(parsed.id)) {
      skipped++;
      continue;
    }
    seen.add(parsed.id);
    servers.push(parsed);
  }
  const settings = parseJsonObject(raw['settings']);
  const secrets = parseSecretsBlob(raw['secrets']);
  return {
    ok: true,
    skipped,
    backup: {
      format: BACKUP_FORMAT,
      version,
      exportedAt: typeof raw['exportedAt'] === 'string' ? raw['exportedAt'] : '',
      appVersion: typeof raw['appVersion'] === 'string' ? raw['appVersion'] : '',
      ...(settings ? { settings } : {}),
      servers,
      ...(secrets ? { secrets } : {}),
    },
  };
}

export type RestoreMode = 'merge' | 'replace';

export interface RestorePlan {
  readonly entries: readonly RestoreEntry[];
  readonly removeIds: readonly string[];
  /** Backup server id → id it will be stored under. */
  readonly idMap: Readonly<Record<string, string>>;
  readonly added: number;
  readonly updated: number;
  readonly removed: number;
  /**
   * Backup servers whose id matched a saved server with a different address (scheme, host,
   * port or path). They are added as separate servers with no saved secrets, so the saved
   * server's password, token and TOTP seed are never sent to the backup's address.
   */
  readonly addressChanged: number;
  /** Backup ids of those servers: their secrets in the backup are not restored either. */
  readonly addressChangedIds: readonly string[];
}

/**
 * Which decrypted backup secrets may be stored, and under which profile id: never for a
 * server whose address changed against a saved one, and never when the address sealed in
 * the encrypted part differs from the backup's plain `baseUrl` (an edited file).
 */
export function secretsToRestore(
  plan: RestorePlan,
  backup: BackupFile,
  secrets: BackupSecrets,
): { readonly id: string; readonly password?: string; readonly totpSeed?: string }[] {
  const out: { id: string; password?: string; totpSeed?: string }[] = [];
  for (const [backupId, s] of Object.entries(secrets)) {
    const id = plan.idMap[backupId];
    if (!id || plan.addressChangedIds.includes(backupId)) continue;
    const server = backup.servers.find((x) => x.id === backupId);
    if (!server) continue;
    if (s.baseUrl !== undefined && !sameServerEndpoint(s.baseUrl, server.baseUrl)) continue;
    // SRV-8: a password must never reach a certificate the user did not trust for it. When
    // the plain part names a trusted certificate, the sealed part must name the same one.
    if (server.tlsPin && s.tlsPin !== server.tlsPin.sha256) continue;
    out.push({
      id,
      ...(s.password ? { password: s.password } : {}),
      ...(s.totpSeed ? { totpSeed: s.totpSeed } : {}),
    });
  }
  return out;
}

function toProfileData(s: BackupServer, id: string): ProfileData {
  return {
    profile: {
      id,
      name: s.name,
      baseUrl: s.baseUrl,
      username: s.username,
      rememberPassword: s.rememberPassword,
      createdAt: s.createdAt,
      ...(s.tlsPin ? { tlsPin: s.tlsPin } : {}),
    },
    favourites: s.favourites,
    recents: s.recents,
    connectionSettings: s.connectionSettings,
    options: s.options,
  };
}

/**
 * - `replace`: every existing profile is removed (with its secrets) and the backup's
 *   profiles are stored under their own ids.
 * - `merge`: a backup profile matches an existing one by id when the address (scheme, host,
 *   port, path) is the same, otherwise by address plus username; a match is updated
 *   (favourites and settings merged, secrets kept), anything else is added under a fresh id
 *   with no secrets. A same-id entry with another address is counted in `addressChanged`.
 */
export function planRestore(
  existing: readonly ServerProfile[],
  backup: BackupFile,
  mode: RestoreMode,
  generateId: () => string,
): RestorePlan {
  const idMap: Record<string, string> = {};
  if (mode === 'replace') {
    const entries = backup.servers.map((s) => {
      idMap[s.id] = s.id;
      return { targetId: s.id, data: toProfileData(s, s.id), merge: false };
    });
    return {
      entries,
      removeIds: existing.map((p) => p.id),
      idMap,
      added: entries.length,
      updated: 0,
      removed: existing.length,
      addressChanged: 0,
      addressChangedIds: [],
    };
  }
  const used = new Set(existing.map((p) => p.id));
  const claimed = new Set<string>();
  const entries: RestoreEntry[] = [];
  let added = 0;
  let updated = 0;
  let addressChanged = 0;
  const addressChangedIds: string[] = [];
  for (const s of backup.servers) {
    // An id match counts only when the address is the same: secrets are tied to the
    // endpoint, and a crafted or stale backup must not repoint a saved server (AUDIT #1).
    const byId = existing.find((p) => p.id === s.id && !claimed.has(p.id));
    if (byId && !sameServerEndpoint(byId.baseUrl, s.baseUrl)) {
      addressChanged++;
      addressChangedIds.push(s.id);
    }
    const match =
      (byId && sameServerEndpoint(byId.baseUrl, s.baseUrl) ? byId : undefined) ??
      existing.find(
        (p) =>
          !claimed.has(p.id) &&
          sameServerEndpoint(p.baseUrl, s.baseUrl) &&
          p.username === s.username,
      );
    if (match) {
      claimed.add(match.id);
      idMap[s.id] = match.id;
      entries.push({ targetId: match.id, data: toProfileData(s, match.id), merge: true });
      updated++;
      continue;
    }
    let id = s.id;
    for (let tries = 0; used.has(id); tries++) {
      if (tries > 1000) throw new Error('generateId keeps returning ids in use');
      id = generateId();
    }
    used.add(id);
    idMap[s.id] = id;
    entries.push({ targetId: id, data: toProfileData(s, id), merge: false });
    added++;
  }
  return {
    entries,
    removeIds: [],
    idMap,
    added,
    updated,
    removed: 0,
    addressChanged,
    addressChangedIds,
  };
}

// ---- optional encrypted secrets --------------------------------------------------------

const PBKDF2_ITERATIONS = 310_000;

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
  subtle: SubtleCrypto,
): Promise<CryptoKey> {
  const base = await subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptSecrets(
  secrets: BackupSecrets,
  passphrase: string,
  options: { iterations?: number; crypto?: Crypto } = {},
): Promise<EncryptedSecrets> {
  const c = options.crypto ?? globalThis.crypto;
  const iterations = options.iterations ?? PBKDF2_ITERATIONS;
  const salt = c.getRandomValues(new Uint8Array(16));
  const iv = c.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, iterations, c.subtle);
  const plain = new TextEncoder().encode(JSON.stringify(secrets));
  const data = new Uint8Array(
    await c.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, plain),
  );
  return {
    alg: 'AES-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations,
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(data),
  };
}

/** Rejects (with `Error('bad-passphrase')`) when the passphrase is wrong or data altered. */
export async function decryptSecrets(
  blob: EncryptedSecrets,
  passphrase: string,
  subtle: SubtleCrypto = globalThis.crypto.subtle,
): Promise<BackupSecrets> {
  let plain: ArrayBuffer;
  try {
    const key = await deriveKey(passphrase, fromBase64(blob.salt), blob.iterations, subtle);
    plain = await subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(blob.iv) as BufferSource },
      key,
      fromBase64(blob.data) as BufferSource,
    );
  } catch {
    throw new Error('bad-passphrase');
  }
  const parsed = JSON.parse(new TextDecoder().decode(plain)) as unknown;
  const out: Record<
    string,
    { password?: string; totpSeed?: string; baseUrl?: string; tlsPin?: string }
  > = {};
  if (isRecord(parsed)) {
    for (const [id, v] of Object.entries(parsed)) {
      if (!isRecord(v)) continue;
      out[id] = {
        ...(typeof v['password'] === 'string' ? { password: v['password'] } : {}),
        ...(typeof v['totpSeed'] === 'string' ? { totpSeed: v['totpSeed'] } : {}),
        ...(typeof v['baseUrl'] === 'string' ? { baseUrl: v['baseUrl'] } : {}),
        ...(typeof v['tlsPin'] === 'string' ? { tlsPin: v['tlsPin'] } : {}),
      };
    }
  }
  return out;
}

export function backupFileName(now: number): string {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `openmobileguac-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}
