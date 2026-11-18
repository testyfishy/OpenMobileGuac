import { useEffect, useRef, type ReactNode } from 'react';
import { strings } from '../strings.ts';
import { Icon, type IconName } from './Icon.tsx';

export interface ScreenProps {
  title: string;
  /** Shows a back button that calls this. */
  onBack?: () => void;
  /** Buttons on the right of the header. */
  actions?: ReactNode;
  /** Content above the scroll area (search box). */
  toolbar?: ReactNode;
  children: ReactNode;
  /** Focus the heading when the screen appears (screen-reader orientation). */
  focusTitle?: boolean;
  className?: string;
}

/** A full-height screen: safe-area-aware header plus a scrolling body. */
export function Screen({
  title,
  onBack,
  actions,
  toolbar,
  children,
  focusTitle = true,
  className,
}: ScreenProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusTitle) heading.current?.focus({ preventScroll: true });
  }, [focusTitle]);
  return (
    <section className={className ? `screen ${className}` : 'screen'} aria-label={title}>
      <header className="screen-header">
        {onBack ? (
          <button
            type="button"
            className="icon-btn"
            onClick={onBack}
            aria-label={strings.common.back}
          >
            <Icon name="back" />
          </button>
        ) : (
          <span className="screen-header-spacer" />
        )}
        <h1 className="screen-title" ref={heading} tabIndex={-1}>
          {title}
        </h1>
        <div className="screen-actions">{actions}</div>
      </header>
      {toolbar ? <div className="screen-toolbar">{toolbar}</div> : null}
      <div className="screen-body">{children}</div>
    </section>
  );
}

export function IconButton({
  icon,
  label,
  onClick,
  disabled,
  pressed,
  className,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={className ? `icon-btn ${className}` : 'icon-btn'}
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
      aria-pressed={pressed}
    >
      <Icon name={icon} />
    </button>
  );
}
