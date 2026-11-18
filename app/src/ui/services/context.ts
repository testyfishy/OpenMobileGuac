import { createContext, useContext } from 'react';
import type { AppSettings } from '../settings/settingsModel.ts';
import type { AppServices } from './AppServices.ts';

export const ServicesContext = createContext<AppServices | null>(null);

export function useServices(): AppServices {
  const s = useContext(ServicesContext);
  if (!s) throw new Error('useServices() outside <ServicesContext>');
  return s;
}

export interface SettingsContextValue {
  readonly settings: AppSettings;
  readonly update: (next: AppSettings) => void;
}

export const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useAppSettings(): SettingsContextValue {
  const s = useContext(SettingsContext);
  if (!s) throw new Error('useAppSettings() outside <SettingsContext>');
  return s;
}

/** Bumped whenever the saved server list changes, so lists can reload. */
export const ProfilesVersionContext = createContext<{
  readonly version: number;
  readonly bump: () => void;
}>({ version: 0, bump: () => undefined });

export function useProfilesVersion() {
  return useContext(ProfilesVersionContext);
}
