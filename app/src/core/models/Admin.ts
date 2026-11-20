import {
  ModelParseError,
  expectNonEmptyString,
  expectRecord,
  expectString,
  isRecord,
  join,
  optionalBoolean,
  optionalString,
  stringArray,
  stringMap,
  type JsonRecord,
} from './json.ts';
import { ROOT_GROUP_IDENTIFIER, type ConnectionGroupType } from './Connection.ts';

/**
 * Models for connection management (create / edit / delete connections and groups, schema,
 * permissions, active connections, history). Shapes: docs/protocol-notes.md §8.
 *
 * Parameter maps hold secrets (passwords, private keys). Nothing in this module logs or
 * stores them; callers must not either.
 */

// ---- permissions (§8.3) -------------------------------------------------------------------

export const ObjectPermission = {
  READ: 'READ',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  ADMINISTER: 'ADMINISTER',
} as const;

export const SystemPermission = {
  ADMINISTER: 'ADMINISTER',
  AUDIT: 'AUDIT',
  CREATE_USER: 'CREATE_USER',
  CREATE_USER_GROUP: 'CREATE_USER_GROUP',
  CREATE_CONNECTION: 'CREATE_CONNECTION',
  CREATE_CONNECTION_GROUP: 'CREATE_CONNECTION_GROUP',
  CREATE_SHARING_PROFILE: 'CREATE_SHARING_PROFILE',
} as const;

export type ObjectPermissionMap = ReadonlyMap<string, ReadonlySet<string>>;

/** `APIPermissionSet`, the effective permissions of the signed-in user in one data source. */
export interface PermissionSet {
  readonly system: ReadonlySet<string>;
  readonly connections: ObjectPermissionMap;
  readonly connectionGroups: ObjectPermissionMap;
  readonly activeConnections: ObjectPermissionMap;
}

export const EMPTY_PERMISSIONS: PermissionSet = {
  system: new Set(),
  connections: new Map(),
  connectionGroups: new Map(),
  activeConnections: new Map(),
};

function objectPermissions(obj: JsonRecord, key: string, path: string): ObjectPermissionMap {
  const value = obj[key];
  if (value === undefined || value === null) return new Map();
  const record = expectRecord(value, join(path, key));
  const out = new Map<string, ReadonlySet<string>>();
  for (const id of Object.keys(record)) {
    out.set(id, new Set(stringArray(record, id, join(path, key))));
  }
  return out;
}

export function parsePermissionSet(raw: unknown): PermissionSet {
  const obj = expectRecord(raw, '');
  return {
    system: new Set(stringArray(obj, 'systemPermissions', '')),
    connections: objectPermissions(obj, 'connectionPermissions', ''),
    connectionGroups: objectPermissions(obj, 'connectionGroupPermissions', ''),
    activeConnections: objectPermissions(obj, 'activeConnectionPermissions', ''),
  };
}

// ---- schema (§8.4) ------------------------------------------------------------------------

/** `org.apache.guacamole.form.Field`. `type` is free-form; extensions add their own. */
export interface SchemaField {
  readonly name: string;
  readonly type: string;
  readonly options: readonly string[];
}

/** `org.apache.guacamole.form.Form`: a named group of fields. */
export interface SchemaForm {
  readonly name: string;
  readonly fields: readonly SchemaField[];
}

/** `ProtocolInfo`: a protocol's parameter forms. */
export interface ProtocolSchema {
  readonly name: string;
  readonly connectionForms: readonly SchemaForm[];
}

function parseField(raw: unknown, path: string): SchemaField {
  const obj = expectRecord(raw, path);
  return {
    name: expectNonEmptyString(obj, 'name', path),
    type: optionalString(obj, 'type', path) ?? 'TEXT',
    options: stringArray(obj, 'options', path),
  };
}

export function parseForms(raw: unknown, path = ''): SchemaForm[] {
  if (!Array.isArray(raw)) throw new ModelParseError(path, 'expected an array of forms');
  return raw.map((f, i) => {
    const p = `${path}[${i}]`;
    const obj = expectRecord(f, p);
    const fields = obj['fields'];
    if (fields !== undefined && fields !== null && !Array.isArray(fields))
      throw new ModelParseError(join(p, 'fields'), 'expected an array');
    return {
      name: optionalString(obj, 'name', p) ?? '',
      fields: (Array.isArray(fields) ? fields : []).map((x, j) =>
        parseField(x, `${join(p, 'fields')}[${j}]`),
      ),
    };
  });
}

/** `GET schema/protocols`: a map of protocol name to `ProtocolInfo`. */
export function parseProtocols(raw: unknown): Record<string, ProtocolSchema> {
  const obj = expectRecord(raw, '');
  const out: Record<string, ProtocolSchema> = {};
  for (const [key, value] of Object.entries(obj)) {
    const p = expectRecord(value, key);
    out[key] = {
      name: optionalString(p, 'name', key) ?? key,
      connectionForms: parseForms(p['connectionForms'] ?? [], join(key, 'connectionForms')),
    };
  }
  return out;
}

// ---- connections and groups (§8.1, §8.2) ------------------------------------------------

/** A connection as sent to / read from `connections/{id}` (`APIConnection`). */
export interface ManagedConnection {
  /** Absent for a connection that has not been created yet. */
  readonly identifier?: string;
  readonly parentIdentifier: string;
  readonly name: string;
  readonly protocol: string;
  /** Secret-bearing. Empty string and absent both mean "unset" (§8.1). */
  readonly parameters: Readonly<Record<string, string>>;
  readonly attributes: Readonly<Record<string, string>>;
}

export interface ManagedGroup {
  readonly identifier?: string;
  readonly parentIdentifier: string;
  readonly name: string;
  readonly type: ConnectionGroupType;
  readonly attributes: Readonly<Record<string, string>>;
}

/** Parses `GET connections/{id}` (no parameters; those come from `…/parameters`). */
export function parseManagedConnection(raw: unknown): Omit<ManagedConnection, 'parameters'> {
  const obj = expectRecord(raw, '');
  return {
    identifier: expectNonEmptyString(obj, 'identifier', ''),
    parentIdentifier: optionalString(obj, 'parentIdentifier', '') ?? ROOT_GROUP_IDENTIFIER,
    name: expectString(obj, 'name', ''),
    protocol: optionalString(obj, 'protocol', '') ?? '',
    attributes: stringMap(obj, 'attributes', ''),
  };
}

/** Parses `GET connections/{id}/parameters`: a flat string map (nulls dropped). */
export function parseParameters(raw: unknown): Record<string, string> {
  return stringMap({ parameters: raw }, 'parameters', '');
}

export function parseManagedGroup(raw: unknown): ManagedGroup {
  const obj = expectRecord(raw, '');
  return {
    identifier: expectNonEmptyString(obj, 'identifier', ''),
    parentIdentifier: optionalString(obj, 'parentIdentifier', '') ?? ROOT_GROUP_IDENTIFIER,
    name: optionalString(obj, 'name', '') ?? '',
    type: optionalString(obj, 'type', '') ?? 'ORGANIZATIONAL',
    attributes: stringMap(obj, 'attributes', ''),
  };
}

/** The JSON body for POST/PUT. Always carries every field the server replaces (§8.1). */
export function connectionBody(c: ManagedConnection): JsonRecord {
  const body: JsonRecord = {
    parentIdentifier: c.parentIdentifier,
    name: c.name,
    protocol: c.protocol,
    parameters: { ...c.parameters },
    attributes: { ...c.attributes },
  };
  if (c.identifier !== undefined) body['identifier'] = c.identifier;
  return body;
}

export function groupBody(g: ManagedGroup): JsonRecord {
  const body: JsonRecord = {
    parentIdentifier: g.parentIdentifier,
    name: g.name,
    type: g.type,
    attributes: { ...g.attributes },
  };
  if (g.identifier !== undefined) body['identifier'] = g.identifier;
  return body;
}

// ---- active connections and history (§8.5) ----------------------------------------------

export interface ActiveConnection {
  readonly identifier: string;
  readonly connectionIdentifier: string | undefined;
  readonly startDate: number | undefined;
  readonly remoteHost: string | undefined;
  readonly username: string | undefined;
}

export interface HistoryEntry {
  readonly username: string | undefined;
  readonly startDate: number | undefined;
  readonly endDate: number | undefined;
  readonly remoteHost: string | undefined;
  readonly active: boolean;
}

/** Epoch ms from a number or an ISO date string (the Jackson setting is unverified). */
function optionalDate(obj: JsonRecord, key: string, path: string): number | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) return ms;
  }
  throw new ModelParseError(join(path, key), 'expected a date');
}

/** `GET activeConnections`: `{ [id]: APIActiveConnection }`. */
export function parseActiveConnections(raw: unknown): ActiveConnection[] {
  const obj = expectRecord(raw, '');
  return Object.entries(obj).map(([key, value]) => {
    const a = expectRecord(value, key);
    return {
      identifier: optionalString(a, 'identifier', key) ?? key,
      connectionIdentifier: optionalString(a, 'connectionIdentifier', key),
      startDate: optionalDate(a, 'startDate', key),
      remoteHost: optionalString(a, 'remoteHost', key),
      username: optionalString(a, 'username', key),
    };
  });
}

/** `GET connections/{id}/history`: `APIConnectionRecord[]`, newest first. */
export function parseHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) throw new ModelParseError('', 'expected an array');
  return raw.filter(isRecord).map((r, i) => ({
    username: optionalString(r, 'username', `[${i}]`),
    startDate: optionalDate(r, 'startDate', `[${i}]`),
    endDate: optionalDate(r, 'endDate', `[${i}]`),
    remoteHost: optionalString(r, 'remoteHost', `[${i}]`),
    active: optionalBoolean(r, 'active', `[${i}]`) ?? false,
  }));
}
