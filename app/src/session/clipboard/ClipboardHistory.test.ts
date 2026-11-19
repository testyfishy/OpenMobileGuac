import { describe, expect, it } from 'vitest';
import {
  EMPTY_CLIPBOARD_HISTORY,
  MAX_CLIPBOARD_ITEMS,
  previewText,
  reduceClipboard,
  type ClipboardEvent,
} from './ClipboardHistory.ts';

const run = (events: ClipboardEvent[]) => events.reduce(reduceClipboard, EMPTY_CLIPBOARD_HISTORY);

describe('clipboard history', () => {
  it('keeps the newest first and remembers the last remote text', () => {
    const h = run([
      { type: 'add', text: 'one', direction: 'from-remote', at: 1 },
      { type: 'add', text: 'two', direction: 'to-remote', at: 2 },
    ]);
    expect(h.items.map((i) => i.text)).toEqual(['two', 'one']);
    expect(h.lastRemote).toBe('one');
  });

  it('moves a repeated text to the top', () => {
    const h = run([
      { type: 'add', text: 'a', direction: 'from-remote', at: 1 },
      { type: 'add', text: 'b', direction: 'from-remote', at: 2 },
      { type: 'add', text: 'a', direction: 'to-remote', at: 3 },
    ]);
    expect(h.items.map((i) => `${i.text}:${i.direction}`)).toEqual([
      'a:to-remote',
      'b:from-remote',
    ]);
  });

  it('is bounded, ignores empty text, and clears', () => {
    const events: ClipboardEvent[] = [];
    for (let i = 0; i < MAX_CLIPBOARD_ITEMS + 3; i++) {
      events.push({ type: 'add', text: `t${i}`, direction: 'from-remote', at: i });
    }
    events.push({ type: 'add', text: '', direction: 'from-remote', at: 99 });
    const h = run(events);
    expect(h.items).toHaveLength(MAX_CLIPBOARD_ITEMS);
    expect(h.lastRemote).toBe(`t${MAX_CLIPBOARD_ITEMS + 2}`);
    const cleared = reduceClipboard(h, { type: 'clear' });
    expect(cleared.items).toEqual([]);
    expect(cleared.lastRemote).toBeNull();
    expect(cleared.nextId).toBe(h.nextId);
  });

  it('removes one item', () => {
    const h = run([{ type: 'add', text: 'x', direction: 'to-remote', at: 1 }]);
    const id = h.items[0]?.id ?? -1;
    expect(reduceClipboard(h, { type: 'remove', id }).items).toEqual([]);
  });

  it('previews on one line', () => {
    expect(previewText('a\n  b\tc')).toBe('a b c');
    expect(previewText('abcdef', 4)).toBe('abc…');
  });
});
