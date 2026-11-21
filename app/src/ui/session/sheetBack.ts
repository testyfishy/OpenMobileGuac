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
