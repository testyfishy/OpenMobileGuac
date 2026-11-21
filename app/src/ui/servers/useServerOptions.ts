import { useEffect, useMemo, useState } from 'react';
import { useServices } from '../services/context.ts';
import {
  newOrigin,
  publishSettingsChange,
  subscribeSettingsChanges,
} from '../settings/connectionSettingsBus.ts';
import {
  parseServerOptions,
  serverOptionsToJson,
  type ServerOptions,
} from '../settings/settingsModel.ts';

/**
 * Per-server options (stored as `ProfileStore` options) loaded once and saved on change.
 * Reloaded when the server's defaults are edited elsewhere (Settings › Connections), so a
 * later save here never writes back stale session defaults.
 */
export function useServerOptions(profileId: string) {
  const { profiles } = useServices();
  const [options, setOptions] = useState<ServerOptions | undefined>(undefined);
  const [reloads, setReloads] = useState(0);
  const origin = useMemo(() => newOrigin('server-options'), []);
  useEffect(
    () =>
      subscribeSettingsChanges(origin, (c) => {
        if (c.serverId === profileId && c.refKey === undefined) setReloads((n) => n + 1);
      }),
    [origin, profileId],
  );
  useEffect(() => {
    let live = true;
    void profiles.getOptions(profileId).then((o) => {
      if (live) setOptions(parseServerOptions(o));
    });
    return () => {
      live = false;
    };
  }, [profiles, profileId, reloads]);
  const save = (patch: Partial<ServerOptions>) => {
    if (!options) return;
    const next = { ...options, ...patch };
    setOptions(next);
    void profiles.setOptions(profileId, serverOptionsToJson(next)).then(() => {
      // Open sessions of this server follow its session defaults.
      if (patch.sessionDefaults !== undefined) publishSettingsChange(profileId, undefined, origin);
    });
  };
  return { options, save };
}
