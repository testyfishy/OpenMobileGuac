import { createContext, useContext } from 'react';
import type { SessionTarget } from '../nav/navigation.ts';
import type { InUsePlan } from './inUse.ts';
import type { SessionsState } from './sessionModel.ts';

export interface SessionsApi {
  readonly state: SessionsState;
  /** Set while the user must choose whether to close a session to open another (cap). */
  readonly limit: {
    readonly closeName: string;
    readonly max: number;
    readonly confirm: () => void;
    readonly cancel: () => void;
  } | null;
  /**
   * Set while the user must choose between the open session of that connection and another
   * one (setting "When a connection is already open" = Ask). `dontAskAgain` stores the answer.
   */
  readonly alreadyOpen: {
    readonly name: string;
    readonly goToOpen: (dontAskAgain: boolean) => void;
    readonly openAnother: (dontAskAgain: boolean) => void;
    readonly cancel: () => void;
  } | null;
  /**
   * Set while the user must answer "<name> is already in use" (MUL-5: the server reports
   * active sessions on the connection; setting "Ask before connecting").
   */
  readonly inUse: {
    readonly name: string;
    readonly plan: Extract<InUsePlan, { kind: 'prompt' }>;
    readonly askedAt: number;
    readonly busy: boolean;
    readonly error: string | undefined;
    readonly openExisting: (dontAskAgain: boolean) => void;
    readonly endAndStart: (dontAskAgain: boolean) => void;
    readonly openAnother: (dontAskAgain: boolean) => void;
    readonly cancel: () => void;
  } | null;
  /** Set while "Connect to <name>?" is showing ("Ask before connecting" = Always). */
  readonly connectConfirm: {
    readonly name: string;
    readonly checked: boolean;
    readonly connect: (dontAskAgain: boolean) => void;
    readonly cancel: () => void;
  } | null;
  /**
   * Opens a session, or goes to the one already open for that connection, as the setting
   * "When a connection is already open" says (may ask). Before a new session it may ask
   * whether to use one the server reports as running ("Ask before connecting", MUL-5),
   * unless `confirmed` (the user already confirmed this tap, e.g. an app link). May ask the
   * user to close one first (MUL-1 cap).
   */
  readonly open: (
    serverId: string,
    serverName: string,
    target: SessionTarget,
    options?: { readonly confirmed?: boolean },
  ) => void;
  /** Shows a session (the switcher). */
  readonly show: (id: string) => void;
  /** Back to the app chrome; the session stays connected in the background. */
  readonly hide: () => void;
  /** Disconnects and forgets a session. */
  readonly close: (id: string) => void;
  /** Disconnects every session of a server (sign-out, server deleted or edited). */
  readonly closeServer: (serverId: string) => void;
  /** Disconnects every open session (sign out of all servers, "Disconnect all"). */
  readonly closeAll: () => void;
  /** Reconnects a suspended session (re-validating the sign-in first). */
  readonly reconnect: (id: string) => void;
  /**
   * A live session's tunnel refused the sign-in (expired token): re-validate silently and
   * reconnect, or show "Sign in again" (T2.1).
   */
  readonly recoverSignIn: (id: string) => void;
  readonly switcherOpen: boolean;
  readonly setSwitcherOpen: (open: boolean) => void;
}

export const SessionsContext = createContext<SessionsApi | null>(null);

export function useSessions(): SessionsApi {
  const s = useContext(SessionsContext);
  if (!s) throw new Error('useSessions() outside <SessionsProvider>');
  return s;
}
