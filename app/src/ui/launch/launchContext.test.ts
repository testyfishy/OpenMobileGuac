import { describe, expect, it } from 'vitest';
import type { ConnectionTree } from '../../core/models/Connection.ts';
import { launchWaitsForTree } from './LaunchContext.ts';

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
