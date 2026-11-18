import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useBackInterceptor } from '../nav/NavContext.ts';

const FOCUSABLE = 'button, input, [href], [tabindex]:not([tabindex="-1"])';

/**
 * A modal dialog. Back (hardware or Escape) cancels it. Focus moves into the dialog when it
 * opens, is kept inside while open, and returns to the previous element when it closes.
 */
export function Dialog({
  title,
  children,
  actions,
  onCancel,
  tone,
}: {
  title: string;
  children?: ReactNode;
  actions: ReactNode;
  onCancel: () => void;
  tone?: 'danger' | 'warning';
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useBackInterceptor(true, onCancel);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => previous?.focus();
  }, []);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key !== 'Tab' || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => !el.hasAttribute('disabled'),
    );
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div
        ref={ref}
        className={tone ? `dialog dialog-${tone}` : 'dialog'}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className="dialog-title">
          {title}
        </h2>
        <div className="dialog-body">{children}</div>
        <div className="dialog-actions">{actions}</div>
      </div>
    </div>
  );
}
