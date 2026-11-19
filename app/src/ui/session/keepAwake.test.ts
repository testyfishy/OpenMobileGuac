import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keepScreenAwake, setKeepAwakeImpl, type KeepAwakeImpl } from './platform.ts';

/** A minimal `document` for the visibility checks (tests run in Node). */
function fakeDocument() {
  return {
    visibilityState: 'visible',
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
}

describe('keepScreenAwake with a shared (native) implementation', () => {
  beforeEach(() => {
    vi.stubGlobal('document', fakeDocument());
  });
  afterEach(() => {
    setKeepAwakeImpl(null);
    vi.unstubAllGlobals();
  });

  it('releases only when the last holder is disposed (switching sessions)', async () => {
    const calls: string[] = [];
    const impl: KeepAwakeImpl = {
      acquire: async () => {
        calls.push('acquire');
        return 'native';
      },
      release: async () => {
        calls.push('release');
      },
    };
    setKeepAwakeImpl(impl);
    const a = keepScreenAwake();
    const b = keepScreenAwake(); // the next session is shown before the old one lets go
    a.dispose();
    await Promise.resolve();
    expect(calls).not.toContain('release');
    b.dispose();
    await Promise.resolve();
    expect(calls.filter((c) => c === 'release')).toHaveLength(1);
  });

  it('reports the state of each attempt', async () => {
    setKeepAwakeImpl({ acquire: async () => 'native', release: async () => undefined });
    const states: string[] = [];
    const h = keepScreenAwake((s) => states.push(s));
    await new Promise((r) => setTimeout(r, 0));
    h.dispose();
    expect(states).toEqual(['native', 'released']);
  });
});
