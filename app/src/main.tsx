import { StrictMode, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { recordCspViolations } from './core/diagnostics/cspViolations.ts';
import { detectImageMimetypes } from './ui/launch/imageSupport.ts';
import { createAppServices, type AppServiceOverrides } from './ui/services/AppServices.ts';
// By file path, not through ui/session/index.ts, so the session screen stays code-split.
import { sweepDownloadCache } from './ui/session/downloadCache.ts';
import { applyTheme } from './ui/theme/applyTheme.ts';

// Listen before anything renders; entries reach the diagnostics log once it exists.
const cspViolations = recordCspViolations(document);

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Missing #root element');
}
const root = createRoot(rootEl);

async function boot(): Promise<void> {
  // Dev only: the session work's harness at ?harness=session. The glob keeps the build
  // working whether or not the file exists, and the DEV guard drops it from release builds.
  if (import.meta.env.DEV && new URLSearchParams(location.search).get('harness') === 'session') {
    const loaders = import.meta.glob<Record<string, unknown>>(
      './ui/session/dev/SessionHarness.tsx',
    );
    const load = Object.values(loaders)[0];
    if (load) {
      const mod = await load();
      const Harness = (mod['default'] ?? mod['SessionHarness']) as ComponentType | undefined;
      if (Harness) {
        root.render(
          <StrictMode>
            <Harness />
          </StrictMode>,
        );
        return;
      }
    }
  }

  // Dev only: ?harness=admin runs the app against an in-memory fake server with connection
  // management (ui/admin/dev). Same pattern as above: DEV guard + glob, so releases drop it.
  let overrides: AppServiceOverrides | undefined;
  if (import.meta.env.DEV && new URLSearchParams(location.search).get('harness') === 'admin') {
    const loaders = import.meta.glob<{
      createAdminHarness: (p: URLSearchParams) => AppServiceOverrides;
    }>('./ui/admin/dev/adminHarness.ts');
    const load = Object.values(loaders)[0];
    if (load) overrides = (await load()).createAdminHarness(new URLSearchParams(location.search));
  }

  void detectImageMimetypes();
  // Files received in an earlier run and handed to the share sheet (downloads, print jobs).
  void sweepDownloadCache();
  const services = createAppServices(overrides);
  cspViolations.attach(services.log);
  // DIAG-1: uncaught errors go to the local log (message only; no stack, no data).
  window.addEventListener('error', (e) => services.log.error('app', e.message || 'error'));
  window.addEventListener('unhandledrejection', (e) =>
    services.log.error('app', e.reason instanceof Error ? e.reason.message : 'unhandled rejection'),
  );
  const initialSettings = await services.settings.load();
  applyTheme(initialSettings.theme, services.native);
  // SRV-6: start locked before the first paint. The lock fails closed: LockGate never
  // releases it because biometrics / a passcode are unavailable (AUDIT #3); it explains and
  // offers Retry instead.
  if (services.native && initialSettings.lock.enabled) {
    services.lock.setEnabled(true);
    services.lock.lock();
  }
  root.render(
    <StrictMode>
      <App services={services} initialSettings={initialSettings} />
    </StrictMode>,
  );
}

void boot();
