import {
  ModelParseError,
  expectNonEmptyString,
  expectRecord,
  expectString,
  join,
  optionalNumber,
  optionalString,
  recordArray,
  stringMap,
  type JsonRecord,
} from './json.ts';

/**
 * Connection and connection-group models, parsed from the
 * `GET api/session/data/{dataSource}/connectionGroups/ROOT/tree` response.
 * Shapes: docs/protocol-notes.md §2.1.
 */

export const ROOT_GROUP_IDENTIFIER = 'ROOT';

/** Known group types; unknown future values are kept verbatim. */
export type ConnectionGroupType = 'ORGANIZATIONAL' | 'BALANCING' | (string & Record<never, never>);

export interface SharingProfile {
  readonly identifier: string;
  readonly name: string;
}

export interface Connection {
  readonly kind: 'connection';
  /** The data source (auth provider identifier) this connection came from. */
  readonly dataSource: string;
  readonly identifier: string;
  readonly parentIdentifier: string | undefined;
  readonly name: string;
  /** `rdp`, `vnc`, `ssh`, … (free-form upstream). */
  readonly protocol: string;
  /** Number of current users of this connection. */
  readonly activeConnections: number;
  /** Epoch milliseconds of the last use, if the server reports it. */
  readonly lastActive: number | undefined;
  readonly attributes: Readonly<Record<string, string>>;
  readonly sharingProfiles: readonly SharingProfile[];
}

export interface ConnectionGroup {
  readonly kind: 'group';
  readonly dataSource: string;
  readonly identifier: string;
  readonly parentIdentifier: string | undefined;
  readonly name: string;
  readonly type: ConnectionGroupType;
  readonly activeConnections: number;
  readonly childConnections: readonly Connection[];
  readonly childConnectionGroups: readonly ConnectionGroup[];
  readonly attributes: Readonly<Record<string, string>>;
}

/** One data source's tree. */
export interface DataSourceTree {
  readonly dataSource: string;
  readonly root: ConnectionGroup;
}

/** The connection tree across all of a session's data sources (SPEC CON-1). */
export interface ConnectionTree {
  readonly dataSources: readonly DataSourceTree[];
}

/** Guards against pathological or cyclic input. Real trees are far shallower. */
const MAX_DEPTH = 64;

function parseLastActive(obj: JsonRecord, path: string): number | undefined {
  const value = obj['lastActive'];
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number') return optionalNumber(obj, 'lastActive', path);
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) throw new ModelParseError(join(path, 'lastActive'), 'unparseable date');
    return ms;
  }
  throw new ModelParseError(join(path, 'lastActive'), 'expected a number or date string');
}

function parseSharingProfile(raw: JsonRecord, path: string): SharingProfile {
  return {
    identifier: expectNonEmptyString(raw, 'identifier', path),
    name: optionalString(raw, 'name', path) ?? '',
  };
}

export function parseConnection(raw: unknown, dataSource: string, path = ''): Connection {
  const obj = expectRecord(raw, path);
  return {
    kind: 'connection',
    dataSource,
    identifier: expectNonEmptyString(obj, 'identifier', path),
    parentIdentifier: optionalString(obj, 'parentIdentifier', path),
    name: expectString(obj, 'name', path),
    protocol: optionalString(obj, 'protocol', path) ?? '',
    activeConnections: optionalNumber(obj, 'activeConnections', path) ?? 0,
    lastActive: parseLastActive(obj, path),
    attributes: stringMap(obj, 'attributes', path),
    sharingProfiles: recordArray(obj, 'sharingProfiles', path).map((sp, i) =>
      parseSharingProfile(sp, `${join(path, 'sharingProfiles')}[${i}]`),
    ),
  };
}

export function parseConnectionGroup(
  raw: unknown,
  dataSource: string,
  path = '',
  depth = 0,
): ConnectionGroup {
  if (depth > MAX_DEPTH) throw new ModelParseError(path, 'connection tree is too deep');
  const obj = expectRecord(raw, path);
  return {
    kind: 'group',
    dataSource,
    identifier: expectNonEmptyString(obj, 'identifier', path),
    parentIdentifier: optionalString(obj, 'parentIdentifier', path),
    name: optionalString(obj, 'name', path) ?? '',
    type: optionalString(obj, 'type', path) ?? 'ORGANIZATIONAL',
    activeConnections: optionalNumber(obj, 'activeConnections', path) ?? 0,
    childConnections: recordArray(obj, 'childConnections', path).map((c, i) =>
      parseConnection(c, dataSource, `${join(path, 'childConnections')}[${i}]`),
    ),
    childConnectionGroups: recordArray(obj, 'childConnectionGroups', path).map((g, i) =>
      parseConnectionGroup(
        g,
        dataSource,
        `${join(path, 'childConnectionGroups')}[${i}]`,
        depth + 1,
      ),
    ),
    attributes: stringMap(obj, 'attributes', path),
  };
}

/** Every connection in the tree, depth first, in server order. Useful for search (CON-2). */
export function flattenConnections(tree: ConnectionTree): Connection[] {
  const out: Connection[] = [];
  const visit = (group: ConnectionGroup): void => {
    out.push(...group.childConnections);
    group.childConnectionGroups.forEach(visit);
  };
  tree.dataSources.forEach((ds) => visit(ds.root));
  return out;
}
