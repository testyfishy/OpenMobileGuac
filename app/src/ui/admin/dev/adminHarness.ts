import type { AppServiceOverrides } from '../../services/AppServices.ts';
import { DEV_SERVER_ID } from '../../services/devServer.ts';
import { FakeAdminServer, FAKE_BACKEND_MARKER, FAKE_BASE_URL } from './FakeAdminServer.ts';

/**
 * DEV HARNESS ONLY: `?harness=admin` runs the real app against `FakeAdminServer` (an
 * in-memory Guacamole with connection management), shown as the dev-server entry in the
 * server list. `&user=editor|viewer|stale` signs in as another fake account (default
 * `admin`); see FakeAdminServer for what each may do. Loaded from `main.tsx` through a
 * DEV-guarded dynamic import, so release builds do not contain it.
 */
export function createAdminHarness(params: URLSearchParams): AppServiceOverrides {
  const user = params.get('user') ?? 'admin';
  return {
    http: new FakeAdminServer(),
    devServer: {
      profile: {
        id: DEV_SERVER_ID,
        name: `Fake admin server (${FAKE_BACKEND_MARKER})`,
        baseUrl: FAKE_BASE_URL,
        username: user,
        rememberPassword: false,
        createdAt: 0,
      },
      password: 'harness-password',
    },
  };
}
