/** Build-time constants from `vite.config.ts` `define`. */

/** `version` from app/package.json. */
declare const __APP_VERSION__: string;

/**
 * Dev-only Guacamole server for desktop-browser development, from app/.env.local through
 * the Vite dev proxy. Always `null` in builds.
 */
declare const __OMG_DEV_SERVER__: {
  readonly path: string;
  readonly username: string;
  readonly password: string;
} | null;
