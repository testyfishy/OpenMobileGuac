import { describe, expect, it } from 'vitest';
import { seedPolicy } from './seedPolicy.ts';

describe('seedPolicy (SRV-9)', () => {
  it('requires the lock in the app', () => {
    expect(seedPolicy('secure', 'available', false)).toBe('needs-lock');
    expect(seedPolicy('secure', 'available', true)).toBe('allowed');
    expect(seedPolicy('secure', 'no-device-security', true)).toBe('needs-lock');
  });

  it('never stores without persistent storage', () => {
    expect(seedPolicy('memory', 'available', true)).toBe('no-storage');
    expect(seedPolicy('memory', 'web', false)).toBe('no-storage');
  });

  it('allows the dev browser store where no lock exists', () => {
    expect(seedPolicy('insecure-dev', 'web', false)).toBe('allowed');
  });
});
