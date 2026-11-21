import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TunnelTargetTypes } from '../../core/api/tunnel.ts';
import { TOKEN_HEADER } from '../../core/api/GuacApi.ts';
import { streamDownloadUrl } from '../../session/transfer/savedFiles.ts';
import { rememberUnlockOn } from '../../session/credentials/rememberedParams.ts';
import type { ConnectionRef } from '../../core/storage/ProfileStore.ts';
import type { TunnelLike } from '../../core/transport/TunnelLike.ts';
import { Dialog } from '../components/Dialog.tsx';
import { Spinner } from '../components/Feedback.tsx';
import { DEMO_AUTH_SESSION, DEMO_PROFILE_ID, DemoTunnel } from '../integration/demo.ts';
import {
  DEFAULT_SESSION_SETTINGS,
  SessionScreen,
  type SessionLogEntry,
  type SessionSettings,
} from '../integration/session.ts';
import { useBackInterceptor, useNav } from '../nav/NavContext.ts';
import { mayEditConnection, requestConnectionEdit } from '../admin/adminBridge.ts';
import { useAppSettings, useServices } from '../services/context.ts';
import { copyText, haptic, saveTextFile, shareText } from '../services/native.ts';
import { isShareServerId } from '../services/shareSessions.ts';
import type { SessionSharing } from '../session/ShareSheet.tsx';
import type { StreamRequest } from '../session/fileSave.ts';
import type { OpenSession } from '../sessions/sessionModel.ts';
import {
  applyConnectionPatch,
  mergeSessionSettings,
  overriddenKeys,
  parseServerOptions,
  removeConnectionKeys,
  type SessionSettingsPatch,
  type AppSettings,
} from '../settings/settingsModel.ts';
import {
  affectsConnection,
  publishSettingsChange,
  subscribeSettingsChanges,
} from '../settings/connectionSettingsBus.ts';
import { sessionStrings } from '../session/sessionStrings.ts';
import { strings } from '../strings.ts';
import { sessionTransportFor } from '../tls/nativeTunnel.ts';
import { deviceTimezone, makeConnectDataBuilder } from './connectData.ts';
import { installKeepAwake } from './keepAwake.ts';
import { currentMediaSupport } from './mediaSupport.ts';

export interface SessionHostProps {
  readonly session: OpenSession;
  /** Shown full screen (false: mounted but hidden behind the app chrome). */
  readonly active: boolean;
  /** Back to the connection list, keeping the session open. */
  readonly onHide: () => void;
  /** Disconnected / closed by the user. */
  readonly onExit: () => void;
  /** The server no longer has a valid sign-in for this session. */
  readonly onNeedsSignIn: () => void;
  /** The tunnel refused the sign-in during the session (expired token). */
  readonly onSignInExpired: () => void;
}

installKeepAwake();

/**
 * Launches `SessionScreen` for one open session: a fresh tunnel per (re)connect, the
 * connect string with the current token, and per-connection settings layered as
 * defaults ← app-wide ← server ← connection (SET-1). Demo connections use the in-app
 * `DemoTunnel` and never touch the network. Loaded lazily (code split) by `SessionLayer`.
 */
export default function SessionHost({
  session,
  active,
  onHide,
  onExit,
  onNeedsSignIn,
  onSignInExpired,
}: SessionHostProps) {
  const services = useServices();
  const { settings: app, update: updateApp } = useAppSettings();
  const appRef = useRef(app);
  useEffect(() => {
    appRef.current = app;
  });
  // KEY-9: key sets and saved combos are app-wide; edits in the session update the app settings.
  const onKeyLibraryChange = useCallback(
    (keys: AppSettings['keys']) => {
      const next = { ...appRef.current, keys };
      appRef.current = next;
      updateApp(next);
    },
    [updateApp],
  );
  const { serverId, target } = session;
  const isDemo = serverId === DEMO_PROFILE_ID;
  const joined = target.join !== undefined;
  const ref: ConnectionRef = useMemo(
    () => ({ dataSource: target.dataSource, identifier: target.identifier, type: target.type }),
    [target.dataSource, target.identifier, target.type],
  );
  const [stored, setStored] = useState<SessionSettingsPatch | undefined>(undefined);
  const [serverLayer, setServerLayer] = useState<SessionSettingsPatch>({});
  const [confirmExit, setConfirmExit] = useState(false);
  // Bumped when the stored settings were changed elsewhere (Settings › Connections): the
  // session screen then drops its in-session overlay and follows the new values.
  const [revision, setRevision] = useState(0);
  const [reloads, setReloads] = useState(0);
  const origin = `session-${session.id}`;

  useEffect(() => {
    let live = true;
    void Promise.all([
      services.profiles.getConnectionSettings(serverId, ref).catch(() => undefined),
      services.profiles.getOptions(serverId).catch(() => undefined),
    ]).then(([s, o]) => {
      if (!live) return;
      setServerLayer(parseServerOptions(o).sessionDefaults);
      setStored(applyConnectionPatch(s, {}));
      if (reloads > 0) setRevision((r) => r + 1);
    });
    return () => {
      live = false;
    };
  }, [services.profiles, serverId, ref, reloads]);

  // Live: edits made in Settings to this connection (or its server's defaults) apply here
  // without remounting the session.
  useEffect(
    () =>
      subscribeSettingsChanges(origin, (c) => {
        if (affectsConnection(c, serverId, ref)) setReloads((n) => n + 1);
      }),
    [origin, serverId, ref],
  );

  const save = useCallback(
    (next: SessionSettingsPatch) => {
      // A joined session is someone else's: changes apply to it only, nothing is stored.
      if (joined) return;
      void services.profiles
        .setConnectionSettings(serverId, ref, next)
        .then(() => publishSettingsChange(serverId, ref, origin))
        .catch(() => undefined);
    },
    [services.profiles, serverId, ref, joined, origin],
  );

  // First pointer mode change in any session: "Saved for this connection" once (SET-1).
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const noticePending = !joined && !isShareServerId(serverId) && !app.perConnectionNoticeSeen;

  const settings: SessionSettings = useMemo(
    () => mergeSessionSettings(DEFAULT_SESSION_SETTINGS, app.sessionDefaults, stored, serverLayer),
    [app.sessionDefaults, stored, serverLayer],
  );
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  });

  const storedRef = useRef(stored);
  useEffect(() => {
    storedRef.current = stored;
  });
  const onSettingsChange = useCallback(
    (patch: Partial<SessionSettings>) => {
      const prev = storedRef.current;
      const next = applyConnectionPatch(prev, patch);
      storedRef.current = next;
      setStored(next);
      save(next);
      if (
        noticePending &&
        patch.pointerMode !== undefined &&
        patch.pointerMode !== settingsRef.current.pointerMode
      ) {
        setNotice(sessionStrings.toasts.perConnection);
        const cur = appRef.current;
        if (!cur.perConnectionNoticeSeen) {
          const seen = { ...cur, perConnectionNoticeSeen: true };
          appRef.current = seen;
          updateApp(seen);
        }
      }
    },
    [save, noticePending, updateApp],
  );

  const onUseDefault = useCallback(
    (keys: string[]) => {
      const next = removeConnectionKeys(storedRef.current, keys);
      storedRef.current = next;
      setStored(next);
      save(next);
    },
    [save],
  );
  const overridden = useMemo(() => overriddenKeys(stored), [stored]);

  const createTunnel = useCallback((): TunnelLike => {
    if (isDemo) return new DemoTunnel();
    const auth = services.auth.current(serverId);
    if (!auth) throw new Error('Not signed in');
    // SRV-8: the native tunnel for a pinned certificate, else the WebView WebSocket.
    return sessionTransportFor(services.tls).createTunnel(auth);
  }, [isDemo, services.auth, services.tls, serverId]);

  // AUDIT #3: no (re)connect sends the stored token while the app lock is up.
  const connectGate = useCallback(
    () => (!isDemo && services.lock.isLocked() ? services.lock.whenUnlocked() : null),
    [isDemo, services.lock],
  );

  const buildConnectData = useMemo(
    () =>
      makeConnectDataBuilder({
        getToken: () =>
          isDemo ? DEMO_AUTH_SESSION.token : (services.auth.current(serverId)?.token ?? ''),
        dataSource: target.dataSource,
        // Admin "Join": the active connection (`GUAC_TYPE=a`, as the web client's session
        // list links `ClientIdentifier.Types.ACTIVE_CONNECTION` with the active id).
        id: target.join ?? target.identifier,
        type:
          target.join !== undefined
            ? TunnelTargetTypes.ACTIVE_CONNECTION
            : target.type === 'g'
              ? TunnelTargetTypes.CONNECTION_GROUP
              : TunnelTargetTypes.CONNECTION,
        timezone: deviceTimezone(),
        media: currentMediaSupport,
      }),
    [
      isDemo,
      services.auth,
      serverId,
      target.dataSource,
      target.identifier,
      target.type,
      target.join,
    ],
  );

  // Checked once per mount (each reconnect remounts). Later sign-in changes are the
  // provider's call: during a silent re-login the token is briefly gone, and a re-render in
  // that window must not tear the session down.
  const [signedIn] = useState(() => isDemo || services.auth.current(serverId) !== undefined);
  // Hardware back in the visible session asks: keep open, disconnect, or cancel.
  useBackInterceptor(active && signedIn && stored !== undefined && !confirmExit, () =>
    setConfirmExit(true),
  );

  const notified = useRef(false);
  useEffect(() => {
    if (signedIn || notified.current) return;
    notified.current = true;
    onNeedsSignIn();
  }, [signedIn, onNeedsSignIn]);

  // Quality helper: "Edit this connection" when the user may edit it (Performance presets).
  const nav = useNav();
  // More › "All settings for this connection": Settings › Connections › this one, over the
  // app chrome; the session stays open and Back there returns to it.
  const openConnectionSettings =
    joined || isShareServerId(serverId)
      ? undefined
      : () => {
          onHide();
          nav.push({
            name: 'layer-settings',
            target: {
              kind: 'connection',
              serverId,
              ref,
              name: target.name,
              protocol: target.protocol,
              sessionId: session.id,
            },
          });
        };
  const token = isDemo ? undefined : services.auth.current(serverId)?.token;
  const editConnection =
    token && target.type === 'c' && mayEditConnection(token, target.dataSource, target.identifier)
      ? () => {
          onHide();
          nav.open({ name: 'connections', serverId });
          // Kept until that server's connection list (AdminProvider) can open the editor.
          requestConnectionEdit(token, target.dataSource, target.identifier);
        }
      : undefined;

  // "Share this session" through the server's sharing profiles (not for the demo or a
  // session opened from a share link, which has no rights to share).
  const sharing = useMemo<SessionSharing | undefined>(() => {
    if (isDemo || isShareServerId(serverId) || joined) return undefined;
    const current = () => {
      const s = services.auth.current(serverId);
      if (!s) throw new Error('Not signed in');
      return s;
    };
    return {
      listProfiles: (uuid) => services.api.getTunnelSharingProfiles(current(), uuid),
      createLink: (uuid, profile) => services.api.createShareLink(current(), uuid, profile),
      share: (link) => shareText(strings.session.shareTitle(target.name), link),
      copy: (link) => copyText(link),
      insecure: (services.auth.current(serverId)?.baseUrl ?? '').startsWith('http:'),
    };
  }, [isDemo, serverId, services.api, services.auth, target.name, joined]);

  // FIL-1: received files come from the web application's stream endpoint (native HTTP),
  // as the web client's `tunnelService.downloadStream` does. Read at call time: the token
  // may have been refreshed since the session opened.
  const streamDownload = useCallback(
    (uuid: string, index: number, filename: string): StreamRequest | null => {
      if (isDemo) return null;
      const auth = services.auth.current(serverId);
      if (!auth) return null;
      return {
        url: streamDownloadUrl(auth.baseUrl, uuid, index, filename),
        headers: { [TOKEN_HEADER]: auth.token },
      };
    },
    [isDemo, services.auth, serverId],
  );

  // SRV-11: remembered answers to the remote computer's own sign-in prompt, bound to this
  // server (profile id and signed-in address) and this connection. Not for the Demo, a
  // joined session or a share link (someone else's connection). The policy is read at each
  // use, so a change in Settings applies to sessions already open. With "Ask for Face ID /
  // fingerprint …" on, a remembered value is released only after the device check, whose
  // prompt names this connection (no check where the device has none: confirmPresence).
  const rememberPolicy = app.rememberConnectionPasswords;
  const confirmAs = rememberUnlockOn(app.rememberConnectionUnlock, rememberPolicy)
    ? target.name
    : undefined;
  const credentialMemory = useMemo(
    () =>
      isDemo || joined || isShareServerId(serverId)
        ? undefined
        : services.connectionSecrets.bind({
            profileId: serverId,
            policy: rememberPolicy,
            server: () => services.auth.current(serverId)?.baseUrl,
            connection: {
              dataSource: target.dataSource,
              type: target.type,
              identifier: target.identifier,
            },
            ...(confirmAs !== undefined ? { confirmAs } : {}),
          }),
    [
      confirmAs,
      isDemo,
      joined,
      serverId,
      services.connectionSecrets,
      services.auth,
      target.dataSource,
      target.type,
      target.identifier,
      rememberPolicy,
    ],
  );

  // CON-4 thumbnails come from the session screen itself (≤ 320 px JPEG).
  // Not for a joined session: that picture is someone else's screen.
  const thumbnailsOn = app.thumbnails && !joined;
  const onThumbnail = useCallback(
    (dataUrl: string) => {
      if (!thumbnailsOn || !dataUrl.startsWith('data:image/')) return;
      void services.profiles
        .setThumbnail(serverId, ref, { dataUrl, at: Date.now() })
        .catch(() => undefined);
    },
    [thumbnailsOn, services.profiles, serverId, ref],
  );
  // DIAG-1: the session's lifecycle log goes to the local diagnostics log.
  const onLog = useCallback(
    (entry: SessionLogEntry) => services.log.log(entry.level, 'session', entry.message),
    [services.log],
  );

  const exit = useCallback(() => {
    haptic('medium');
    onExit();
  }, [onExit]);

  if (!signedIn || stored === undefined) {
    return (
      <div className="session-loading">
        <Spinner label={strings.session.loading} />
      </div>
    );
  }

  return (
    <>
      <SessionScreen
        title={target.name}
        protocol={target.protocol}
        createTunnel={createTunnel}
        buildConnectData={buildConnectData}
        connectGate={connectGate}
        settings={settings}
        onSettingsChange={onSettingsChange}
        overriddenKeys={overridden}
        onUseDefault={onUseDefault}
        settingsRevision={revision}
        {...(notice ? { notice, onDismissNotice: () => setNotice(undefined) } : {})}
        {...(openConnectionSettings ? { onConnectionSettings: openConnectionSettings } : {})}
        onExit={exit}
        isDemo={isDemo}
        active={active}
        onThumbnail={onThumbnail}
        onLog={onLog}
        onMinimize={onHide}
        keyLibrary={app.keys}
        onKeyLibraryChange={onKeyLibraryChange}
        saveTextFile={saveTextFile}
        {...(editConnection ? { onEditConnection: editConnection } : {})}
        {...(sharing ? { sharing } : {})}
        sharedViewer={joined || isShareServerId(serverId)}
        streamDownload={streamDownload}
        {...(credentialMemory ? { credentialMemory } : {})}
        {...(isDemo ? {} : { onSignInExpired })}
      />
      {confirmExit && active ? (
        <Dialog
          title={strings.session.disconnectTitle(target.name)}
          onCancel={() => setConfirmExit(false)}
          actions={
            <>
              <button type="button" className="btn" onClick={() => setConfirmExit(false)}>
                {strings.common.cancel}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  setConfirmExit(false);
                  exit();
                }}
              >
                {strings.session.disconnect}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setConfirmExit(false);
                  onHide();
                }}
              >
                {strings.session.keepOpen}
              </button>
            </>
          }
        >
          <p>{strings.session.disconnectBody}</p>
        </Dialog>
      ) : null}
    </>
  );
}
