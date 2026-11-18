import type { KeyValueStore } from '../../core/storage/KeyValueStore.ts';
import {
  DEFAULT_APP_SETTINGS,
  parseAppSettings,
  type AppSettings,
} from '../settings/settingsModel.ts';

const APP_SETTINGS_KEY = 'settings/app';
const httpAckKey = (profileId: string): string => `ui/httpWarningAck/${profileId}`;

/** Global settings and small UI preferences, stored as JSON in the non-secret store. */
export class SettingsStore {
  private readonly kv: KeyValueStore;

  constructor(kv: KeyValueStore) {
    this.kv = kv;
  }

  async load(): Promise<AppSettings> {
    try {
      const raw = await this.kv.get(APP_SETTINGS_KEY);
      return raw === null ? DEFAULT_APP_SETTINGS : parseAppSettings(JSON.parse(raw));
    } catch {
      return DEFAULT_APP_SETTINGS;
    }
  }

  async save(settings: AppSettings): Promise<void> {
    await this.kv.set(APP_SETTINGS_KEY, JSON.stringify({ v: 1, ...settings }));
  }

  /** "Don't show again for this server" for the plain-http credentials warning. */
  async isHttpWarningDismissed(profileId: string): Promise<boolean> {
    return (await this.kv.get(httpAckKey(profileId)).catch(() => null)) === '1';
  }

  async setHttpWarningDismissed(profileId: string, dismissed: boolean): Promise<void> {
    if (dismissed) await this.kv.set(httpAckKey(profileId), '1');
    else await this.kv.remove(httpAckKey(profileId));
  }
}
