import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TunnelTargetTypes } from '../../core/api/tunnel.ts';
import { createWebSocketTransport } from '../../core/transport/SessionTransport.ts';
import type { ConnectionRef } from '../../core/storage/ProfileStore.ts';
import type { TunnelLike } from '../../core/transport/TunnelLike.ts';
import Guacamole from '../../vendor/guacamole-common-js/index.js';
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
import { strings } from '../strings.ts';
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
  const ref: ConnectionRef = useMemo(
    () => ({ dataSource: target.dataSource, identifier: target.identifier, type: target.type }),
    [target.dataSource, target.identifier, target.type],
  );
  const [stored, setStored] = useState<SessionSettingsPatch | undefined>(undefined);
  const [serverLayer, setServerLayer] = useState<SessionSettingsPatch>({});
  const [confirmExit, setConfirmExit] = useState(false);

  useEffect(() => {
    let live = true;
    void Promise.all([
      services.profiles.getConnectionSettings(serverId, ref).catch(() => undefined),
      services.profiles.getOptions(serverId).catch(() => undefined),
    ]).then(([s, o]) => {
      if (!live) return;
      setServerLayer(parseServerOptions(o).sessionDefaults);
      setStored(applyConnectionPatch(s, {}));
    });
    return () => {
      live = false;
    };
  }, [services.profiles, serverId, ref]);

  const settings: SessionSettings = useMemo(
    () => mergeSessionSettings(DEFAULT_SESSION_SETTINGS, app.sessionDefaults, stored, serverLayer),
    [app.sessionDefaults, stored, serverLayer],
  );

  const onSettingsChange = useCallback(
    (patch: Partial<SessionSettings>) => {
      setStored((prev) => {
        const next = applyConnectionPatch(prev, patch);
        void services.profiles.setConnectionSettings(serverId, ref, next);
        return next;
      });
    },
    [services.profiles, serverId, ref],
  );

  const onUseDefault = useCallback(
    (keys: string[]) => {
      setStored((prev) => {
        const next = removeConnectionKeys(prev, keys);
        void services.profiles.setConnectionSettings(serverId, ref, next);
        return next;
      });
    },
    [services.profiles, serverId, ref],
  );
  const overridden = useMemo(() => overriddenKeys(stored), [stored]);

  const createTunnel = useCallback((): TunnelLike => {
    if (isDemo) return new DemoTunnel();
    const auth = services.auth.current(serverId);
    if (!auth) throw new Error('Not signed in');
    return createWebSocketTransport(Guacamole.WebSocketTunnel).createTunnel(auth);
  }, [isDemo, services.auth, serverId]);

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
        id: target.identifier,
        type:
          target.type === 'g' ? TunnelTargetTypes.CONNECTION_GROUP : TunnelTargetTypes.CONNECTION,
        timezone: deviceTimezone(),
        media: currentMediaSupport,
      }),
    [isDemo, services.auth, serverId, target.dataSource, target.identifier, target.type],
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
    if (isDemo || isShareServerId(serverId)) return undefined;
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
  }, [isDemo, serverId, services.api, services.auth, target.name]);

  // CON-4 thumbnails come from the session screen itself (≤ 320 px JPEG).
  const thumbnailsOn = app.thumbnails;
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
