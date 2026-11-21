import { useEffect, useMemo, useState } from 'react';
import type { ConnectionGroup, ConnectionTree } from '../../core/models/Connection.ts';
import { DEMO_CONNECTION_TREE, DEMO_PROFILE_ID } from '../integration/demoProfile.ts';
import type { AppServices } from '../services/AppServices.ts';
import { useAppSettings, useProfilesVersion, useServices } from '../services/context.ts';
import { strings } from '../strings.ts';
import { buildServerGroup, refId, type ServerGroup, type ServerInput } from './connectionLayers.ts';
import { newOrigin, subscribeSettingsChanges } from './connectionSettingsBus.ts';
import { parseServerOptions, type SessionSettingsPatch } from './settingsModel.ts';

function namesIn(tree: ConnectionTree): Map<string, { name: string; protocol: string }> {
  const out = new Map<string, { name: string; protocol: string }>();
  const walk = (g: ConnectionGroup) => {
    for (const c of g.childConnections) {
      out.set(refId({ type: 'c', dataSource: c.dataSource, identifier: c.identifier }), {
        name: c.name,
        protocol: c.protocol,
      });
    }
    for (const sub of g.childConnectionGroups) walk(sub);
  };
  for (const ds of tree.dataSources) walk(ds.root);
  return out;
}

async function serverInput(
  s: AppServices,
  serverId: string,
  serverName: string,
  hasServerDefaults: boolean,
  known?: ServerInput['known'],
  serverDetail?: string,
): Promise<ServerInput> {
  const p = s.profiles;
  const [stored, recents, favourites, options] = await Promise.all([
    p.listConnectionSettings(serverId).catch(() => []),
    p.listRecents(serverId).catch(() => []),
    p.listFavourites(serverId).catch(() => []),
    p.getOptions(serverId).catch(() => undefined),
  ]);
  return {
    serverId,
    serverName,
    ...(serverDetail ? { serverDetail } : {}),
    hasServerDefaults,
    serverDefaults: parseServerOptions(options).sessionDefaults,
    stored,
    recents,
    favourites,
    ...(known ? { known } : {}),
  };
}

function hostOf(baseUrl: string): string | undefined {
  try {
    return new URL(baseUrl).host;
  } catch {
    return undefined;
  }
}

/**
 * Every connection known on this device, grouped by server (Settings › Connections): saved
 * servers in their order, then the dev server and the Demo when they have anything stored.
 * Local data only, so signed-out servers are listed too and nothing goes to the network.
 */
export async function loadConnectionInventory(
  s: AppServices,
  appDefaults: SessionSettingsPatch,
): Promise<ServerGroup[]> {
  const saved = await s.profiles.list().catch(() => []);
  const inputs = await Promise.all(
    saved.map((p) => serverInput(s, p.id, p.name, true, undefined, hostOf(p.baseUrl))),
  );
  const dev = s.devServer?.profile;
  if (dev && !saved.some((p) => p.id === dev.id)) {
    inputs.push(await serverInput(s, dev.id, dev.name, false));
  }
  inputs.push(
    await serverInput(
      s,
      DEMO_PROFILE_ID,
      strings.servers.demoName,
      false,
      namesIn(DEMO_CONNECTION_TREE),
    ),
  );
  return inputs
    .map((i) => buildServerGroup(i, appDefaults))
    .filter((g) => g.entries.length > 0 || g.hasServerDefaults);
}

/**
 * The inventory, reloaded when the app defaults, the saved servers or any stored settings
 * change (also from an open session). `undefined` while the first load runs.
 */
export function useConnectionInventory(): ServerGroup[] | undefined {
  const services = useServices();
  const { settings } = useAppSettings();
  const { version } = useProfilesVersion();
  const [groups, setGroups] = useState<ServerGroup[] | undefined>(undefined);
  const [changes, setChanges] = useState(0);
  const origin = useMemo(() => newOrigin('inventory'), []);
  useEffect(() => subscribeSettingsChanges(origin, () => setChanges((n) => n + 1)), [origin]);
  useEffect(() => {
    let live = true;
    void loadConnectionInventory(services, settings.sessionDefaults).then((g) => {
      if (live) setGroups(g);
    });
    return () => {
      live = false;
    };
  }, [services, settings.sessionDefaults, version, changes]);
  return groups;
}
