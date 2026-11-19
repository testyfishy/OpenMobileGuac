import type { BiometryAvailability } from '../services/native.ts';
import type { SecretStorageKind } from '../services/AppServices.ts';

/**
 * When a TOTP seed may be stored (SRV-9). Pure.
 *
 * - Never without persistent secret storage.
 * - In the app (native), only while the biometric / device-credential lock is on.
 * - In a desktop-browser development build there is no lock to require; the seed then goes
 *   to the (already insecure, dev-only) browser store so the feature can be exercised.
 */
export type SeedPolicy = 'allowed' | 'needs-lock' | 'no-storage';

export function seedPolicy(
  storage: SecretStorageKind,
  biometry: BiometryAvailability | undefined,
  lockEnabled: boolean,
): SeedPolicy {
  if (storage === 'memory') return 'no-storage';
  if (biometry === 'web') return storage === 'insecure-dev' ? 'allowed' : 'no-storage';
  return lockEnabled && biometry === 'available' ? 'allowed' : 'needs-lock';
}
