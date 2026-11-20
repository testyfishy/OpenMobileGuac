import { describe, expect, it, vi } from 'vitest';
import type { AuthOutcome } from '../services/native.ts';
import { lockEnforced, LockService } from './LockService.ts';

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

describe('LockService fails closed (AUDIT #3)', () => {
  it('keeps the lock on when the device reports no biometrics or passcode', () => {
    expect(lockEnforced(true, 'available')).toBe(true);
    expect(lockEnforced(true, 'no-device-security')).toBe(true);
    expect(lockEnforced(true, 'web')).toBe(false);
    expect(lockEnforced(false, 'available')).toBe(false);
  });

  it('stays locked when the prompt errors or is unavailable', async () => {
    const { lock } = make(['unavailable', 'failed']);
    lock.setEnabled(true);
    lock.lock();
    expect(await lock.unlock('r', 'c')).toBe('unavailable');
    expect(lock.isLocked()).toBe(true);
    expect(await lock.unlock('r', 'c')).toBe('failed');
    expect(lock.isLocked()).toBe(true);
    expect(await lock.ensureUnlocked('r', 'c')).toBe(false);
  });

  it('holds work in whenUnlocked until a successful unlock', async () => {
    const { lock } = make(['cancelled', 'ok']);
    lock.setEnabled(true);
    lock.lock();
    let ran = false;
    const waiting = lock.whenUnlocked().then(() => (ran = true));
    await lock.unlock('r', 'c');
    await Promise.resolve();
    expect(ran).toBe(false);
    await lock.unlock('r', 'c');
    await waiting;
    expect(ran).toBe(true);
  });

  it('covers in the background and uncovers without a prompt; covered counts as locked', async () => {
    const { lock, authenticate } = make([]);
    lock.setEnabled(true);
    lock.cover();
    expect(lock.state()).toBe('covered');
    expect(lock.isLocked()).toBe(true);
    expect(lock.recentlyUnlocked()).toBe(false);
    const w = lock.whenUnlocked();
    lock.uncover();
    await w;
    expect(lock.state()).toBe('unlocked');
    expect(authenticate).not.toHaveBeenCalled();
    // Covered, then the lock becomes due: a real lock.
    lock.cover();
    lock.lock();
    expect(lock.state()).toBe('locked');
  });
});
