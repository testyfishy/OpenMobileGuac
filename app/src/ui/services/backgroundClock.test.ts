import { describe, expect, it } from 'vitest';
import { MemoryKeyValueStore } from '../../core/storage/KeyValueStore.ts';
import { BackgroundClock } from './backgroundClock.ts';

describe('BackgroundClock', () => {
  it('keeps the background time until it is taken once or cleared', async () => {
    const kv = new MemoryKeyValueStore();
    const clock = new BackgroundClock(kv);
    expect(await clock.take()).toBeNull();
    clock.note(1234);
    await new Promise((r) => setTimeout(r, 0));
    expect(await new BackgroundClock(kv).take()).toBe(1234);
    expect(await clock.take()).toBeNull();
    clock.note(99);
    clock.clear();
    await new Promise((r) => setTimeout(r, 0));
    expect(await clock.take()).toBeNull();
  });

  it('ignores a corrupt value', async () => {
    const kv = new MemoryKeyValueStore();
    await kv.set('app/backgroundedAt', 'junk');
    expect(await new BackgroundClock(kv).take()).toBeNull();
  });
});
