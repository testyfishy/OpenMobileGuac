import type { GuacAdminApi } from '../../core/api/GuacAdminApi.ts';
import type { AuthSession } from '../../core/models/AuthSession.ts';
import type { SessionTarget } from '../nav/navigation.ts';
import type { ServerUse } from './inUse.ts';

/** How long connecting may wait for the server's answer. */
export const IN_USE_CHECK_TIMEOUT_MS = 2000;

type CheckApi = Pick<
  GuacAdminApi,
  'getActiveConnectionCount' | 'listActiveConnections' | 'getEffectivePermissions'
>;

function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/**
 * Asks the server, in parallel and within `timeoutMs`, how many active connections the
 * connection has (`GET connections/{id}`), which of them this account may see
 * (`GET activeConnections`, filtered by `connectionIdentifier`) and what it may do
 * (`GET self/effectivePermissions`). Resolves undefined when the count cannot be known, so
 * the caller just connects. Never rejects.
 */
export async function checkServerUse(
  api: CheckApi,
  session: AuthSession,
  target: SessionTarget,
  timeoutMs = IN_USE_CHECK_TIMEOUT_MS,
): Promise<ServerUse | undefined> {
  const ds = target.dataSource;
  const [count, list, perms] = await Promise.allSettled([
    within(api.getActiveConnectionCount(session, ds, target.identifier), timeoutMs),
    within(api.listActiveConnections(session, ds), timeoutMs),
    within(api.getEffectivePermissions(session, ds), timeoutMs),
  ]);
  const entries =
    list.status === 'fulfilled'
      ? list.value.filter((a) => a.connectionIdentifier === target.identifier)
      : undefined;
  if (count.status !== 'fulfilled' && entries === undefined) return undefined;
  return {
    count: count.status === 'fulfilled' ? count.value : (entries?.length ?? 0),
    entries,
    permissions: perms.status === 'fulfilled' ? perms.value : undefined,
  };
}
