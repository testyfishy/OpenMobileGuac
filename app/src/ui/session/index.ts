/**
 * Session screen (T1.6 / T1.7 / T1.8): the remote desktop view, touch input, toolbar,
 * keyboard bridge, key bar, combos and clipboard.
 *
 * Structure: `SessionScreen` (React chrome) drives a `SessionController` (imperative:
 * Guacamole client, display, models, DOM listeners). Pure glue with unit tests lives in
 * `settings.ts`, `status.ts`, `inputMapping.ts`, `combos.ts` and `layout.ts`;
 * `clipboardText.ts` moves clipboard text over Guacamole streams as exact UTF-8.
 * Dev harness: `dev/SessionHarness.tsx` (not exported here so it stays out of production
 * bundles unless imported explicitly behind `import.meta.env.DEV`).
 */
export { SessionScreen, type SessionScreenProps } from './SessionScreen.tsx';
export {
  DEFAULT_SESSION_SETTINGS,
  normalizeSessionSettings,
  type SessionSettings,
} from './settings.ts';
