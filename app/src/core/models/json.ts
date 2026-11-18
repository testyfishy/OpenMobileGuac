/**
 * Small, dependency-free helpers for validating untrusted JSON.
 *
 * Every reader takes a `path` used only for error messages, so a parse failure points at the
 * offending field (for example `childConnectionGroups[2].name`).
 */

/** Thrown when JSON does not have the shape a model expects. */
export class ModelParseError extends Error {
  readonly path: string;

  constructor(path: string, problem: string) {
    super(`${path || '<root>'}: ${problem}`);
    this.name = 'ModelParseError';
    this.path = path;
  }
}

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function expectRecord(value: unknown, path: string): JsonRecord {
  if (!isRecord(value)) throw new ModelParseError(path, 'expected an object');
  return value;
}

export function expectString(obj: JsonRecord, key: string, path: string): string {
  const value = obj[key];
  if (typeof value !== 'string') throw new ModelParseError(join(path, key), 'expected a string');
  return value;
}

export function expectNonEmptyString(obj: JsonRecord, key: string, path: string): string {
  const value = expectString(obj, key, path);
  if (value.length === 0) throw new ModelParseError(join(path, key), 'must not be empty');
  return value;
}

/** Returns `undefined` when the key is absent or null (Jackson NON_NULL omits nulls). */
export function optionalString(obj: JsonRecord, key: string, path: string): string | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new ModelParseError(join(path, key), 'expected a string');
  return value;
}

export function optionalNumber(obj: JsonRecord, key: string, path: string): number | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ModelParseError(join(path, key), 'expected a finite number');
  }
  return value;
}

export function optionalBoolean(obj: JsonRecord, key: string, path: string): boolean | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new ModelParseError(join(path, key), 'expected a boolean');
  return value;
}

/** An array of strings; absent/null becomes an empty array. */
export function stringArray(obj: JsonRecord, key: string, path: string): string[] {
  const value = obj[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ModelParseError(join(path, key), 'expected an array');
  return value.map((item, i) => {
    if (typeof item !== 'string') {
      throw new ModelParseError(`${join(path, key)}[${i}]`, 'expected a string');
    }
    return item;
  });
}

/** An array of objects; absent/null becomes an empty array. */
export function recordArray(obj: JsonRecord, key: string, path: string): JsonRecord[] {
  const value = obj[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ModelParseError(join(path, key), 'expected an array');
  return value.map((item, i) => expectRecord(item, `${join(path, key)}[${i}]`));
}

/**
 * A `{ [name]: string }` map. Absent/null becomes `{}`. Null values inside the map are
 * dropped (Guacamole attribute maps may contain nulls for unset attributes).
 */
export function stringMap(obj: JsonRecord, key: string, path: string): Record<string, string> {
  const value = obj[key];
  if (value === undefined || value === null) return {};
  const record = expectRecord(value, join(path, key));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) {
    if (v === null || v === undefined) continue;
    if (typeof v !== 'string')
      throw new ModelParseError(`${join(path, key)}.${k}`, 'expected a string');
    out[k] = v;
  }
  return out;
}

export function join(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}
