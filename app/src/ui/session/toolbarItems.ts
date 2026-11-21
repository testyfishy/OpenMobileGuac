/**
 * Session toolbar actions and the user's choice of which appear in the row (and in what
 * order). Pure: no React or DOM. The same ids feed the toolbar, the More sheet and the
 * toolbar editor; "More" itself is always shown at the end of the row and is not in the list.
 */

export const TOOLBAR_ACTIONS = [
  'pointer',
  'keyboard',
  'extra-keys',
  'paste',
  'view',
  'zoom-reset',
  'zoom-in',
  'zoom-out',
  'combos',
  'key-sets',
  'ctrl-alt-del',
  'type-clipboard',
  'clipboard',
  'files',
  'sound',
  'mic',
  'view-only',
  'options',
  'info',
  'back',
  'disconnect',
] as const;

export type ToolbarAction = (typeof TOOLBAR_ACTIONS)[number];

/** Built-in row (what `toolbarItems: null` means). */
export const DEFAULT_TOOLBAR_ITEMS: readonly ToolbarAction[] = [
  'pointer',
  'keyboard',
  'extra-keys',
  'paste',
  'view',
];

/** Longest row a user can build (the row scrolls sideways when it does not fit). */
export const MAX_TOOLBAR_ITEMS = 12;

export function isToolbarAction(v: unknown): v is ToolbarAction {
  return typeof v === 'string' && (TOOLBAR_ACTIONS as readonly string[]).includes(v);
}

/**
 * Stored value → list, or `null` for the built-in row. Unknown and repeated ids are dropped
 * (`more` too: it is always pinned at the end), the length is capped.
 */
export function normalizeToolbarItems(raw: unknown): ToolbarAction[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ToolbarAction[] = [];
  for (const v of raw as unknown[]) {
    if (isToolbarAction(v) && !out.includes(v)) out.push(v);
    if (out.length >= MAX_TOOLBAR_ITEMS) break;
  }
  return out;
}

export function resolveToolbarItems(items: readonly string[] | null | undefined): ToolbarAction[] {
  const n = normalizeToolbarItems(items);
  return n === null ? [...DEFAULT_TOOLBAR_ITEMS] : n;
}

export type ToolbarItemsEdit =
  | { readonly type: 'add'; readonly id: ToolbarAction }
  | { readonly type: 'remove'; readonly index: number }
  | { readonly type: 'move'; readonly index: number; readonly delta: -1 | 1 };

/** Applies one edit; always returns an explicit list (reset is `null`, done by the caller). */
export function editToolbarItems(
  items: readonly string[] | null | undefined,
  edit: ToolbarItemsEdit,
): ToolbarAction[] {
  const list = resolveToolbarItems(items);
  switch (edit.type) {
    case 'add':
      if (!list.includes(edit.id) && list.length < MAX_TOOLBAR_ITEMS) list.push(edit.id);
      return list;
    case 'remove':
      if (edit.index >= 0 && edit.index < list.length) list.splice(edit.index, 1);
      return list;
    case 'move': {
      const to = edit.index + edit.delta;
      if (edit.index < 0 || edit.index >= list.length || to < 0 || to >= list.length) return list;
      const [x] = list.splice(edit.index, 1);
      if (x) list.splice(to, 0, x);
      return list;
    }
  }
}

/** Actions not in the row yet (for the "Add" picker). */
export function availableToolbarActions(
  items: readonly string[] | null | undefined,
): ToolbarAction[] {
  const list = resolveToolbarItems(items);
  return TOOLBAR_ACTIONS.filter((a) => !list.includes(a));
}

export type ToolbarStyle = 'floating' | 'dock-top' | 'dock-bottom' | 'dock-left' | 'dock-right';

export const TOOLBAR_STYLES: readonly ToolbarStyle[] = [
  'dock-bottom',
  'dock-top',
  'dock-left',
  'dock-right',
  'floating',
];

/** Where the toolbar actually goes: side docks only in landscape (portrait: bottom). */
/** `away`: the side without the camera cutout (the narrowest column); see `landscapeSide`. */
export const TOOLBAR_LANDSCAPE = ['same', 'away', 'left', 'right'] as const;
export type ToolbarLandscape = (typeof TOOLBAR_LANDSCAPE)[number];

/** Which side of a landscape screen has the camera cutout (the top of the device). */
export type CutoutSide = 'left' | 'right' | 'unknown';

/**
 * From `window.orientation`: 90 is the device turned anticlockwise, its top (and camera) on
 * the left; -90 is the reverse. `screen.orientation` is not used: WebKit and Chromium
 * disagree on which landscape is "primary". `unknown` in portrait or without a value.
 */
export function cutoutSide(angle: unknown): CutoutSide {
  if (angle === 90) return 'left';
  if (angle === -90 || angle === 270) return 'right';
  return 'unknown';
}

/** The side an `away` toolbar docks to: opposite the cutout, right when it is unknown. */
export function landscapeSide(
  setting: ToolbarLandscape,
  cutout: CutoutSide,
): Exclude<ToolbarLandscape, 'away'> {
  if (setting !== 'away') return setting;
  return cutout === 'right' ? 'left' : 'right';
}

export function effectiveToolbarStyle(
  style: ToolbarStyle,
  landscape: boolean,
  side: Exclude<ToolbarLandscape, 'away'> = 'same',
): ToolbarStyle {
  if (landscape && side !== 'same' && (style === 'dock-bottom' || style === 'dock-top')) {
    return side === 'left' ? 'dock-left' : 'dock-right';
  }
  if ((style === 'dock-left' || style === 'dock-right') && !landscape) return 'dock-bottom';
  return style;
}

export interface Edges {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export const NO_EDGES: Edges = { top: 0, right: 0, bottom: 0, left: 0 };

/** Edge by edge sum (a side toolbar and the key column next to it). */
export function addEdges(a: Edges, b: Edges): Edges {
  return {
    top: a.top + b.top,
    right: a.right + b.right,
    bottom: a.bottom + b.bottom,
    left: a.left + b.left,
  };
}

/**
 * Landscape phones: where the extra key bar goes. `bottom`: the row above the keyboard (as
 * in portrait); `side`: a column on the side the toolbar does not use; `left` / `right`: a
 * column on that side (next to a toolbar docked there).
 */
export const KEY_BAR_LANDSCAPE = ['side', 'bottom', 'left', 'right'] as const;
export type KeyBarLandscape = (typeof KEY_BAR_LANDSCAPE)[number];
export type KeyBarPlacement = 'bottom' | 'left' | 'right';

/**
 * Where the key bar is laid out. A column only on a phone-sized device in landscape, and not
 * in the split layout (its key bar sits under the trackpad). `side` takes the side opposite a
 * side-docked toolbar; otherwise the side away from the camera cutout, where the column fits
 * mostly inside the safe-area strip that is dead anyway (right when the cutout is unknown).
 */
export function keyBarPlacement(opts: {
  readonly setting: KeyBarLandscape;
  readonly landscape: boolean;
  readonly phone: boolean;
  readonly split: boolean;
  readonly toolbar: ToolbarStyle;
  readonly cutout: CutoutSide;
}): KeyBarPlacement {
  const { setting, toolbar } = opts;
  if (!opts.landscape || !opts.phone || opts.split || setting === 'bottom') return 'bottom';
  if (setting === 'left' || setting === 'right') return setting;
  if (toolbar === 'dock-left') return 'right';
  if (toolbar === 'dock-right') return 'left';
  return landscapeSide('away', opts.cutout) === 'left' ? 'left' : 'right';
}

/** Space the key column reserves at its side, from its measured width (0 = not shown). */
export function columnReserve(placement: KeyBarPlacement, width: number): Edges {
  const w = Number.isFinite(width) && width > 0 ? Math.round(width) : 0;
  if (placement === 'left') return { ...NO_EDGES, left: w };
  if (placement === 'right') return { ...NO_EDGES, right: w };
  return NO_EDGES;
}

/**
 * Space a docked toolbar reserves at its edge of the session (CSS px, safe-area padding
 * included), from the toolbar's measured size. Floating reserves nothing.
 */
export function dockReserve(
  style: ToolbarStyle,
  size: { readonly width: number; readonly height: number } | null,
): Edges {
  if (!size || style === 'floating') return NO_EDGES;
  const clamp = (v: number) => (Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
  switch (style) {
    case 'dock-top':
      return { ...NO_EDGES, top: clamp(size.height) };
    case 'dock-bottom':
      return { ...NO_EDGES, bottom: clamp(size.height) };
    case 'dock-left':
      return { ...NO_EDGES, left: clamp(size.width) };
    case 'dock-right':
      return { ...NO_EDGES, right: clamp(size.width) };
  }
}
