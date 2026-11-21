/**
 * Marks a scrollable row or column with where more content lies, so CSS can fade that
 * edge (`.omg-scrollhint` in SessionScreen.css). Use as a React ref callback:
 * `<div ref={scrollHint} className="omg-scrollhint">`.
 *
 * Sets `data-axis` (`x` | `y`) and `data-more` (`none` | `start` | `end` | `both`).
 */
export type ScrollMore = 'none' | 'start' | 'end' | 'both';

/** Pure part: which edges hide content, for a scroll offset and the scrollable distance. */
export function scrollMore(offset: number, max: number): ScrollMore {
  if (max <= 1) return 'none';
  // RTL rows report negative offsets.
  const pos = Math.abs(offset);
  const start = pos > 1;
  const end = pos < max - 1;
  return start && end ? 'both' : start ? 'start' : end ? 'end' : 'none';
}

export function scrollHint(el: HTMLElement | null): (() => void) | undefined {
  if (!el) return undefined;
  const update = () => {
    const maxX = el.scrollWidth - el.clientWidth;
    const maxY = el.scrollHeight - el.clientHeight;
    const vertical = maxY > 1 && maxX <= 1;
    el.dataset['axis'] = vertical ? 'y' : 'x';
    el.dataset['more'] = vertical
      ? scrollMore(el.scrollTop, maxY)
      : scrollMore(el.scrollLeft, maxX);
  };
  el.addEventListener('scroll', update, { passive: true });
  const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
  ro?.observe(el);
  const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(update);
  mo?.observe(el, { childList: true, subtree: true });
  update();
  return () => {
    el.removeEventListener('scroll', update);
    ro?.disconnect();
    mo?.disconnect();
  };
}
