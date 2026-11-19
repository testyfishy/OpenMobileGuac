/**
 * The demo's constants and connection tree only (no tunnel, no renderer), so the app
 * shell's main chunk does not pull in the demo desktop. The full module is
 * `integration/demo.ts`, loaded with the session screen.
 */
export {
  DEMO_AUTH_SESSION,
  DEMO_CONNECTION_TREE,
  DEMO_PROFILE_ID,
  isDemoProfile,
} from '../../demo/profile.ts';
