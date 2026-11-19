import { describe, expect, it, vi } from 'vitest';
import type { AuthOutcome } from '../services/native.ts';
import { LockService } from './LockService.ts';

function make(outcomes: AuthOutcome[]) {
  let t = 0;
  const authenticate = vi.fn(async () => outcomes.shift() ?? 'failed');
  const lock = new LockService({
    authenticate,
    availability: async () => 'available',
    now: () => t,
  });
  return { lock, authenticate, advance: (ms: number) => (t += ms) };
}

describe('LockService', () => {
  it('is a no-op gate when disabled', async () => {
    const { lock, authenticate } = make([]);
    expect(await lock.ensureUnlocked('r', 'c')).toBe(true);
    lock.lock();
    expect(lock.isLocked()).toBe(false);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('locks, unlocks and counts a recent unlock for the credential gate', async () => {
    const { lock, authenticate, advance } = make(['ok', 'ok']);
    lock.setEnabled(true);
    lock.lock();
    expect(lock.isLocked()).toBe(true);
    expect(await lock.unlock('r', 'c')).toBe('ok');
    expect(lock.isLocked()).toBe(false);
    advance(10_000);
    expect(await lock.ensureUnlocked('r', 'c')).toBe(true);
    expect(authenticate).toHaveBeenCalledTimes(1);
    advance(60_000);
    expect(await lock.ensureUnlocked('r', 'c')).toBe(true);
    expect(authenticate).toHaveBeenCalledTimes(2);
  });

  it('refuses the gate when the prompt is cancelled', async () => {
    const { lock } = make(['cancelled']);
    lock.setEnabled(true);
    expect(await lock.ensureUnlocked('r', 'c')).toBe(false);
  });

  it('shares one prompt between concurrent callers and reports it as active', async () => {
    let resolve: (o: AuthOutcome) => void = () => undefined;
    const lock = new LockService({
      authenticate: () => new Promise<AuthOutcome>((r) => (resolve = r)),
      availability: async () => 'available',
      now: () => 0,
    });
    lock.setEnabled(true);
    const a = lock.ensureUnlocked('r', 'c');
    const b = lock.ensureUnlocked('r', 'c');
    expect(lock.promptActive()).toBe(true);
    resolve('ok');
    expect(await Promise.all([a, b])).toEqual([true, true]);
  });

  it('turning the lock off releases a locked screen and notifies', () => {
    const { lock } = make([]);
    const fn = vi.fn();
    lock.subscribe(fn);
    lock.setEnabled(true);
    lock.lock();
    lock.setEnabled(false);
    expect(lock.isLocked()).toBe(false);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
