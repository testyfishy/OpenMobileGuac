import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { isGuacApiError, type GuacErrorInfo } from '../../core/api/errors.ts';
import { FieldType, type FieldDescriptor } from '../../core/models/ApiErrorBody.ts';
import type { ConnectionTree } from '../../core/models/Connection.ts';
import type { ServerProfile } from '../../core/models/ServerProfile.ts';
import { findSsoRedirect, type SsoRedirect } from '../../core/sso/sso.ts';
import { parseTotpInput, serializeTotp, type TotpParams } from '../../core/totp/totp.ts';
import { AdminProvider } from '../admin/AdminProvider.tsx';
import { AdminAddButton, AdminNotice } from '../admin/EntryPoints.tsx';
import { authFlowReducer, initialAuthFlow, isBusy } from '../auth/authFlow.ts';
import { HttpWarningDialog } from '../auth/HttpWarningDialog.tsx';
import { LoginForm } from '../auth/LoginForm.tsx';
import { runSso, ssoAvailable } from '../auth/ssoFlow.ts';
import { ErrorBanner, Spinner } from '../components/Feedback.tsx';
import { IconButton, Screen } from '../components/Screen.tsx';
import { PullToRefresh } from '../components/PullToRefresh.tsx';
import { describeError, type UiError } from '../errors/errorMessages.ts';
import { useNav } from '../nav/NavContext.ts';
import { useAppSettings, useServices } from '../services/context.ts';
import { haptic } from '../services/native.ts';
import { hostOf, isInsecureUrl } from '../servers/serverForm.ts';
import { useServerProfile } from '../servers/useServers.ts';
import { isShareServerId } from '../services/shareSessions.ts';
import { useSessions } from '../sessions/SessionsContext.ts';
import { seedPolicy } from '../servers/seedPolicy.ts';
import type { BiometryAvailability } from '../services/native.ts';
import {
  DEFAULT_SERVER_OPTIONS,
  parseServerOptions,
  serverOptionsToJson,
  type ServerOptions,
} from '../settings/settingsModel.ts';
import { strings } from '../strings.ts';
import { ConnectionsPanel } from './ConnectionsPanel.tsx';
import { DemoConnections } from './DemoConnections.tsx';
import { SearchBox } from './SearchBox.tsx';
import { SortMenu } from './SortMenu.tsx';
import { EmptyState } from '../components/Feedback.tsx';

export function ConnectionsScreen({ serverId }: { serverId: string }) {
  const nav = useNav();
  const services = useServices();
  const lookup = useServerProfile(serverId);
  const [, setAuthVersion] = useState(0);
  useEffect(
    () =>
      isShareServerId(serverId)
        ? services.auth.onSessionChange((id) => {
            if (id === serverId) setAuthVersion((v) => v + 1);
          })
        : undefined,
    [services.auth, serverId],
  );
  if (lookup.status === 'demo') return <DemoConnections />;
  // A share-link session (CON-6) cannot sign in again by itself: the link must be reopened.
  const shareEnded = isShareServerId(serverId) && !services.auth.current(serverId);
  if (lookup.status === 'ready' && !shareEnded)
    return <ServerConnections key={lookup.profile.id} profile={lookup.profile} />;
  return (
    <Screen title={strings.connections.title} onBack={nav.back}>
      {lookup.status === 'loading' ? (
        <Spinner label={strings.common.loading} />
      ) : shareEnded ? (
        <EmptyState icon="link" title={strings.shareLink.ended} />
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

function expectedOf(info: GuacErrorInfo): readonly FieldDescriptor[] {
  if (info.kind === 'additional-credentials-required') return info.expected;
  if (info.kind === 'invalid-credentials') return info.expected ?? [];
  return [];
}

/** Sign-in plus the connection browser for one real server. */
function ServerConnections({ profile }: { profile: ServerProfile }) {
  const nav = useNav();
  const services = useServices();
  const sessions = useSessions();
  const { settings: app } = useAppSettings();
  const { auth } = services;
  const browser = !services.native;
  const [flow, dispatch] = useReducer(authFlowReducer, undefined, initialAuthFlow);
  const [tree, setTree] = useState<TreeState>({ nonce: 0 });
  const [treeNonce, setTreeNonce] = useState(1);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<ServerOptions>(DEFAULT_SERVER_OPTIONS);
  const [sso, setSso] = useState<SsoRedirect | undefined>(undefined);
  const [ssoBusy, setSsoBusy] = useState(false);
  const [ssoError, setSsoError] = useState<string | undefined>(undefined);
  const [lockedOut, setLockedOut] = useState(false);
  const [biometry, setBiometry] = useState<BiometryAvailability | undefined>(undefined);
  useEffect(() => {
    void services.lock.availability().then(setBiometry);
  }, [services.lock]);
  const [totpSeed, setTotpSeed] = useState<TotpParams | undefined>(undefined);
  const enrolment = useRef<string | undefined>(undefined);
  const title = profile.name || hostOf(profile.baseUrl);
  const insecure = isInsecureUrl(profile.baseUrl);

  const saveOptions = useCallback(
    (patch: Partial<ServerOptions>) => {
      setOptions((prev) => {
        const next = { ...prev, ...patch };
        if (JSON.stringify(next) !== JSON.stringify(prev)) {
          void services.profiles
            .setOptions(profile.id, serverOptionsToJson(next))
            .catch(() => undefined);
        }
        return next;
      });
    },
    [services.profiles, profile.id],
  );

  /** Remembers what the server asked for (hints on the server screen) and offers SSO. */
  const noteExpected = useCallback(
    (expected: readonly FieldDescriptor[]) => {
      const redirect = findSsoRedirect(expected);
      if (redirect) {
        setSso(redirect);
        saveOptions({ seenSso: true });
      }
      if (expected.some((f) => f.type === FieldType.GUAC_TOTP_CODE))
        saveOptions({ seenTotp: true });
    },
    [saveOptions],
  );

  // Start: stored token → saved password → form.
  useEffect(() => {
    let live = true;
    void (async () => {
      const opts = parseServerOptions(
        await services.profiles.getOptions(profile.id).catch(() => undefined),
      );
      if (live) setOptions(opts);
      const [secrets, dismissed] = await Promise.all([
        auth.loadSecrets(profile),
        services.settings.isHttpWarningDismissed(profile.id),
      ]);
      if (!live) return;
      setLockedOut(secrets.lockedOut === true);
      dispatch({
        type: 'start',
        hasToken: secrets.token !== null,
        username: profile.username,
        savedPassword: secrets.password,
        remember: profile.rememberPassword,
        needsHttpConfirm: insecure && !dismissed && !auth.isHttpConfirmed(profile.id),
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
        const token = await auth.loadToken(profile.id);
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
      if (insecure) auth.markHttpConfirmed(profile.id);
      void (async () => {
        try {
          await auth.login(profile, values);
          // Save an enrolment key the user chose to keep, once sign-in succeeded.
          const key = enrolment.current;
          enrolment.current = undefined;
          if (key) {
            try {
              await auth.saveTotpSeed(profile.id, serializeTotp(parseTotpInput(key)));
              saveOptions({ totpAutofill: true });
            } catch {
              // Not a key we can parse; nothing stored.
            }
          }
          dispatch({ type: 'login-ok', seq });
        } catch (err) {
          if (isGuacApiError(err)) {
            noteExpected(expectedOf(err.info));
            dispatch({ type: 'login-failed', seq, error: err.info, browser });
          } else
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

  // SSO detection: like the web client, ask the server what it expects with no
  // credentials. An SSO extension answers with a REDIRECT field.
  const onCredentialsForm = flow.phase === 'form' && flow.step === 'credentials';
  useEffect(() => {
    if (!onCredentialsForm || sso) return undefined;
    let live = true;
    void services.api.loginWithParameters(profile, {}).then(
      // Anonymous access is allowed: do not keep a session the user did not ask for.
      (s) => void services.api.logout(s).catch(() => undefined),
      (err: unknown) => {
        if (live && isGuacApiError(err)) noteExpected(expectedOf(err.info));
      },
    );
    return () => {
      live = false;
    };
  }, [onCredentialsForm, sso, services.api, profile, noteExpected]);

  // SRV-9: stored seed for the TOTP step (behind the biometric gate).
  const seedsAllowed = seedPolicy(services.secretStorage, biometry, app.lock.enabled) === 'allowed';
  const needsTotp =
    flow.phase === 'form' &&
    flow.step === 'extra' &&
    flow.expected.some((f) => f.type === FieldType.GUAC_TOTP_CODE);
  useEffect(() => {
    if (!needsTotp || !options.totpAutofill || !seedsAllowed || totpSeed) return undefined;
    let live = true;
    void auth.loadTotpSeed(profile.id).then((seed) => {
      if (live && seed) setTotpSeed(seed);
    });
    return () => {
      live = false;
    };
  }, [needsTotp, options.totpAutofill, seedsAllowed, totpSeed, auth, profile.id]);

  const authenticated = phase === 'authenticated';

  const startSso = async () => {
    setSsoError(undefined);
    setSsoBusy(true);
    try {
      // A fresh redirect: OpenID nonces expire and are single-use.
      let redirect = sso;
      try {
        await services.api.loginWithParameters(profile, {});
      } catch (err) {
        if (isGuacApiError(err)) redirect = findSsoRedirect(expectedOf(err.info)) ?? redirect;
      }
      if (!redirect) return;
      const outcome = await runSso(redirect, profile.baseUrl, options.ssoMode, services.log);
      if (!outcome.ok) {
        if (outcome.reason !== 'cancelled') setSsoError(strings.login.sso.unavailable);
        else setSsoError(strings.login.sso.cancelled);
        return;
      }
      try {
        await auth.loginWithParameters(profile, { [redirect.paramName]: outcome.value });
        haptic('success');
        dispatch({ type: 'external-ok' });
      } catch (err) {
        haptic('error');
        setSsoError(
          isGuacApiError(err, 'invalid-credentials')
            ? strings.login.sso.race
            : strings.login.sso.failed,
        );
      }
    } finally {
      setSsoBusy(false);
    }
  };

  // Load the tree when authenticated (and on refresh).
  useEffect(() => {
    if (!authenticated) return undefined;
    const session = auth.current(profile.id);
    if (!session) return undefined;
    let live = true;
    const nonce = treeNonce;
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
  }, [authenticated, treeNonce, auth, profile.id, services.api, browser]);

  const refresh = () => setTreeNonce((n) => n + 1);

  const onLogout = async () => {
    sessions.closeServer(profile.id);
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
  const canStoreSeed = seedsAllowed;

  const screen = (
    <Screen
      title={title}
      onBack={nav.back}
      actions={
        authenticated ? (
          <>
            <AdminAddButton />
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
        authenticated && tree.tree ? (
          <div className="toolbar-row">
            <SearchBox value={query} onChange={setQuery} />
            <SortMenu />
          </div>
        ) : undefined
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
          <AdminNotice />
          {tree.error && !loadingTree ? (
            <ErrorBanner error={tree.error}>
              <button type="button" className="btn btn-small" onClick={refresh}>
                {strings.common.retry}
              </button>
            </ErrorBanner>
          ) : null}
          {tree.tree ? (
            <ConnectionsPanel
              serverId={profile.id}
              serverName={title}
              tree={tree.tree}
              query={query}
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
          notice={lockedOut ? strings.login.lockedOut : undefined}
          onSubmit={(values) => dispatch({ type: 'submit', values })}
          onStartOver={() => dispatch({ type: 'start-over' })}
          sso={
            sso
              ? {
                  kind: sso.kind,
                  available: ssoAvailable(),
                  busy: ssoBusy,
                  error: ssoError,
                  onStart: () => void startSso(),
                }
              : undefined
          }
          totp={
            totpSeed && options.totpAutofill && seedsAllowed
              ? {
                  seed: totpSeed,
                  lastCounter: auth.lastTotpCounterFor(profile.id),
                  onSent: (period) => auth.noteTotpUsed(profile.id, period),
                }
              : undefined
          }
          onEnrollSecret={canStoreSeed ? (secret) => (enrolment.current = secret) : undefined}
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
            auth.markHttpConfirmed(profile.id);
            dispatch({ type: 'http-confirm' });
          }}
        />
      ) : null}
    </Screen>
  );
  // Connection management (ui/admin): offered only where the account has the permissions.
  return (
    <AdminProvider session={session} tree={tree.tree} onChanged={refresh}>
      {screen}
    </AdminProvider>
  );
}
