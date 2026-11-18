import { useCallback, useEffect, useReducer, useState } from 'react';
import { isGuacApiError } from '../../core/api/errors.ts';
import type { Connection, ConnectionTree } from '../../core/models/Connection.ts';
import type { ServerProfile } from '../../core/models/ServerProfile.ts';
import type { ConnectionRef } from '../../core/storage/ProfileStore.ts';
import { authFlowReducer, initialAuthFlow, isBusy } from '../auth/authFlow.ts';
import { HttpWarningDialog } from '../auth/HttpWarningDialog.tsx';
import { LoginForm } from '../auth/LoginForm.tsx';
import { EmptyState, ErrorBanner, Spinner } from '../components/Feedback.tsx';
import { IconButton, Screen } from '../components/Screen.tsx';
import { PullToRefresh } from '../components/PullToRefresh.tsx';
import { describeError, type UiError } from '../errors/errorMessages.ts';
import { useNav } from '../nav/NavContext.ts';
import { useServices } from '../services/context.ts';
import { hostOf, isInsecureUrl } from '../servers/serverForm.ts';
import { useServerProfile } from '../servers/useServers.ts';
import { strings } from '../strings.ts';
import { ConnectionBrowser } from './ConnectionBrowser.tsx';
import { DemoConnections } from './DemoConnections.tsx';
import { SearchBox } from './SearchBox.tsx';
import { refOf } from './treeView.ts';

export function ConnectionsScreen({ serverId }: { serverId: string }) {
  const nav = useNav();
  const lookup = useServerProfile(serverId);
  if (lookup.status === 'demo') return <DemoConnections />;
  if (lookup.status === 'ready')
    return <ServerConnections key={lookup.profile.id} profile={lookup.profile} />;
  return (
    <Screen title={strings.connections.title} onBack={nav.back}>
      {lookup.status === 'loading' ? (
        <Spinner label={strings.common.loading} />
      ) : (
        <EmptyState icon="server" title={strings.servers.selectPrompt} />
      )}
    </Screen>
  );
}

/** The last tree load. `nonce` identifies the request it answers; a newer request = loading. */
interface TreeState {
  readonly nonce: number;
  readonly tree?: ConnectionTree;
  readonly error?: UiError;
}

/** Sign-in plus the connection browser for one real server. */
function ServerConnections({ profile }: { profile: ServerProfile }) {
  const nav = useNav();
  const services = useServices();
  const { auth } = services;
  const browser = !services.native;
  const [flow, dispatch] = useReducer(authFlowReducer, undefined, initialAuthFlow);
  const [tree, setTree] = useState<TreeState>({ nonce: 0 });
  const [treeNonce, setTreeNonce] = useState(1);
  const [query, setQuery] = useState('');
  const [favourites, setFavourites] = useState<ConnectionRef[]>([]);
  const [recents, setRecents] = useState<ConnectionRef[]>([]);
  const title = profile.name || hostOf(profile.baseUrl);
  const insecure = isInsecureUrl(profile.baseUrl);

  // Start: stored token → saved password → form.
  useEffect(() => {
    let live = true;
    void (async () => {
      const [secrets, dismissed] = await Promise.all([
        auth.loadSecrets(profile),
        services.settings.isHttpWarningDismissed(profile.id),
      ]);
      if (!live) return;
      dispatch({
        type: 'start',
        hasToken: secrets.token !== null,
        username: profile.username,
        savedPassword: secrets.password,
        remember: profile.rememberPassword,
        needsHttpConfirm: insecure && !dismissed,
      });
    })();
    return () => {
      live = false;
    };
    // Run once per profile; later profile edits remount this component (keyed by id).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Side effects of the auth flow. Results carry `seq`; the reducer drops stale ones.
  const { phase, seq } = flow;
  useEffect(() => {
    if (phase === 'checking-token') {
      void (async () => {
        const { token } = await auth.loadSecrets(profile);
        if (!token) {
          dispatch({ type: 'token-failed', seq, expired: false });
          return;
        }
        try {
          await auth.resume(profile, token);
          dispatch({ type: 'token-ok', seq });
        } catch (err) {
          const info = isGuacApiError(err) ? err.info : undefined;
          const expired = info?.kind === 'session-expired';
          dispatch({
            type: 'token-failed',
            seq,
            expired,
            error: expired ? undefined : info,
            browser,
          });
        }
      })();
    }
    if (phase === 'signing-in') {
      const values = flow.values;
      void (async () => {
        try {
          await auth.login(profile, values);
          dispatch({ type: 'login-ok', seq });
        } catch (err) {
          if (isGuacApiError(err))
            dispatch({ type: 'login-failed', seq, error: err.info, browser });
          else
            dispatch({
              type: 'login-failed',
              seq,
              error: { kind: 'invalid-response', url: profile.baseUrl, detail: 'unexpected' },
              browser,
            });
        }
      })();
    }
    // `flow.values` is read for the attempt identified by `seq` only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, seq]);

  // Load favourites/recents once signed in.
  const loadLocal = useCallback(async () => {
    const [f, r] = await Promise.all([
      services.profiles.listFavourites(profile.id),
      services.profiles.listRecents(profile.id),
    ]);
    setFavourites(f);
    setRecents(r.map((e) => e.ref));
  }, [services.profiles, profile.id]);

  // Load the tree when authenticated (and on refresh).
  const authenticated = phase === 'authenticated';
  useEffect(() => {
    if (!authenticated) return undefined;
    const session = auth.current(profile.id);
    if (!session) return undefined;
    let live = true;
    const nonce = treeNonce;
    void Promise.all([
      services.profiles.listFavourites(profile.id),
      services.profiles.listRecents(profile.id),
    ]).then(([f, r]) => {
      if (!live) return;
      setFavourites(f);
      setRecents(r.map((e) => e.ref));
    });
    services.api.getConnectionTree(session).then(
      (result) => {
        if (live) setTree({ nonce, tree: result });
      },
      (err: unknown) => {
        if (!live) return;
        if (isGuacApiError(err, 'session-expired')) {
          setTree({ nonce });
          setTreeNonce((n) => n + 1);
          void auth.forgetToken(profile.id).then(() => dispatch({ type: 'session-expired' }));
          return;
        }
        setTree((t) => ({ nonce, tree: t.tree, error: describeError(err, { browser }) }));
      },
    );
    return () => {
      live = false;
    };
  }, [authenticated, treeNonce, auth, profile.id, services.api, services.profiles, browser]);

  const refresh = () => setTreeNonce((n) => n + 1);

  const onConnect = (c: Connection) => {
    void services.profiles.recordRecent(profile.id, refOf(c));
    nav.push({
      name: 'session',
      serverId: profile.id,
      target: {
        dataSource: c.dataSource,
        identifier: c.identifier,
        type: 'c',
        name: c.name,
        protocol: c.protocol,
      },
    });
  };

  const onToggleFavourite = (c: Connection, fav: boolean) => {
    void services.profiles.setFavourite(profile.id, refOf(c), fav).then(loadLocal);
  };

  const onLogout = async () => {
    await auth.logout(profile.id);
    setTree({ nonce: 0 });
    setTreeNonce((n) => n + 1);
    dispatch({ type: 'logout' });
  };

  const rememberHint =
    services.secretStorage === 'secure'
      ? strings.serverForm.rememberHintSecure
      : services.secretStorage === 'insecure-dev'
        ? strings.serverForm.rememberHintDev
        : strings.serverForm.rememberHintMemory;

  const session = authenticated ? auth.current(profile.id) : undefined;
  const loadingTree = authenticated && tree.nonce !== treeNonce;

  return (
    <Screen
      title={title}
      onBack={nav.back}
      actions={
        authenticated ? (
          <>
            <IconButton
              icon="refresh"
              label={strings.common.refresh}
              onClick={refresh}
              disabled={loadingTree}
            />
            <IconButton
              icon="logout"
              label={strings.login.logout}
              onClick={() => void onLogout()}
            />
          </>
        ) : null
      }
      toolbar={
        authenticated && tree.tree ? <SearchBox value={query} onChange={setQuery} /> : undefined
      }
    >
      {authenticated ? (
        <PullToRefresh onRefresh={refresh} refreshing={loadingTree && tree.tree !== undefined}>
          {session ? (
            <p className="muted signed-in-as">
              {session.username
                ? strings.login.signedInAs(session.username)
                : strings.login.anonymous}
            </p>
          ) : null}
          {tree.error && !loadingTree ? (
            <ErrorBanner error={tree.error}>
              <button type="button" className="btn btn-small" onClick={refresh}>
                {strings.common.retry}
              </button>
            </ErrorBanner>
          ) : null}
          {tree.tree ? (
            <ConnectionBrowser
              tree={tree.tree}
              query={query}
              favourites={favourites}
              recents={recents}
              onConnect={onConnect}
              onToggleFavourite={onToggleFavourite}
            />
          ) : loadingTree ? (
            <Spinner label={strings.common.loading} />
          ) : null}
        </PullToRefresh>
      ) : flow.phase === 'form' || (flow.phase === 'signing-in' && !flow.silent) ? (
        <LoginForm
          serverName={title}
          state={flow}
          rememberHint={rememberHint}
          onSubmit={(values) => dispatch({ type: 'submit', values })}
          onStartOver={() => dispatch({ type: 'start-over' })}
        />
      ) : isBusy(flow) ? (
        <Spinner label={strings.login.restoring} />
      ) : null}
      {flow.phase === 'confirm-http' ? (
        <HttpWarningDialog
          host={hostOf(profile.baseUrl)}
          onCancel={() => dispatch({ type: 'http-cancel' })}
          onProceed={(dontShowAgain) => {
            if (dontShowAgain) void services.settings.setHttpWarningDismissed(profile.id, true);
            dispatch({ type: 'http-confirm' });
          }}
        />
      ) : null}
    </Screen>
  );
}
