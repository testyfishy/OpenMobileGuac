import { useEffect, useState } from 'react';
import type { ServerProfile } from '../../core/models/ServerProfile.ts';
import { useProfilesVersion, useServices } from '../services/context.ts';
import { DEMO_PROFILE_ID } from '../integration/demo.ts';
import { DEV_SERVER_ID } from '../services/devServer.ts';

/** The built-in Demo server is virtual: never in `ProfileStore`, never touches the network. */
export const DEMO_SERVER_ID = DEMO_PROFILE_ID;

export function isVirtualServerId(id: string): boolean {
  return id === DEMO_SERVER_ID || id === DEV_SERVER_ID;
}

/** Saved profiles in user order; reloads when the list changes. */
export function useSavedProfiles(): { profiles: ServerProfile[] | undefined; reload: () => void } {
  const { profiles } = useServices();
  const { version, bump } = useProfilesVersion();
  const [list, setList] = useState<ServerProfile[] | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void profiles.list().then((l) => {
      if (live) setList(l);
    });
    return () => {
      live = false;
    };
  }, [profiles, version]);
  return { profiles: list, reload: bump };
}

export type ProfileLookup =
  | { readonly status: 'loading' }
  | { readonly status: 'missing' }
  | { readonly status: 'demo' }
  | { readonly status: 'ready'; readonly profile: ServerProfile; readonly virtual: boolean };

/** Resolves a server id (saved, dev or demo) to its profile. */
export function useServerProfile(id: string | undefined): ProfileLookup {
  const services = useServices();
  const { version } = useProfilesVersion();
  const [saved, setSaved] = useState<{ id: string; profile: ServerProfile | undefined }>();
  const dev = services.devServer;
  const needsLookup = id !== undefined && id !== DEMO_SERVER_ID && id !== dev?.profile.id;
  useEffect(() => {
    if (!needsLookup || id === undefined) return undefined;
    let live = true;
    void services.profiles.get(id).then((profile) => {
      if (live) setSaved({ id, profile });
    });
    return () => {
      live = false;
    };
  }, [services.profiles, id, needsLookup, version]);

  if (id === undefined) return { status: 'missing' };
  if (id === DEMO_SERVER_ID) return { status: 'demo' };
  if (dev && id === dev.profile.id) return { status: 'ready', profile: dev.profile, virtual: true };
  if (!saved || saved.id !== id) return { status: 'loading' };
  return saved.profile
    ? { status: 'ready', profile: saved.profile, virtual: false }
    : { status: 'missing' };
}
