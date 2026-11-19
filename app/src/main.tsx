import { StrictMode, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { detectImageMimetypes } from './ui/launch/imageSupport.ts';
import { createAppServices } from './ui/services/AppServices.ts';
import { applyTheme } from './ui/theme/applyTheme.ts';

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

  void detectImageMimetypes();
  const services = createAppServices();
  // DIAG-1: uncaught errors go to the local log (message only; no stack, no data).
  window.addEventListener('error', (e) => services.log.error('app', e.message || 'error'));
  window.addEventListener('unhandledrejection', (e) =>
    services.log.error('app', e.reason instanceof Error ? e.reason.message : 'unhandled rejection'),
  );
  const initialSettings = await services.settings.load();
  applyTheme(initialSettings.theme, services.native);
  // SRV-6: start locked before the first paint. LockGate re-checks device support and
  // releases the lock if biometrics / a passcode are no longer available.
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
