import { createContext } from 'react';

/**
 * Set by the session screen when the open sheet was reached from another one (More →
 * Options, say): the sheet then shows a Back button that returns to it. Null: no Back.
 */
export const SheetBackContext = createContext<(() => void) | null>(null);
