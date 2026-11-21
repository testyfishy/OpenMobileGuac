import { describe, expect, it } from 'vitest';
import { EMPTY_PERMISSIONS, type ActiveConnection } from '../../core/models/Admin.ts';
import type { AuthSession } from '../../core/models/AuthSession.ts';
import type { SessionTarget } from '../nav/navigation.ts';
import { checkServerUse } from './inUseCheck.ts';

const session = { baseUrl: 'https://guac.example/', token: 't', username: 'alice' } as AuthSession;
const target: SessionTarget = {
  dataSource: 'postgresql',
  identifier: '1',
  type: 'c',
  name: 'Office PC',
  protocol: 'rdp',
};

const a = (identifier: string, connectionIdentifier: string): ActiveConnection => ({
  identifier,
  connectionIdentifier,
  startDate: 1,
  remoteHost: undefined,
  username: 'alice',
  connectable: true,
});

const never = () => new Promise<never>(() => undefined);
const fail = () => Promise.reject(new Error('denied'));

describe('the check before connecting (MUL-5)', () => {
  it('combines the count, this connection’s list entries and the permissions', async () => {
    const use = await checkServerUse(
      {
        getActiveConnectionCount: (_s, ds, id) => {
          expect([ds, id]).toEqual(['postgresql', '1']);
          return Promise.resolve(2);
        },
        listActiveConnections: () => Promise.resolve([a('x', '1'), a('y', '2')]),
        getEffectivePermissions: () => Promise.resolve(EMPTY_PERMISSIONS),
      },
      session,
      target,
    );
    expect(use?.count).toBe(2);
    expect(use?.entries?.map((e) => e.identifier)).toEqual(['x']);
    expect(use?.permissions).toBe(EMPTY_PERMISSIONS);
  });

  it('without the list (no permission), the count alone still counts', async () => {
    const use = await checkServerUse(
      {
        getActiveConnectionCount: () => Promise.resolve(1),
        listActiveConnections: fail,
        getEffectivePermissions: fail,
      },
      session,
      target,
    );
    expect(use).toEqual({ count: 1, entries: undefined, permissions: undefined });
  });

  it('without the count, the list gives it', async () => {
    const use = await checkServerUse(
      {
        getActiveConnectionCount: fail,
        listActiveConnections: () => Promise.resolve([a('x', '1')]),
        getEffectivePermissions: fail,
      },
      session,
      target,
    );
    expect(use?.count).toBe(1);
  });

  it('gives up (undefined: just connect) when nothing answers in time', async () => {
    const started = Date.now();
    const use = await checkServerUse(
      {
        getActiveConnectionCount: never,
        listActiveConnections: never,
        getEffectivePermissions: never,
      },
      session,
      target,
      30,
    );
    expect(use).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
