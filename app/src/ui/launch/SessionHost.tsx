import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useBackInterceptor, useNav } from '../nav/NavContext.ts';
import type { SessionTarget } from '../nav/navigation.ts';
import { useAppSettings, useServices } from '../services/context.ts';
import {
  applyConnectionPatch,
  mergeSessionSettings,
  type SessionSettingsPatch,
} from '../settings/settingsModel.ts';
import { strings } from '../strings.ts';
import { deviceTimezone, makeConnectDataBuilder } from './connectData.ts';
import { currentMediaSupport } from './mediaSupport.ts';

/**
 * Launches `SessionScreen` for one connection: a fresh tunnel per (re)connect, the connect
 * string with the current token, and per-connection settings defaulting from the global
 * ones (SET-1). Demo connections use the in-app `DemoTunnel` and never touch the network.
 */
export function SessionHost({ serverId, target }: { serverId: string; target: SessionTarget }) {
  const nav = useNav();
  const services = useServices();
  const { settings: app } = useAppSettings();
  const isDemo = serverId === DEMO_PROFILE_ID;
  const ref: ConnectionRef = useMemo(
    () => ({ dataSource: target.dataSource, identifier: target.identifier, type: target.type }),
    [target.dataSource, target.identifier, target.type],
  );
  const [stored, setStored] = useState<SessionSettingsPatch | undefined>(undefined);
  const [confirmExit, setConfirmExit] = useState(false);

  useEffect(() => {
    let live = true;
    void services.profiles
      .getConnectionSettings(serverId, ref)
      .catch(() => undefined)
      .then((s) => {
        if (live) setStored(applyConnectionPatch(s, {}));
      });
    return () => {
      live = false;
    };
  }, [services.profiles, serverId, ref]);

  const settings: SessionSettings = useMemo(
    () => mergeSessionSettings(DEFAULT_SESSION_SETTINGS, app.sessionDefaults, stored),
    [app.sessionDefaults, stored],
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
    const session = services.auth.current(serverId);
    if (!session) throw new Error('Not signed in');
    return createWebSocketTransport(Guacamole.WebSocketTunnel).createTunnel(session);
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
  // Hardware back in a session asks before disconnecting.
  useBackInterceptor(signedIn && stored !== undefined && !confirmExit, () => setConfirmExit(true));

  useEffect(() => {
    if (!signedIn) nav.pop();
  }, [signedIn, nav]);

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
        onExit={nav.pop}
        isDemo={isDemo}
      />
      {confirmExit ? (
        <Dialog
          title={strings.session.disconnectTitle(target.name)}
          onCancel={() => setConfirmExit(false)}
          actions={
            <>
              <button type="button" className="btn" onClick={() => setConfirmExit(false)}>
                {strings.common.cancel}
              </button>
              <button type="button" className="btn btn-danger" onClick={nav.pop}>
                {strings.session.disconnect}
              </button>
            </>
          }
        />
      ) : null}
    </>
  );
}
