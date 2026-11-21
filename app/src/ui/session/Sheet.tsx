import { useContext, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { ChromeButton } from './ChromeButton.tsx';
import { IconBack, IconClose } from './icons.tsx';
import { SheetBackContext, SheetSwipeContext } from './sheetBack.ts';
import { sessionStrings } from './sessionStrings.ts';

/** Downward drag (px) on the header that closes the sheet. */
const SWIPE_CLOSE_PX = 72;
/** How long a sheet takes to follow the keyboard (about the system keyboard's own slide). */
const SHEET_MOVE_MS = 260;

/**
 * A bottom sheet / popover for session menus. Escape, the close button or (when
 * `dismissible`, the default) a backdrop tap or a downward swipe on the header closes it
 * (the swipe can be switched off: `SheetSwipeContext`).
 */
export function Sheet({
  title,
  onClose,
  children,
  dismissible = true,
  closeLabel = sessionStrings.common.close,
  className,
  layerClassName,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Close on a backdrop tap or swipe (off for prompts that must be answered). */
  dismissible?: boolean;
  closeLabel?: string;
  className?: string;
  /** Extra class on the layer (e.g. `omg-sheet-layer--card`: a centred card, not a bottom sheet). */
  layerClassName?: string;
}) {
  const onBack = useContext(SheetBackContext);
  const swipeSetting = useContext(SheetSwipeContext);
  const swipeClose = dismissible && swipeSetting;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // When the space above the keyboard changes (it opens, closes, or the phone turns), the
  // sheet glides to its new place instead of jumping there.
  const sheetRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = sheetRef.current;
    const layer = el?.parentElement;
    if (!el || !layer || typeof ResizeObserver === 'undefined' || !el.animate) return;
    const place = () => {
      const r = layer.getBoundingClientRect();
      return { top: r.top + el.offsetTop, height: r.height };
    };
    let last = place();
    const moved = () => {
      const next = place();
      const dy = last.top - next.top;
      const resized = Math.abs(next.height - last.height) > 1;
      last = next;
      if (!resized || Math.abs(dy) < 8) return;
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
      el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], {
        duration: SHEET_MOVE_MS,
        easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      });
    };
    const ro = new ResizeObserver(moved);
    ro.observe(layer);
    return () => ro.disconnect();
  }, []);

  const drag = useRef<{ id: number; y: number } | null>(null);
  const [offset, setOffset] = useState(0);
  const onDown = (e: PointerEvent<HTMLElement>) => {
    if (!swipeClose || !e.isPrimary) return;
    if ((e.target as HTMLElement).closest('button')) return;
    drag.current = { id: e.pointerId, y: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    setOffset(Math.max(0, e.clientY - d.y));
  };
  const onUp = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const dy = e.clientY - d.y;
    setOffset(0);
    if (dy > SWIPE_CLOSE_PX) onClose();
  };
  const onCancel = () => {
    drag.current = null;
    setOffset(0);
  };

  return (
    <div className={layerClassName ? `omg-sheet-layer ${layerClassName}` : 'omg-sheet-layer'}>
      <div
        className="omg-sheet-backdrop"
        onPointerDown={dismissible ? onClose : undefined}
        aria-hidden="true"
      />
      <section
        ref={sheetRef}
        className={className ? `omg-sheet ${className}` : 'omg-sheet'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={offset > 0 ? { transform: `translateY(${offset}px)` } : undefined}
      >
        <header
          className={
            (swipeClose ? 'omg-sheet__header omg-sheet__header--drag' : 'omg-sheet__header') +
            (onBack ? ' omg-sheet__header--back' : '')
          }
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onCancel}
        >
          {swipeClose && <span className="omg-sheet__grip" aria-hidden="true" />}
          {onBack && (
            <ChromeButton
              className="omg-btn--icon omg-sheet__back"
              aria-label={sessionStrings.common.back}
              title={sessionStrings.common.back}
              onClick={onBack}
            >
              <IconBack />
            </ChromeButton>
          )}
          <h2 className="omg-sheet__title">{title}</h2>
          <ChromeButton
            className="omg-btn--icon omg-sheet__close"
            aria-label={closeLabel}
            onClick={onClose}
          >
            <IconClose />
          </ChromeButton>
        </header>
        <div className="omg-sheet__body">{children}</div>
      </section>
    </div>
  );
}
