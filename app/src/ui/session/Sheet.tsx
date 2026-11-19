import { useEffect, type ReactNode } from 'react';
import { ChromeButton } from './ChromeButton.tsx';
import { IconClose } from './icons.tsx';

/**
 * A bottom sheet / popover for session menus. Escape, the close button or (when
 * `dismissible`, the default) the backdrop closes it.
 */
export function Sheet({
  title,
  onClose,
  children,
  dismissible = true,
  closeLabel = 'Close',
  className,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Close on a backdrop tap (off for prompts that must be answered). */
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
      >
        <header className="omg-sheet__header">
          <h2 className="omg-sheet__title">{title}</h2>
          <ChromeButton className="omg-btn--icon" aria-label={closeLabel} onClick={onClose}>
            <IconClose />
          </ChromeButton>
        </header>
        <div className="omg-sheet__body">{children}</div>
      </section>
    </div>
  );
}
