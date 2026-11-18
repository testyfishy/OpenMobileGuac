import type { ButtonHTMLAttributes, PointerEvent, MouseEvent, ReactNode } from 'react';

/**
 * A button for the session chrome that does not steal focus from the hidden text field:
 * `pointerdown` / `mousedown` default actions (which move focus) are prevented, and the
 * action runs on `click`. `touchstart` is deliberately left alone, since preventing it
 * would also cancel the click on mobile browsers.
 */
export function ChromeButton({
  children,
  className,
  onPointerDown,
  onMouseDown,
  type,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      type={type ?? 'button'}
      className={className ? `omg-btn ${className}` : 'omg-btn'}
      onPointerDown={(e: PointerEvent<HTMLButtonElement>) => {
        e.preventDefault();
        onPointerDown?.(e);
      }}
      onMouseDown={(e: MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        onMouseDown?.(e);
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
