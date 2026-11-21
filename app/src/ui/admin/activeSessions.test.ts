import { describe, expect, it } from 'vitest';
import {
  EMPTY_PERMISSIONS,
  ObjectPermission,
  SystemPermission,
  type ActiveConnection,
  type PermissionSet,
} from '../../core/models/Admin.ts';
import type { Connection, ConnectionTree } from '../../core/models/Connection.ts';
import { openTargetKeys, sameTarget, type SessionsState } from '../sessions/sessionModel.ts';
import { activeSessionRows } from './activeSessions.ts';
import { canJoin, canViewSessions } from './permissions.ts';

const conn = (identifier: string, name: string): Connection => ({
  kind: 'connection',
  dataSource: 'postgresql',
  identifier,
  parentIdentifier: 'ROOT',
  name,
  protocol: 'rdp',
  activeConnections: 1,
  lastActive: undefined,
  attributes: {},
  sharingProfiles: [],
});

const tree: ConnectionTree = {
  dataSources: [
    {
      dataSource: 'postgresql',
      root: {
        kind: 'group',
        dataSource: 'postgresql',
        identifier: 'ROOT',
        parentIdentifier: undefined,
        name: 'ROOT',
        type: 'ORGANIZATIONAL',
        activeConnections: 0,
        childConnections: [conn('7', 'Office PC')],
        childConnectionGroups: [],
        attributes: {},
      },
    },
  ],
};

const active = (over: Partial<ActiveConnection>): ActiveConnection => ({
  identifier: 'a1',
  connectionIdentifier: '7',
  startDate: 1000,
  remoteHost: '192.0.2.9',
  username: 'bob',
  connectable: true,
  ...over,
});

const admin: PermissionSet = {
  ...EMPTY_PERMISSIONS,
  system: new Set([SystemPermission.ADMINISTER]),
};

describe('server-wide active sessions (guacSettingsSessions.js)', () => {
  it('lists newest first with connection names, Join only when connectable', () => {
    const rows = activeSessionRows(
      tree,
      [
        {
          dataSource: 'postgresql',
          items: [
            active({ identifier: 'old', startDate: 1 }),
            active({ identifier: 'new', startDate: 5, connectable: false }),
            active({ identifier: 'gone', connectionIdentifier: '99', startDate: 3 }),
          ],
        },
      ],
      new Map([['postgresql', admin]]),
    );
    expect(rows.map((r) => r.active.identifier)).toEqual(['new', 'gone', 'old']);
    expect(rows[0]?.joinTarget).toBeUndefined();
    expect(rows[1]?.connectionName).toBeUndefined();
    expect(rows[1]?.joinTarget).toBeUndefined();
    expect(rows[2]?.connectionName).toBe('Office PC');
    expect(rows[2]?.joinTarget).toMatchObject({
      type: 'c',
      identifier: '7',
      dataSource: 'postgresql',
      join: 'old',
    });
    expect(rows.every((r) => r.canKill)).toBe(true);
  });

  it('Disconnect needs ADMINISTER or DELETE on that active connection', () => {
    const own: PermissionSet = {
      ...EMPTY_PERMISSIONS,
      activeConnections: new Map([['a1', new Set([ObjectPermission.DELETE])]]),
    };
    const rows = activeSessionRows(
      tree,
      [{ dataSource: 'postgresql', items: [active({}), active({ identifier: 'a2' })] }],
      new Map([['postgresql', own]]),
    );
    expect(rows.find((r) => r.active.identifier === 'a1')?.canKill).toBe(true);
    expect(rows.find((r) => r.active.identifier === 'a2')?.canKill).toBe(false);
  });

  it('gating', () => {
    expect(canViewSessions(admin)).toBe(true);
    expect(canViewSessions(EMPTY_PERMISSIONS)).toBe(false);
    expect(canJoin(true)).toBe(true);
    expect(canJoin(undefined)).toBe(false);
  });
});

describe('joined sessions in the session list', () => {
  const owner = {
    dataSource: 'postgresql',
    identifier: '7',
    type: 'c' as const,
    name: 'Office PC',
    protocol: 'rdp',
  };
  const joined = { ...owner, join: 'a1' };

  it('are separate from the owner’s own session and do not mark the connection open', () => {
    expect(sameTarget(owner, joined)).toBe(false);
    expect(sameTarget(joined, { ...joined })).toBe(true);
    const state: SessionsState = {
      activeId: null,
      sessions: [
        {
          id: 's1',
          serverId: 'srv',
          serverName: 'Home',
          target: joined,
          openedAt: 0,
          lastShownAt: 0,
          state: 'live',
          epoch: 0,
        },
      ],
    };
    expect(openTargetKeys(state, 'srv').size).toBe(0);
  });
});
