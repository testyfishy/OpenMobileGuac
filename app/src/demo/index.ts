/**
 * Public surface of the in-app demo server. See README.md in this directory.
 */
export { DemoTunnel, createDemoSessionTransport, type DemoTunnelOptions } from './DemoTunnel.ts';
export {
  DEFAULT_DEMO_CONNECTION_ID,
  DEMO_AUTH_SESSION,
  DEMO_BASE_URL,
  DEMO_CONNECTIONS,
  DEMO_CONNECTION_TREE,
  DEMO_DATA_SOURCE,
  DEMO_PROFILE_ID,
  DEMO_ROOT_GROUP,
  DEMO_SERVER_PROFILE,
  DEMO_VARIANTS,
  demoVariant,
  isDemoBaseUrl,
  isDemoProfile,
  type DemoVariant,
} from './profile.ts';
export { DemoServer, type DemoScheduler, type DemoServerOptions } from './server.ts';
export type { DemoRenderer } from './renderer.ts';
export type { FontSpec, MeasureText, Painter } from './painter.ts';
export { createCanvasRenderer, canvasRendererAvailable } from './canvasRenderer.ts';
export { createStubRenderer, RecordingPainter, type StubRenderer } from './testing.ts';
