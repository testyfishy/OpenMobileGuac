import { StrictMode, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { detectImageMimetypes } from './ui/launch/mediaSupport.ts';
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
  const initialSettings = await services.settings.load();
  applyTheme(initialSettings.theme, services.native);
  root.render(
    <StrictMode>
      <App services={services} initialSettings={initialSettings} />
    </StrictMode>,
  );
}

void boot();
