import { describe, expect, it } from 'vitest';
import {
  canGoBack,
  decideBack,
  initialNavState,
  navReducer,
  selectedServerId,
  topRoute,
  type NavAction,
  type NavState,
} from './navigation.ts';

const run = (actions: NavAction[], from: NavState = initialNavState()) =>
  actions.reduce(navReducer, from);

describe('navReducer', () => {
  it('starts at the server list and cannot pop the root', () => {
    const s = initialNavState();
    expect(topRoute(s)).toEqual({ name: 'servers' });
    expect(canGoBack(s)).toBe(false);
    expect(navReducer(s, { type: 'pop' })).toBe(s);
  });

  it('pushes and pops with unique keys', () => {
    const s = run([
      { type: 'push', route: { name: 'connections', serverId: 'a' } },
      { type: 'push', route: { name: 'diagnostics' } },
    ]);
    expect(s.stack.map((e) => e.key)).toEqual([0, 1, 2]);
    expect(topRoute(s).name).toBe('diagnostics');
    expect(topRoute(navReducer(s, { type: 'pop' })).name).toBe('connections');
  });

  it('open replaces everything above the root (two-pane selection)', () => {
    const s = run([
      { type: 'push', route: { name: 'connections', serverId: 'a' } },
      { type: 'push', route: { name: 'settings' } },
      { type: 'open', route: { name: 'connections', serverId: 'b' } },
    ]);
    expect(s.stack.map((e) => e.route.name)).toEqual(['servers', 'connections']);
    expect(selectedServerId(s)).toBe('b');
  });

  it('replace swaps the top entry but never the root', () => {
    let s = run([{ type: 'replace', route: { name: 'settings' } }]);
    expect(s.stack.map((e) => e.route.name)).toEqual(['servers', 'settings']);
    s = navReducer(s, { type: 'replace', route: { name: 'connections', serverId: 'x' } });
    expect(s.stack.map((e) => e.route.name)).toEqual(['servers', 'connections']);
  });

  it('pushing the server list resets to the root', () => {
    const s = run([
      { type: 'push', route: { name: 'settings' } },
      { type: 'push', route: { name: 'servers' } },
    ]);
    expect(s.stack).toHaveLength(1);
  });
});

describe('decideBack', () => {
  it('lets the newest interceptor consume the press', () => {
    const calls: string[] = [];
    const s = run([{ type: 'push', route: { name: 'settings' } }]);
    const decision = decideBack(s, [
      () => {
        calls.push('old');
        return true;
      },
      () => {
        calls.push('new');
        return true;
      },
    ]);
    expect(decision).toBe('handled');
    expect(calls).toEqual(['new']);
  });

  it('pops when possible and exits at the root', () => {
    expect(decideBack(run([{ type: 'push', route: { name: 'settings' } }]), [() => false])).toBe(
      'pop',
    );
    expect(decideBack(initialNavState(), [])).toBe('exit');
  });
});
