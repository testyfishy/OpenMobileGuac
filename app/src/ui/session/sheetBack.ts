import { createContext } from 'react';

/**
 * Set by the session screen when the open sheet was reached from another one (More →
 * Options, say): the sheet then shows a Back button that returns to it. Null: no Back.
 */
export const SheetBackContext = createContext<(() => void) | null>(null);

/**
 * Whether a downward swipe on a sheet's header closes it (`sheetSwipeClose`). Provided by
 * the session screen; the backdrop tap and the close button work either way.
 */
export const SheetSwipeContext = createContext<boolean>(true);

/**
 * Whether a sheet's layer is the one on top: the last of the open layers in document order
 * (they share one z-index, so the later one paints over the earlier). Unknown (`self`
 * null): treat it as on top. Pure.
 */
export function isTopmostLayer(self: unknown, layers: ArrayLike<unknown>): boolean {
  if (self === null || self === undefined || layers.length === 0) return true;
  return layers[layers.length - 1] === self;
}
