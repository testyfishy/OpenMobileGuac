import { useRef, useState, type ReactNode, type TouchEvent } from 'react';
import { strings } from '../strings.ts';

const THRESHOLD_PX = 64;
const MAX_PULL_PX = 96;

/**
 * Pull-to-refresh for touch screens (CON-2). Activates only when the enclosing scroller is
 * at the top. A visible refresh button elsewhere covers mouse, keyboard and screen readers.
 */
export function PullToRefresh({
  onRefresh,
  refreshing,
  children,
}: {
  onRefresh: () => void;
  refreshing: boolean;
  children: ReactNode;
}) {
  const start = useRef<number | null>(null);
  const [pull, setPull] = useState(0);

  const scroller = (el: HTMLElement): HTMLElement | null => el.closest('.screen-body');

  const onTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    const sc = scroller(e.currentTarget);
    start.current =
      e.touches.length === 1 && (sc?.scrollTop ?? 0) <= 0 ? (e.touches[0]?.clientY ?? null) : null;
  };
  const onTouchMove = (e: TouchEvent<HTMLDivElement>) => {
    if (start.current === null || refreshing) return;
    const dy = (e.touches[0]?.clientY ?? start.current) - start.current;
    setPull(dy > 0 ? Math.min(MAX_PULL_PX, dy * 0.5) : 0);
  };
  const onTouchEnd = () => {
    if (start.current !== null && pull >= THRESHOLD_PX * 0.75 && !refreshing) onRefresh();
    start.current = null;
    setPull(0);
  };

  const label = refreshing
    ? strings.connections.refreshing
    : pull >= THRESHOLD_PX * 0.75
      ? strings.connections.releaseToRefresh
      : strings.connections.pullToRefresh;

  return (
    <div
      className="ptr"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      <div
        className="ptr-indicator"
        style={{ height: refreshing ? '2.5rem' : `${pull}px` }}
        aria-hidden={!refreshing}
        aria-live="polite"
      >
        {refreshing || pull > 8 ? (
          <>
            <span
              className={refreshing ? 'spinner spinner-small' : 'ptr-arrow'}
              aria-hidden="true"
            />
            <span>{label}</span>
          </>
        ) : null}
      </div>
      {children}
    </div>
  );
}
