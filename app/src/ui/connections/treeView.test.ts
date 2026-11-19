import { describe, expect, it } from 'vitest';
import { parseConnectionGroup, type ConnectionTree } from '../../core/models/Connection.ts';
import {
  allConnections,
  findTarget,
  sortConnections,
  sortGroups,
  targetOfGroup,
} from './treeView.ts';

const tree: ConnectionTree = {
  dataSources: [
    {
      dataSource: 'pg',
      root: parseConnectionGroup(
        {
          identifier: 'ROOT',
          name: 'ROOT',
          type: 'ORGANIZATIONAL',
          childConnections: [
            { identifier: '1', name: 'zeta', protocol: 'vnc' },
            { identifier: '2', name: 'Alpha', protocol: 'ssh' },
            { identifier: '10', name: 'alpha 10', protocol: 'rdp' },
          ],
          childConnectionGroups: [
            {
              identifier: '5',
              name: 'Pool',
              type: 'BALANCING',
              childConnections: [
                { identifier: '6', name: 'node a', protocol: 'rdp' },
                { identifier: '7', name: 'node b', protocol: 'rdp' },
              ],
            },
            { identifier: '8', name: 'Empty', type: 'ORGANIZATIONAL' },
          ],
        },
        'pg',
      ),
    },
  ],
};

describe('connection lookup and sorting', () => {
  it('finds connections and balancing groups for links', () => {
    expect(findTarget(tree, '2', undefined, 'c')).toMatchObject({
      name: 'Alpha',
      type: 'c',
      protocol: 'ssh',
    });
    expect(findTarget(tree, '2', 'other', 'c')).toBeUndefined();
    expect(findTarget(tree, '5', 'pg', 'g')).toMatchObject({
      name: 'Pool',
      type: 'g',
      protocol: 'rdp',
    });
    expect(findTarget(tree, '404', undefined, 'c')).toBeUndefined();
  });

  it('a mixed-protocol balancing group has no single protocol', () => {
    const g = tree.dataSources[0]?.root;
    if (!g) throw new Error('fixture');
    expect(targetOfGroup(g).protocol).toBe('');
  });

  it('sorts by name (natural, case-insensitive), protocol and recent use', () => {
    const items = allConnections(tree).filter((m) => m.path.length === 0);
    const names = (xs: typeof items) => xs.map((m) => m.connection.name);
    expect(names(sortConnections(items, 'server'))).toEqual(['zeta', 'Alpha', 'alpha 10']);
    expect(names(sortConnections(items, 'name'))).toEqual(['Alpha', 'alpha 10', 'zeta']);
    expect(names(sortConnections(items, 'protocol'))).toEqual(['alpha 10', 'Alpha', 'zeta']);
    const used = new Map([['c:pg:1', 50]]);
    expect(names(sortConnections(items, 'recent', used))).toEqual(['zeta', 'Alpha', 'alpha 10']);
  });

  it('sorts groups by name except in server order', () => {
    const groups = tree.dataSources[0]?.root.childConnectionGroups ?? [];
    expect(sortGroups(groups, 'name').map((g) => g.name)).toEqual(['Empty', 'Pool']);
    expect(sortGroups(groups, 'server').map((g) => g.name)).toEqual(['Pool', 'Empty']);
  });
});
