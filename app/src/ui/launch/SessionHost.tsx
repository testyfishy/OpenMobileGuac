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
  type SessionSettings,
} from '../integration/session.ts';
import { useBackInterceptor } from '../nav/NavContext.ts';
import { useAppSettings, useServices } from '../services/context.ts';
import { haptic } from '../services/native.ts';
import type { OpenSession } from '../sessions/sessionModel.ts';
import {
  applyConnectionPatch,
  mergeSessionSettings,
  parseServerOptions,
  type SessionSettingsPatch,
} from '../settings/settingsModel.ts';
import { strings } from '../strings.ts';
import { deviceTimezone, makeConnectDataBuilder } from './connectData.ts';
import { currentMediaSupport } from './mediaSupport.ts';

/** Optional `SessionScreen` props agreed with the session work (see SessionLayer). */
interface ShellSessionProps {
  readonly active: boolean;
  readonly onThumbnail: (dataUrl: string) => void;
  readonly onLog: (entry: { level: 'debug' | 'info' | 'warn' | 'error'; message: string }) => void;
}

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
}

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
}: SessionHostProps) {
  const services = useServices();
  const { settings: app } = useAppSettings();
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

  const createTunnel = useCallback((): TunnelLike => {
    if (isDemo) return new DemoTunnel();
    const auth = services.auth.current(serverId);
    if (!auth) throw new Error('Not signed in');
    return createWebSocketTransport(Guacamole.WebSocketTunnel).createTunnel(auth);
  }, [isDemo, services.auth, serverId]);

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

  const signedIn = isDemo || services.auth.current(serverId) !== undefined;
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

  // Agreed optional SessionScreen props (active, onThumbnail, onLog). Passed through a spread
  // so this compiles both before and after they land in SessionScreenProps.
  const thumbnailsOn = app.thumbnails;
  const extras: ShellSessionProps = useMemo(
    () => ({
      active,
      onThumbnail: (dataUrl: string) => {
        if (!thumbnailsOn || !dataUrl.startsWith('data:image/')) return;
        void services.profiles
          .setThumbnail(serverId, ref, { dataUrl, at: Date.now() })
          .catch(() => undefined);
      },
      onLog: (entry: { level: 'debug' | 'info' | 'warn' | 'error'; message: string }) =>
        services.log.log(entry.level, 'session', entry.message),
    }),
    [active, thumbnailsOn, services.profiles, services.log, serverId, ref],
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
        settings={settings}
        onSettingsChange={onSettingsChange}
        onExit={exit}
        isDemo={isDemo}
        {...(extras as object)}
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
