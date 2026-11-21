import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadEnv, type Plugin, type ProxyOptions } from 'vite';
import { defineConfig } from 'vitest/config';
import { injectCspMeta } from './src/core/security/csp.ts';

/** Local path the dev proxy serves the Guacamole server under (see `src/ui/services/devServer.ts`). */
const DEV_PROXY_PATH = '/dev-guac';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  // Dev-only settings from app/.env.local (git-ignored). They are read here, in Node, and
  // never through `import.meta.env`, so a production build cannot inline them.
  // Read from this directory (app/), whatever the working directory is.
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_DEV_GUAC_');
  const devTarget = command === 'serve' ? parseTarget(env['VITE_DEV_GUAC_URL']) : undefined;

  const proxy: Record<string, ProxyOptions> = {};
  if (devTarget) {
    // Guacamole sends no CORS headers, so in a desktop browser the app talks to
    // http://localhost:<port>/dev-guac/... and Vite forwards REST calls and the
    // websocket tunnel to the real server.
    proxy[DEV_PROXY_PATH] = {
      target: devTarget.origin,
      changeOrigin: true,
      ws: true,
      rewriteWsOrigin: true,
      secure: true,
      rewrite: (path) => devTarget.basePath + path.slice(DEV_PROXY_PATH.length),
    };
  }

  const devServer =
    devTarget !== undefined
      ? {
          path: DEV_PROXY_PATH,
          username: env['VITE_DEV_GUAC_USER'] ?? '',
          password: env['VITE_DEV_GUAC_PASS'] ?? '',
        }
      : null;

  return {
    plugins: [react(), releaseCsp(command === 'build' && process.env['OMG_CSP'] !== 'off')],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      // `null` in every build; only the dev server gets the pre-filled entry.
      __OMG_DEV_SERVER__: JSON.stringify(devServer),
    },
    server: { proxy },
    test: {
      include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
      exclude: ['node_modules', 'dist', 'android', 'ios', 'src/vendor/**/modules/**'],
    },
  };
});

/**
 * Adds the Content-Security-Policy meta (src/core/security/csp.ts) to the production
 * index.html. The dev server gets none: Vite's HMR client needs inline scripts and eval.
 * `OMG_CSP=off npm run build` leaves it out, for diagnosing a broken device build only
 * (docs/BUILDING.md).
 */
function releaseCsp(enabled: boolean): Plugin {
  return {
    name: 'omg-release-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => (enabled ? injectCspMeta(html) : html),
    },
  };
}

function parseTarget(raw: string | undefined): { origin: string; basePath: string } | undefined {
  if (!raw || raw.trim().length === 0) return undefined;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return { origin: url.origin, basePath: url.pathname.replace(/\/+$/, '') };
  } catch {
    // Deliberately no detail: never echo the configured value.
    console.warn('[dev-guac] VITE_DEV_GUAC_URL is not a valid http(s) URL; dev proxy disabled.');
    return undefined;
  }
}
