import { describe, expect, it } from 'vitest';
import { DEFAULT_SESSION_SETTINGS, normalizeSessionSettings } from './settings.ts';
import {
  DEFAULT_TOOLBAR_ITEMS,
  KEY_BAR_LANDSCAPE,
  MAX_TOOLBAR_ITEMS,
  NO_EDGES,
  TOOLBAR_ACTIONS,
  addEdges,
  availableToolbarActions,
  columnReserve,
  keyBarPlacement,
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

describe('key bar placement (landscape phones)', () => {
  const base = {
    setting: 'side',
    landscape: true,
    phone: true,
    split: false,
    toolbar: 'dock-bottom',
    cutout: 'left',
  } as const;

  it('stays a bottom row in portrait, on tablets, in the split layout and when asked', () => {
    expect(keyBarPlacement({ ...base, landscape: false })).toBe('bottom');
    expect(keyBarPlacement({ ...base, phone: false })).toBe('bottom');
    expect(keyBarPlacement({ ...base, split: true })).toBe('bottom');
    expect(keyBarPlacement({ ...base, setting: 'bottom' })).toBe('bottom');
  });

  it('`side` takes the side a side toolbar leaves free, else the side away from the camera', () => {
    expect(keyBarPlacement({ ...base, toolbar: 'dock-right' })).toBe('left');
    expect(keyBarPlacement({ ...base, toolbar: 'dock-left', cutout: 'right' })).toBe('right');
    // Toolbar not at a side: the non-cutout side (its safe-area strip is nearly free).
    expect(keyBarPlacement({ ...base, toolbar: 'dock-bottom', cutout: 'left' })).toBe('right');
    expect(keyBarPlacement({ ...base, toolbar: 'floating', cutout: 'right' })).toBe('left');
    expect(keyBarPlacement({ ...base, toolbar: 'dock-top', cutout: 'unknown' })).toBe('right');
  });

  it('`left` / `right` are fixed, even beside a toolbar docked there', () => {
    expect(keyBarPlacement({ ...base, setting: 'left', toolbar: 'dock-left' })).toBe('left');
    expect(keyBarPlacement({ ...base, setting: 'right', toolbar: 'dock-left' })).toBe('right');
  });

  it('defaults to a side column and repairs stored values', () => {
    expect(normalizeSessionSettings(null).keyBarLandscape).toBe('side');
    expect(normalizeSessionSettings({ keyBarLandscape: 'bottom' }).keyBarLandscape).toBe('bottom');
    expect(normalizeSessionSettings({ keyBarLandscape: 'top' as never }).keyBarLandscape).toBe(
      'side',
    );
    expect(KEY_BAR_LANDSCAPE).toContain(DEFAULT_SESSION_SETTINGS.keyBarLandscape);
  });

  it('the column reserves its width at its side, added to a toolbar docked there', () => {
    expect(columnReserve('bottom', 80)).toEqual(NO_EDGES);
    expect(columnReserve('left', 0)).toEqual(NO_EDGES);
    expect(columnReserve('left', 71.6)).toEqual({ ...NO_EDGES, left: 72 });
    expect(columnReserve('right', Number.NaN)).toEqual(NO_EDGES);
    const toolbar = dockReserve('dock-left', { width: 64, height: 393 });
    expect(addEdges(toolbar, columnReserve('left', 70))).toEqual({ ...NO_EDGES, left: 134 });
    expect(addEdges(toolbar, columnReserve('right', 70))).toEqual({
      ...NO_EDGES,
      left: 64,
      right: 70,
    });
  });
});
