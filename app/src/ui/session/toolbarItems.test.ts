import { describe, expect, it } from 'vitest';
import { normalizeSessionSettings } from './settings.ts';
import {
  DEFAULT_TOOLBAR_ITEMS,
  MAX_TOOLBAR_ITEMS,
  NO_EDGES,
  TOOLBAR_ACTIONS,
  availableToolbarActions,
  dockReserve,
  editToolbarItems,
  cutoutSide,
  effectiveToolbarStyle,
  landscapeSide,
  normalizeToolbarItems,
  resolveToolbarItems,
} from './toolbarItems.ts';

describe('toolbar items', () => {
  it('null is the built-in row; stored lists drop unknown and repeated ids and More', () => {
    expect(resolveToolbarItems(null)).toEqual(DEFAULT_TOOLBAR_ITEMS);
    expect(normalizeToolbarItems('x')).toBeNull();
    expect(normalizeToolbarItems(['files', 'bogus', 'files', 'more', 'keyboard'])).toEqual([
      'files',
      'keyboard',
    ]);
    expect(normalizeToolbarItems([...TOOLBAR_ACTIONS])?.length).toBe(MAX_TOOLBAR_ITEMS);
    expect(normalizeToolbarItems([])).toEqual([]);
  });

  it('adds, removes and moves', () => {
    let list = editToolbarItems(null, { type: 'add', id: 'files' });
    expect(list).toEqual([...DEFAULT_TOOLBAR_ITEMS, 'files']);
    list = editToolbarItems(list, { type: 'add', id: 'files' });
    expect(list.filter((x) => x === 'files')).toHaveLength(1);
    list = editToolbarItems(list, { type: 'move', index: list.length - 1, delta: -1 });
    expect(list[list.length - 2]).toBe('files');
    list = editToolbarItems(list, { type: 'move', index: 0, delta: -1 });
    expect(list[0]).toBe('pointer');
    list = editToolbarItems(list, { type: 'remove', index: 0 });
    expect(list).not.toContain('pointer');
    expect(availableToolbarActions(list)).toContain('pointer');
    expect(availableToolbarActions(list)).not.toContain('files');
  });

  it('session settings default to a bottom dock with the built-in row', () => {
    const s = normalizeSessionSettings(null);
    expect(s.toolbarStyle).toBe('dock-bottom');
    expect(s.toolbarItems).toBeNull();
    expect(s.toolbarLabels).toBe('auto');
    expect(s.tapDismissKeyboard).toBe('off');
    // Stored booleans from before the three-way setting.
    expect(normalizeSessionSettings({ tapDismissKeyboard: true as never }).tapDismissKeyboard).toBe(
      'hide-click',
    );
    expect(
      normalizeSessionSettings({ tapDismissKeyboard: false as never }).tapDismissKeyboard,
    ).toBe('off');
    expect(s.keyBarSwipeDismiss).toBe(true);
    expect(normalizeSessionSettings({ toolbarStyle: 'sideways' as never }).toolbarStyle).toBe(
      'dock-bottom',
    );
    expect(normalizeSessionSettings({ toolbarStyle: 'floating' }).toolbarStyle).toBe('floating');
  });
});

describe('toolbar placement', () => {
  it('side docks apply in landscape only', () => {
    expect(effectiveToolbarStyle('dock-left', true)).toBe('dock-left');
    expect(effectiveToolbarStyle('dock-left', false)).toBe('dock-bottom');
    expect(effectiveToolbarStyle('dock-right', false)).toBe('dock-bottom');
    expect(effectiveToolbarStyle('dock-top', false)).toBe('dock-top');
    expect(effectiveToolbarStyle('floating', true)).toBe('floating');
    // Landscape side: moves a top/bottom dock, only in landscape, never a floating one.
    expect(effectiveToolbarStyle('dock-bottom', true, 'right')).toBe('dock-right');
    expect(effectiveToolbarStyle('dock-top', true, 'left')).toBe('dock-left');
    expect(effectiveToolbarStyle('dock-bottom', false, 'right')).toBe('dock-bottom');
    expect(effectiveToolbarStyle('dock-bottom', true, 'same')).toBe('dock-bottom');
    expect(effectiveToolbarStyle('dock-left', true, 'right')).toBe('dock-left');
    expect(effectiveToolbarStyle('floating', true, 'right')).toBe('floating');
  });

  it('finds the camera side and docks an `away` toolbar opposite it', () => {
    expect(cutoutSide(90)).toBe('left');
    expect(cutoutSide(-90)).toBe('right');
    expect(cutoutSide(0)).toBe('unknown');
    expect(cutoutSide(undefined)).toBe('unknown');
    expect(landscapeSide('away', 'left')).toBe('right');
    expect(landscapeSide('away', 'right')).toBe('left');
    expect(landscapeSide('away', 'unknown')).toBe('right');
    expect(landscapeSide('left', 'left')).toBe('left');
    expect(landscapeSide('same', 'right')).toBe('same');
  });

  it('a docked toolbar reserves its own edge; floating reserves nothing', () => {
    const size = { width: 64.4, height: 57.6 };
    expect(dockReserve('floating', size)).toEqual(NO_EDGES);
    expect(dockReserve('dock-bottom', null)).toEqual(NO_EDGES);
    expect(dockReserve('dock-bottom', size)).toEqual({ ...NO_EDGES, bottom: 58 });
    expect(dockReserve('dock-top', size)).toEqual({ ...NO_EDGES, top: 58 });
    expect(dockReserve('dock-left', size)).toEqual({ ...NO_EDGES, left: 64 });
    expect(dockReserve('dock-right', size)).toEqual({ ...NO_EDGES, right: 64 });
  });
});
