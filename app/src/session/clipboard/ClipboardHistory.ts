/**
 * In-session clipboard history (CLP-5): the last few texts received from or sent to the
 * remote, newest first, for this session only. Memory only: the caller never persists it.
 *
 * Pure: no DOM, no library imports.
 */

export type ClipboardDirection = 'from-remote' | 'to-remote';

export interface ClipboardItem {
  readonly id: number;
  readonly text: string;
  readonly direction: ClipboardDirection;
  readonly at: number;
}

export interface ClipboardHistory {
  readonly items: readonly ClipboardItem[];
  /** Last text received from the remote, or null. */
  readonly lastRemote: string | null;
  readonly nextId: number;
}

export const EMPTY_CLIPBOARD_HISTORY: ClipboardHistory = {
  items: [],
  lastRemote: null,
  nextId: 1,
};

export const MAX_CLIPBOARD_ITEMS = 8;
/** Longer texts are kept, but only this many characters (they are still sent in full). */
export const MAX_CLIPBOARD_ITEM_CHARS = 20000;

export type ClipboardEvent =
  | {
      readonly type: 'add';
      readonly text: string;
      readonly direction: ClipboardDirection;
      readonly at: number;
    }
  | { readonly type: 'remove'; readonly id: number }
  | { readonly type: 'clear' };

export function reduceClipboard(h: ClipboardHistory, e: ClipboardEvent): ClipboardHistory {
  switch (e.type) {
    case 'clear':
      return { ...EMPTY_CLIPBOARD_HISTORY, nextId: h.nextId };
    case 'remove': {
      const items = h.items.filter((i) => i.id !== e.id);
      return items.length === h.items.length ? h : { ...h, items };
    }
    case 'add': {
      if (e.text === '') return h;
      const text =
        e.text.length > MAX_CLIPBOARD_ITEM_CHARS
          ? e.text.slice(0, MAX_CLIPBOARD_ITEM_CHARS)
          : e.text;
      const lastRemote = e.direction === 'from-remote' ? text : h.lastRemote;
      // The same text again moves to the top instead of appearing twice.
      const rest = h.items.filter((i) => i.text !== text);
      const item: ClipboardItem = { id: h.nextId, text, direction: e.direction, at: e.at };
      return {
        items: [item, ...rest].slice(0, MAX_CLIPBOARD_ITEMS),
        lastRemote,
        nextId: h.nextId + 1,
      };
    }
  }
}

/** One-line preview: whitespace collapsed, ellipsis after `max` characters. */
export function previewText(text: string, max = 80): string {
  const one = text.replace(/\s+/g, ' ').trim();
  const chars = [...one];
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : one;
}
