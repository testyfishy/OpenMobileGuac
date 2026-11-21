import { createContext, useContext } from 'react';
import type { GuacAdminApi } from '../../core/api/GuacAdminApi.ts';
import type { PermissionSet } from '../../core/models/Admin.ts';
import type { AuthSession } from '../../core/models/AuthSession.ts';
import type { ConnectionTree } from '../../core/models/Connection.ts';

/** What the management layer is showing. One at a time; editors are full screen. */
export type AdminAction =
  | { readonly type: 'add-menu' }
  | {
      readonly type: 'new-connection';
      readonly dataSource?: string;
      readonly parent?: string;
    }
  | { readonly type: 'edit-connection'; readonly dataSource: string; readonly id: string }
  | { readonly type: 'clone-connection'; readonly dataSource: string; readonly id: string }
  | { readonly type: 'new-group'; readonly dataSource?: string; readonly parent?: string }
  | { readonly type: 'edit-group'; readonly dataSource: string; readonly id: string }
  | { readonly type: 'group-menu'; readonly dataSource: string; readonly id: string }
  | {
      readonly type: 'move';
      readonly kind: 'connection' | 'group';
      readonly dataSource: string;
      readonly id: string;
      readonly name: string;
      readonly parent: string;
    }
  | {
      readonly type: 'delete';
      readonly kind: 'connection' | 'group';
      readonly dataSource: string;
      readonly id: string;
      readonly name: string;
    }
  /** Every active session in the managed data sources (Kill, Join). */
  | { readonly type: 'sessions' }
  | {
      readonly type: 'activity';
      readonly dataSource: string;
      readonly id: string;
      readonly name: string;
    };

export interface AdminContextValue {
  readonly session: AuthSession;
  readonly tree: ConnectionTree;
  readonly api: GuacAdminApi;
  /**
   * Effective permissions per data source, only for sources where management is offered
   * (loaded, grants something, and no 403 since the last refresh).
   */
  readonly permissions: ReadonlyMap<string, PermissionSet>;
  /** Data sources where a new connection / folder may be created. */
  readonly canCreateIn: {
    readonly connection: readonly string[];
    readonly group: readonly string[];
  };
  /** A management call was refused (403 with a valid session). */
  readonly deniedNotice: boolean;
  readonly open: (action: AdminAction) => void;
  readonly close: () => void;
  /** Hides management for a data source after a permission-denied answer. */
  readonly markDenied: (dataSource: string) => void;
  /** Something changed on the server: reload the tree (and permissions). */
  readonly changed: () => void;
}

export const AdminContext = createContext<AdminContextValue | null>(null);

/** The management layer for the current server, or `null` (demo, signed out, no rights). */
export function useAdmin(): AdminContextValue | null {
  return useContext(AdminContext);
}

/**
 * For the connection browser: whether empty folders of a data source should be listed (so a
 * folder just created, or an empty server, can still be managed).
 */
export function useShowsEmptyGroups(): (dataSource: string) => boolean {
  const admin = useAdmin();
  return (dataSource: string) => admin?.permissions.has(dataSource) ?? false;
}
