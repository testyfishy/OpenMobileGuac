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
export function effectiveToolbarStyle(style: ToolbarStyle, landscape: boolean): ToolbarStyle {
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
