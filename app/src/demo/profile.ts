/**
 * The built-in "Demo server" the UI can list next to the user's own servers. All values
 * are invented; `demo.invalid` uses the reserved `.invalid` TLD so it can never resolve.
 */
import type { AuthSession } from '../core/models/AuthSession.ts';
import type { Connection, ConnectionGroup, ConnectionTree } from '../core/models/Connection.ts';
import type { ServerProfile } from '../core/models/ServerProfile.ts';

export const DEMO_PROFILE_ID = 'builtin-demo';
export const DEMO_DATA_SOURCE = 'demo';
export const DEMO_BASE_URL = 'https://demo.invalid';

export const DEMO_SERVER_PROFILE: ServerProfile = {
  id: DEMO_PROFILE_ID,
  name: 'Demo server',
  baseUrl: DEMO_BASE_URL,
  username: '',
  rememberPassword: false,
  createdAt: 0,
};

/** A ready-made session for the demo profile; no login is needed. */
export const DEMO_AUTH_SESSION: AuthSession = {
  baseUrl: DEMO_BASE_URL,
  token: 'demo',
  username: '',
  primaryDataSource: DEMO_DATA_SOURCE,
  dataSources: [DEMO_DATA_SOURCE],
};

/** How a demo connection behaves, keyed by connection identifier (`GUAC_ID`). */
export interface DemoVariant {
  readonly name: string;
  /** Fixed desktop size, ignoring the client's requested size. */
  readonly fixed?: { readonly width: number; readonly height: number };
}

export const DEMO_VARIANTS: Readonly<Record<string, DemoVariant>> = {
  'demo-desktop': { name: 'Demo desktop' },
  'demo-desktop-1024': {
    name: 'Demo desktop (fixed 1024 × 768)',
    fixed: { width: 1024, height: 768 },
  },
  'demo-desktop-1920': {
    name: 'Demo desktop (fixed 1920 × 1080)',
    fixed: { width: 1920, height: 1080 },
  },
};

export const DEFAULT_DEMO_CONNECTION_ID = 'demo-desktop';

function connection(identifier: string): Connection {
  return {
    kind: 'connection',
    dataSource: DEMO_DATA_SOURCE,
    identifier,
    parentIdentifier: 'ROOT',
    name: DEMO_VARIANTS[identifier]?.name ?? identifier,
    protocol: 'demo',
    activeConnections: 0,
    lastActive: undefined,
    attributes: {},
    sharingProfiles: [],
  };
}

export const DEMO_CONNECTIONS: readonly Connection[] = Object.keys(DEMO_VARIANTS).map(connection);

export const DEMO_ROOT_GROUP: ConnectionGroup = {
  kind: 'group',
  dataSource: DEMO_DATA_SOURCE,
  identifier: 'ROOT',
  parentIdentifier: undefined,
  name: 'Demo server',
  type: 'ORGANIZATIONAL',
  activeConnections: 0,
  childConnections: DEMO_CONNECTIONS,
  childConnectionGroups: [],
  attributes: {},
};

export const DEMO_CONNECTION_TREE: ConnectionTree = {
  dataSources: [{ dataSource: DEMO_DATA_SOURCE, root: DEMO_ROOT_GROUP }],
};

export function isDemoProfile(profileId: string): boolean {
  return profileId === DEMO_PROFILE_ID;
}

export function isDemoBaseUrl(baseUrl: string): boolean {
  return baseUrl === DEMO_BASE_URL;
}

/** The variant for a connection identifier; unknown identifiers get the default desktop. */
export function demoVariant(identifier: string | null | undefined): DemoVariant {
  return (
    DEMO_VARIANTS[identifier ?? ''] ?? (DEMO_VARIANTS[DEFAULT_DEMO_CONNECTION_ID] as DemoVariant)
  );
}
