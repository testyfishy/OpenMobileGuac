import type { KeyValueStore } from '../../core/storage/KeyValueStore.ts';

const KEY = 'app/backgroundedAt';

/**
 * When the app last went to the background, kept in the non-secret store so that "Sign out
 * of servers after …" also applies when the system ended the app while it was away (iOS
 * often does). A timestamp, not a timer: background WebViews freeze timers.
 */
export class BackgroundClock {
  private readonly kv: KeyValueStore;

  constructor(kv: KeyValueStore) {
    this.kv = kv;
  }

  /** The app went to the background at `at` (best effort; the write is not awaited). */
  note(at: number): void {
    void this.kv.set(KEY, String(at)).catch(() => undefined);
  }

  /** The app is in the foreground again. */
  clear(): void {
    void this.kv.remove(KEY).catch(() => undefined);
  }

  /** Reads and clears the stored time (at start-up). `null` if none or unreadable. */
  async take(): Promise<number | null> {
    const raw = await this.kv.get(KEY).catch(() => null);
    if (raw === null) return null;
    await this.kv.remove(KEY).catch(() => undefined);
    const at = Number(raw);
    return Number.isFinite(at) && at > 0 ? at : null;
  }
}
