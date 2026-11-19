import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useBackInterceptor } from '../nav/NavContext.ts';
import { strings } from '../strings.ts';
import { Icon } from './Icon.tsx';

/** A bottom sheet (centred dialog on wide screens). Back / Escape / backdrop close it. */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useBackInterceptor(true, onClose);
  useEffect(() => {
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.querySelector<HTMLElement>('h2')?.focus();
    return () => prev?.focus();
  }, []);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        ref={ref}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="sheet-header">
          <h2 id={titleId} className="sheet-title" tabIndex={-1}>
            {title}
          </h2>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label={strings.common.close}
          >
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
