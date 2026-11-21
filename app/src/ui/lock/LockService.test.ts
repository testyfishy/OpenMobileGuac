import { describe, expect, it, vi } from 'vitest';
import {
  biometryAvailability,
  type AuthOutcome,
  type BiometryAvailability,
} from '../services/native.ts';
import { DECLINE_MS, lockEnforced, LockService } from './LockService.ts';

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

describe('LockService.confirmPresence (SRV-11 connection passwords)', () => {
  function presence(outcomes: AuthOutcome[], availability: BiometryAvailability = 'available') {
    let t = 1_000_000;
    const authenticate = vi.fn<(reason: string) => Promise<AuthOutcome>>(
      async () => outcomes.shift() ?? 'failed',
    );
    const lock = new LockService({
      authenticate,
      availability: async () => availability,
      now: () => t,
    });
    return { lock, authenticate, advance: (ms: number) => (t += ms) };
  }

  it('prompts with the lock off (an off lock is not a check), naming the reason given', async () => {
    const { lock, authenticate } = presence(['ok']);
    expect(lock.recentlyUnlocked()).toBe(true); // the trap: true whenever the lock is off
    expect(await lock.confirmPresence('Unlock the saved password for Lab', 'Cancel')).toBe(true);
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(authenticate.mock.calls[0]?.[0]).toBe('Unlock the saved password for Lab');
  });

  it('grace: a check within 30 s covers the next fill, until the app goes to the background', async () => {
    const { lock, authenticate, advance } = presence(['ok', 'ok', 'ok']);
    expect(await lock.confirmPresence('r', 'c')).toBe(true);
    advance(5_000);
    expect(await lock.confirmPresence('r', 'c')).toBe(true);
    expect(authenticate).toHaveBeenCalledTimes(1);
    advance(30_000);
    expect(await lock.confirmPresence('r', 'c')).toBe(true);
    expect(authenticate).toHaveBeenCalledTimes(2);
    // Background ends the grace, however short.
    advance(1_000);
    lock.setActive(false);
    advance(1_000);
    lock.setActive(true);
    expect(await lock.confirmPresence('r', 'c')).toBe(true);
    expect(authenticate).toHaveBeenCalledTimes(3);
  });

  it('an app-lock unlock counts as the check (no double prompt)', async () => {
    const { lock, authenticate, advance } = presence(['ok']);
    lock.setEnabled(true);
    lock.lock();
    const pending = lock.confirmPresence('r', 'c');
    await Promise.resolve();
    expect(authenticate).not.toHaveBeenCalled(); // not behind the lock screen
    await lock.unlock('unlock app', 'c');
    advance(2_000);
    expect(await pending).toBe(true);
    expect(authenticate).toHaveBeenCalledTimes(1);
  });

  it('lock on, back from the background before the lock is due: one prompt', async () => {
    const { lock, authenticate, advance } = presence(['ok', 'ok']);
    lock.setEnabled(true);
    await lock.unlock('unlock app', 'c');
    advance(2_000);
    lock.setActive(false);
    lock.cover();
    advance(2_000);
    lock.setActive(true);
    lock.uncover();
    expect(await lock.confirmPresence('r', 'c')).toBe(true);
    expect(authenticate).toHaveBeenCalledTimes(2);
  });

  it('waits for the foreground before prompting', async () => {
    const { lock, authenticate } = presence(['ok']);
    lock.setActive(false);
    const pending = lock.confirmPresence('r', 'c');
    await Promise.resolve();
    await Promise.resolve();
    expect(authenticate).not.toHaveBeenCalled();
    lock.setActive(true);
    expect(await pending).toBe(true);
    expect(authenticate).toHaveBeenCalledTimes(1);
  });

  it('one prompt covers a batch of concurrent checks', async () => {
    let resolve: (o: AuthOutcome) => void = () => undefined;
    const authenticate = vi.fn(() => new Promise<AuthOutcome>((r) => (resolve = r)));
    const lock = new LockService({
      authenticate,
      availability: async () => 'available',
      now: () => 0,
    });
    const all = Promise.all([1, 2, 3].map(() => lock.confirmPresence('r', 'c')));
    await new Promise((r) => setTimeout(r, 0));
    expect(authenticate).toHaveBeenCalledTimes(1);
    resolve('ok');
    expect(await all).toEqual([true, true, true]);
  });

  it('after a cancel, checks within 10 s return false without another prompt', async () => {
    const { lock, authenticate, advance } = presence(['cancelled', 'ok']);
    expect(await lock.confirmPresence('r', 'c')).toBe(false);
    advance(3_000);
    expect(await lock.confirmPresence('r', 'c')).toBe(false);
    expect(authenticate).toHaveBeenCalledTimes(1);
    advance(DECLINE_MS);
    expect(await lock.confirmPresence('r', 'c')).toBe(true);
    expect(authenticate).toHaveBeenCalledTimes(2);
  });

  it('a failed or unavailable prompt is a refusal, not an error', async () => {
    const { lock } = presence(['failed']);
    expect(await lock.confirmPresence('r', 'c')).toBe(false);
    const other = presence(['unavailable']);
    expect(await other.lock.confirmPresence('r', 'c')).toBe(false);
  });

  it('no biometrics or passcode on the device (or the web build): no check', async () => {
    for (const a of ['web', 'no-device-security'] as const) {
      const { lock, authenticate } = presence([], a);
      expect(await lock.confirmPresence('r', 'c')).toBe(true);
      expect(authenticate).not.toHaveBeenCalled();
    }
  });

  it('a biometric plugin error is a refusal, never "no device security" (review R8)', async () => {
    const { lock, authenticate } = presence([], 'error');
    expect(await lock.confirmPresence('r', 'c')).toBe(false);
    expect(authenticate).not.toHaveBeenCalled();
    const throwing = new LockService({
      authenticate,
      availability: () => Promise.reject(new Error('plugin missing')),
    });
    expect(await throwing.confirmPresence('r', 'c')).toBe(false);
    // The lock itself stays enforced on an error (fails closed).
    expect(lockEnforced(true, 'error')).toBe(true);
  });

  it('biometryAvailability maps a checkBiometry exception to error', async () => {
    const failing = () => Promise.reject(new Error('boom'));
    expect(await biometryAvailability(failing, () => true)).toBe('error');
    const none = async () => ({ isAvailable: false, deviceIsSecure: false });
    expect(await biometryAvailability(none, () => true)).toBe('no-device-security');
    const pin = async () => ({ isAvailable: false, deviceIsSecure: true });
    expect(await biometryAvailability(pin, () => true)).toBe('available');
    expect(await biometryAvailability(failing, () => false)).toBe('web');
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
