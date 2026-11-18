import type { ServerProfile } from '../../core/models/ServerProfile.ts';

/**
 * The pre-filled "Dev server" entry (dev builds only, when app/.env.local configures one).
 * Its base URL is the local Vite proxy path, so the real server address never reaches the
 * browser; credentials come from `__OMG_DEV_SERVER__`, which is `null` in every build.
 */
export const DEV_SERVER_ID = 'builtin-dev';

export interface DevServer {
  readonly profile: ServerProfile;
  readonly password: string;
}

export function getDevServer(): DevServer | undefined {
  if (!import.meta.env.DEV) return undefined;
  const cfg = typeof __OMG_DEV_SERVER__ === 'undefined' ? null : __OMG_DEV_SERVER__;
  if (!cfg || typeof globalThis.location === 'undefined') return undefined;
  return {
    profile: {
      id: DEV_SERVER_ID,
      name: 'Dev server',
      baseUrl: `${globalThis.location.origin}${cfg.path}`,
      username: cfg.username,
      rememberPassword: false,
      createdAt: 0,
    },
    password: cfg.password,
  };
}
