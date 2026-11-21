import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { isGuacApiError, type GuacErrorInfo } from '../../core/api/errors.ts';
import { FieldType, type FieldDescriptor } from '../../core/models/ApiErrorBody.ts';
import { keepUnavailable, quietMerge, type ConnectionTree } from '../../core/models/Connection.ts';
import type { ServerProfile } from '../../core/models/ServerProfile.ts';
import {
  findDuoRedirect,
  findSsoRedirect,
  type SsoKind,
  type SsoRedirect,
} from '../../core/sso/sso.ts';
import { serializeTotp, totpFromEnrolmentField, type TotpParams } from '../../core/totp/totp.ts';
import { AdminProvider } from '../admin/AdminProvider.tsx';
import { AdminAddButton, AdminNotice } from '../admin/EntryPoints.tsx';
import type { TranslationTable } from '../admin/labels.ts';
import { loadTranslations } from '../admin/translations.ts';
import { authFlowReducer, initialAuthFlow, isBusy } from '../auth/authFlow.ts';
import { HttpWarningDialog } from '../auth/HttpWarningDialog.tsx';
import { LoginForm } from '../auth/LoginForm.tsx';
import { runSso, ssoAvailable } from '../auth/ssoFlow.ts';
import { ErrorBanner, InfoBanner, Spinner } from '../components/Feedback.tsx';
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
  type ServerOptions,
} from '../settings/settingsModel.ts';
import { patchServerOptions, subscribeServerOptions } from '../servers/serverOptionsStore.ts';
import { strings } from '../strings.ts';
import { ConnectionsPanel } from './ConnectionsPanel.tsx';
import { DemoConnections } from './DemoConnections.tsx';
import { SearchBox } from './SearchBox.tsx';
import { SortMenu } from './SortMenu.tsx';
import { EmptyState } from '../components/Feedback.tsx';
import { CertificatePanel } from '../tls/CertificatePanel.tsx';
import { useLaunch } from '../launch/LaunchContext.ts';

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

/**
 * Once one data source has answered, how long the list waits for the others before it shows
 * (the late ones are named in a notice with Retry).
 */
const SECONDARY_GRACE_MS = 4000;

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
  const launch = useLaunch();
  const { settings: app } = useAppSettings();
  const { auth } = services;
  const browser = !services.native;
  const [flow, dispatch] = useReducer(authFlowReducer, undefined, initialAuthFlow);
  const [tree, setTree] = useState<TreeState>({ nonce: 0 });
  const [treeNonce, setTreeNonce] = useState(1);
  /** Bumped for a quiet tree reload (no spinner): after a session, or for a late data source. */
  const [quietNonce, setQuietNonce] = useState(0);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<ServerOptions>(DEFAULT_SERVER_OPTIONS);
  // Sign-in providers: a REDIRECT field (the SSO extension decides the sign-in) or the
  // links of the server's login page (`api/patches`), one entry per kind.
  const [sso, setSso] = useState<readonly SsoRedirect[]>([]);
  const [ssoBusy, setSsoBusy] = useState(false);
  const [ssoError, setSsoError] = useState<string | undefined>(undefined);
  const [duoBusy, setDuoBusy] = useState(false);
  const [duoError, setDuoError] = useState<string | undefined>(undefined);
  const [serverTable, setServerTable] = useState<TranslationTable | null | undefined>(undefined);
  const [lockedOut, setLockedOut] = useState(false);
  const [biometry, setBiometry] = useState<BiometryAvailability | undefined>(undefined);
  useEffect(() => {
    void services.lock.availability().then(setBiometry);
  }, [services.lock]);
  const [totpSeed, setTotpSeed] = useState<TotpParams | undefined>(undefined);
  const enrolment = useRef<Readonly<Record<string, unknown>> | undefined>(undefined);
  const title = profile.name || hostOf(profile.baseUrl);
  const insecure = isInsecureUrl(profile.baseUrl);

  const saveOptions = useCallback(
    (patch: Partial<ServerOptions>) => {
      setOptions((prev) => {
        const next = { ...prev, ...patch };
        if (JSON.stringify(next) !== JSON.stringify(prev)) {
          // Only these fields: the server screen may be changing the others meanwhile.
          void patchServerOptions(services.profiles, profile.id, patch).catch(() => undefined);
        }
        return next;
      });
    },
    [services.profiles, profile.id],
  );
  // Changes made on the server screen (wide layout: both are shown at once).
  useEffect(
    () =>
      subscribeServerOptions((id, stored) => {
        if (id === profile.id) setOptions(stored);
      }),
    [profile.id],
  );

  /** Remembers what the server asked for (hints on the server screen) and offers SSO. */
  const noteExpected = useCallback(
    (expected: readonly FieldDescriptor[]) => {
      // Duo's `duo_code` field is a second step, not a sign-in provider (findSsoRedirect
      // skips it); the extra step shows it.
      const redirect = findSsoRedirect(expected);
      if (redirect) {
        setSso((prev) => [redirect, ...prev.filter((r) => r.kind !== redirect.kind)]);
        saveOptions({ seenSso: true });
      }
      if (expected.some((f) => f.type === FieldType.GUAC_TOTP_CODE))
        saveOptions({ seenTotp: true });
    },
    [saveOptions],
  );

  // Signed out after the background time ("Sign out of servers after …"): start over, so
  // the form asks for the password (the saved one is held back until a sign-in).
  const [startNonce, setStartNonce] = useState(0);
  useEffect(
    () =>
      auth.onBackgroundSignOut((id) => {
        if (id !== profile.id) return;
        setTree({ nonce: 0 });
        setTreeNonce((n) => n + 1);
        setStartNonce((n) => n + 1);
      }),
    [auth, profile.id],
  );

  // Signed out by something else while this list stays mounted (the lock screen's reset,
  // Settings › Sign out of all servers): show the sign-in form, not a list with no session.
  // A session that is gone while a password is still saved is being renewed (a session's
  // reconnect, the background sign-out): left to those, as before.
  /** This screen ends the session itself (expired token, Sign out): not "elsewhere". */
  const signingOutHere = useRef(false);
  useEffect(
    () =>
      auth.onSessionChange((id) => {
        if (id !== profile.id || signingOutHere.current || auth.current(id)) return;
        if (services.devServer?.profile.id === id) return;
        void auth.hasSavedPassword(profile).then((saved) => {
          if (saved || auth.current(id)) return;
          setTree({ nonce: 0 });
          setTreeNonce((n) => n + 1);
          dispatch({ type: 'signed-out-elsewhere' });
        });
      }),
    [auth, profile, services.devServer],
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
        ...(secrets.signedOutInBackground ? { notice: strings.login.signedOutInBackground } : {}),
        ...(secrets.newCertificate ? { notice: strings.login.newCertificatePassword } : {}),
      });
    })();
    return () => {
      live = false;
    };
    // Run once per profile (and again after a background sign-out); later profile edits
    // remount this component (keyed by id).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startNonce]);

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
              // The server's digits, period and algorithm, not SHA1/6/30 (AUDIT #4).
              await auth.saveTotpSeed(profile.id, serializeTotp(totpFromEnrolmentField(key)));
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
  const ssoKnown = sso.length > 0;
  useEffect(() => {
    if (!onCredentialsForm || ssoKnown) return undefined;
    let live = true;
    void services.api.loginWithParameters(profile, {}).then(
      // Anonymous access is allowed: do not keep a session the user did not ask for.
      (s) => void services.api.logout(s).catch(() => undefined),
      (err: unknown) => {
        if (live && isGuacApiError(err)) noteExpected(expectedOf(err.info));
      },
    );
    // With a database or LDAP back end first, the SSO extension sends no REDIRECT field;
    // the web client then lists it from the login page's patches (verified on 1.6.0).
    void services.api.getSsoProviders(profile).then((found) => {
      if (!live || found.length === 0) return;
      setSso((prev) => [...prev, ...found.filter((f) => !prev.some((p) => p.kind === f.kind))]);
      saveOptions({ seenSso: true });
    });
    return () => {
      live = false;
    };
  }, [onCredentialsForm, ssoKnown, services.api, profile, noteExpected, saveOptions]);

  // The server's own texts (prompt of an extra step, policy errors) in the UI language.
  const wantsServerText =
    flow.phase === 'form' && (flow.step === 'extra' || flow.serverError !== undefined);
  useEffect(() => {
    if (!wantsServerText || serverTable !== undefined) return undefined;
    let live = true;
    void loadTranslations(services.admin, profile.baseUrl).then((t) => {
      if (live) setServerTable(t);
    });
    return () => {
      live = false;
    };
  }, [wantsServerText, serverTable, services.admin, profile.baseUrl]);

  // "Change password" elsewhere in the app: the in-memory copy for silent re-login follows.
  useEffect(
    () =>
      auth.onPasswordChange((id, password) => {
        if (id === profile.id) dispatch({ type: 'password-changed', password });
      }),
    [auth, profile.id],
  );

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

  const startSso = async (kind: SsoKind) => {
    setSsoError(undefined);
    setSsoBusy(true);
    try {
      let redirect = sso.find((r) => r.kind === kind);
      // A REDIRECT field's URL carries a nonce that expires and works once: ask again.
      // (`api/ext/<x>/login` links make a fresh one on every visit.)
      if (redirect && !redirect.redirectUrl.includes('/api/ext/')) {
        try {
          await services.api.loginWithParameters(profile, {});
        } catch (err) {
          if (isGuacApiError(err)) {
            const fresh = findSsoRedirect(expectedOf(err.info));
            if (fresh?.kind === kind) redirect = fresh;
          }
        }
      }
      if (!redirect) return;
      const outcome = await runSso(redirect, profile.baseUrl, options.ssoMode, services.log);
      if (!outcome.ok) {
        if (outcome.reason !== 'cancelled') setSsoError(strings.login.sso.unavailable);
        else setSsoError(strings.login.sso.cancelled);
        return;
      }
      try {
        await auth.loginWithParameters(profile, outcome.values);
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

  /**
   * Duo (guacamole-auth-duo 1.6.0): open the Duo page from the server's `duo_code` field,
   * then send `duo_code` and `state` with the username and password as the next attempt.
   * The server resumes the deferred first factor from `state`
   * (`DuoAuthenticationProvider.updateCredentials`); if `state` was already used or expired,
   * the resent username and password start a fresh Duo check instead of failing.
   */
  const duoRedirect =
    flow.phase === 'form' && flow.step === 'extra' ? findDuoRedirect(flow.expected) : undefined;
  const startDuo = async () => {
    if (!duoRedirect) return;
    setDuoError(undefined);
    setDuoBusy(true);
    try {
      const outcome = await runSso(duoRedirect, profile.baseUrl, 'webview', services.log);
      if (!outcome.ok) {
        setDuoError(
          outcome.reason === 'cancelled'
            ? strings.login.duo.cancelled
            : strings.login.duo.unavailable,
        );
        return;
      }
      dispatch({ type: 'submit', values: { extra: outcome.values } });
    } finally {
      setDuoBusy(false);
    }
  };

  // Load the tree when authenticated (and on refresh).
  useEffect(() => {
    if (!authenticated) return undefined;
    const session = auth.current(profile.id);
    // No session for now (a session's reconnect is signing in again, or it was signed out
    // elsewhere, handled below): load once one is back instead of spinning forever.
    if (!session)
      return auth.onSessionChange((id) => {
        if (id === profile.id && auth.current(id)) setTreeNonce((n) => n + 1);
      });
    let live = true;
    const nonce = treeNonce;
    services.api.getConnectionTree(session, { secondaryGraceMs: SECONDARY_GRACE_MS }).then(
      (result) => {
        if (!live) return;
        setTree((t) => ({ nonce, tree: keepUnavailable(t.tree, result) }));
        // A data source that was only slow: one quiet reload picks it up (the coordinator
        // shares the request still in flight) and clears the notice when it arrives.
        if (result.unavailable && result.unavailable.length > 0) setQuietNonce((n) => n + 1);
      },
      (err: unknown) => {
        if (!live) return;
        if (isGuacApiError(err, 'session-expired')) {
          setTree({ nonce });
          setTreeNonce((n) => n + 1);
          // This screen handles it (silent sign-in again with a saved password), not the
          // "signed out elsewhere" listener.
          signingOutHere.current = true;
          void auth.forgetToken(profile.id).then(() => {
            signingOutHere.current = false;
            dispatch({ type: 'session-expired' });
          });
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

  // MUL-5: back from a session (or one closed): reload the tree quietly, so the "In use"
  // badges follow what the server now reports. Shortly after, so a just-closed tunnel is
  // gone on the server. No spinner, and a failure keeps the list as it was.
  const shownId = sessions.state.activeId;
  const openCount = sessions.state.sessions.length;
  const firstSessionsChange = useRef(true);
  useEffect(() => {
    if (firstSessionsChange.current) {
      firstSessionsChange.current = false;
      return undefined;
    }
    if (shownId !== null) return undefined;
    const timer = setTimeout(() => setQuietNonce((n) => n + 1), 1500);
    return () => clearTimeout(timer);
  }, [shownId, openCount]);
  useEffect(() => {
    if (quietNonce === 0 || !authenticated) return undefined;
    const session = auth.current(profile.id);
    if (!session) return undefined;
    let live = true;
    const nonce = treeNonce;
    // Quiet: nobody waits on it, so it waits for every data source.
    services.api.getConnectionTree(session).then(
      (result) => {
        if (live)
          setTree((t) =>
            t.nonce === nonce && t.tree ? { ...t, tree: quietMerge(t.tree, result) } : t,
          );
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
    // Only on `quietNonce`: a loud refresh (`treeNonce`) loads the tree itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quietNonce]);

  const onLogout = async () => {
    sessions.closeServer(profile.id);
    signingOutHere.current = true;
    try {
      await auth.logout(profile.id);
    } finally {
      signingOutHere.current = false;
    }
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

  // Leaving before the tree loaded drops a connection waiting to open here (Jump back in,
  // an app link): it must not open by itself at a later visit. Not on unmount: opening the
  // same server again replaces this screen right after the request.
  const onBack = () => {
    if (launch.peek()?.serverId === profile.id) launch.take(profile.id);
    nav.back();
  };

  const screen = (
    <Screen
      title={title}
      onBack={onBack}
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
              {tree.error.code === 'tls' ? (
                <CertificatePanel url={profile.baseUrl} onTrusted={refresh} />
              ) : null}
            </ErrorBanner>
          ) : null}
          {tree.tree?.unavailable && tree.tree.unavailable.length > 0 && !loadingTree ? (
            <InfoBanner tone="warning">
              <p>{strings.connections.partialLoad(tree.tree.unavailable.join(', '))}</p>
              <button type="button" className="btn btn-small" onClick={refresh}>
                {strings.common.retry}
              </button>
            </InfoBanner>
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
            sso.length > 0
              ? {
                  kinds: sso.map((r) => r.kind),
                  available: ssoAvailable(),
                  busy: ssoBusy,
                  error: ssoError,
                  onStart: (kind) => void startSso(kind),
                }
              : undefined
          }
          duo={
            duoRedirect
              ? {
                  available: ssoAvailable(),
                  busy: duoBusy,
                  error: duoError,
                  onStart: () => void startDuo(),
                }
              : undefined
          }
          serverTable={serverTable}
          totp={
            totpSeed && options.totpAutofill && seedsAllowed
              ? {
                  seed: totpSeed,
                  lastCounter: auth.lastTotpCounterFor(profile.id),
                  onSent: (period) => auth.noteTotpUsed(profile.id, period),
                }
              : undefined
          }
          onEnrollSecret={
            canStoreSeed ? (_secret, field) => (enrolment.current = field.extra) : undefined
          }
        />
      ) : isBusy(flow) ? (
        <Spinner label={strings.login.restoring} />
      ) : null}
      {/* SRV-8: offer to trust a self-signed certificate, or show that it changed. */}
      {!authenticated && flow.phase === 'form' && flow.error?.code === 'tls' ? (
        <CertificatePanel url={profile.baseUrl} />
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
    <AdminProvider session={session} tree={tree.tree} reloadKey={treeNonce} onChanged={refresh}>
      {screen}
    </AdminProvider>
  );
}
