import { describe, expect, it } from 'vitest';
import type { ConnectionTree } from '../../core/models/Connection.ts';
import {
  PENDING_LAUNCH_TTL_MS,
  launchExpired,
  launchWaitsForTree,
  type PendingLaunch,
} from './LaunchContext.ts';

describe('launchExpired', () => {
  const base: PendingLaunch = {
    serverId: 'srv-1',
    identifier: '42',
    dataSource: 'postgresql',
    type: 'c',
  };
  it('lets a fresh launch through and drops one left waiting', () => {
    const p = { ...base, at: 1_000_000 };
    expect(launchExpired(p, 1_000_000 + 30_000)).toBe(false);
    expect(launchExpired(p, 1_000_000 + PENDING_LAUNCH_TTL_MS)).toBe(false);
    expect(launchExpired(p, 1_000_000 + PENDING_LAUNCH_TTL_MS + 1)).toBe(true);
    // The clock went back: do not trust it.
    expect(launchExpired(p, 999_000)).toBe(true);
  });
  it('never expires a launch without a time', () => {
    expect(launchExpired(base, Number.MAX_SAFE_INTEGER)).toBe(false);
  });
});

describe('launchWaitsForTree', () => {
  it('waits only while the target data source did not load', () => {
    const partial: ConnectionTree = { dataSources: [], unavailable: ['postgresql-shared'] };
    expect(launchWaitsForTree(partial, 'postgresql-shared')).toBe(true);
    expect(launchWaitsForTree(partial, 'postgresql')).toBe(false);
    expect(launchWaitsForTree({ dataSources: [] }, 'postgresql')).toBe(false);
    expect(launchWaitsForTree(partial, undefined)).toBe(true);
    expect(launchWaitsForTree({ dataSources: [] }, undefined)).toBe(false);
  });
});
