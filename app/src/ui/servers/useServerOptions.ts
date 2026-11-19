import { useEffect, useState } from 'react';
import { useServices } from '../services/context.ts';
import {
  parseServerOptions,
  serverOptionsToJson,
  type ServerOptions,
} from '../settings/settingsModel.ts';

/** Per-server options (stored as `ProfileStore` options) loaded once and saved on change. */
export function useServerOptions(profileId: string) {
  const { profiles } = useServices();
  const [options, setOptions] = useState<ServerOptions | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void profiles.getOptions(profileId).then((o) => {
      if (live) setOptions(parseServerOptions(o));
    });
    return () => {
      live = false;
    };
  }, [profiles, profileId]);
  const save = (patch: Partial<ServerOptions>) => {
    if (!options) return;
    const next = { ...options, ...patch };
    setOptions(next);
    void profiles.setOptions(profileId, serverOptionsToJson(next));
  };
  return { options, save };
}
