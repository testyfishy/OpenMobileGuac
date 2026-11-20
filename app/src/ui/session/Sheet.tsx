import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { ChromeButton } from './ChromeButton.tsx';
import { IconClose } from './icons.tsx';
import { sessionStrings } from './sessionStrings.ts';

/** Downward drag (px) on the header that closes the sheet. */
const SWIPE_CLOSE_PX = 72;

/**
 * A bottom sheet / popover for session menus. Escape, the close button or (when
 * `dismissible`, the default) a backdrop tap or a downward swipe on the header closes it.
 */
export function Sheet({
  title,
  onClose,
  children,
  dismissible = true,
  closeLabel = sessionStrings.common.close,
  className,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Close on a backdrop tap or swipe (off for prompts that must be answered). */
  dismissible?: boolean;
  closeLabel?: string;
  className?: string;
}) {
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

  const drag = useRef<{ id: number; y: number } | null>(null);
  const [offset, setOffset] = useState(0);
  const onDown = (e: PointerEvent<HTMLElement>) => {
    if (!dismissible || !e.isPrimary) return;
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
    <div className="omg-sheet-layer">
      <div
        className="omg-sheet-backdrop"
        onPointerDown={dismissible ? onClose : undefined}
        aria-hidden="true"
      />
      <section
        className={className ? `omg-sheet ${className}` : 'omg-sheet'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={offset > 0 ? { transform: `translateY(${offset}px)` } : undefined}
      >
        <header
          className={
            dismissible ? 'omg-sheet__header omg-sheet__header--drag' : 'omg-sheet__header'
          }
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onCancel}
        >
          {dismissible && <span className="omg-sheet__grip" aria-hidden="true" />}
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
