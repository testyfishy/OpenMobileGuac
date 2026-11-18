import type { ReactNode } from 'react';
import type { UiError } from '../errors/errorMessages.ts';
import { Icon, type IconName } from './Icon.tsx';

export function Spinner({ label }: { label: string }) {
  return (
    <div className="spinner-wrap" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon: IconName;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Icon name={icon} size="2.5rem" />
      <p className="empty-title">{title}</p>
      {children}
    </div>
  );
}

export function ErrorBanner({ error, children }: { error: UiError; children?: ReactNode }) {
  return (
    <div className="banner banner-error" role="alert" data-error-code={error.code}>
      <Icon name="alert" />
      <div>
        <p className="banner-title">{error.title}</p>
        {error.detail ? <p className="banner-detail">{error.detail}</p> : null}
        {children}
      </div>
    </div>
  );
}

export function InfoBanner({
  children,
  tone = 'info',
  icon = 'alert',
}: {
  children: ReactNode;
  tone?: 'info' | 'warning';
  icon?: IconName;
}) {
  return (
    <div className={`banner banner-${tone}`} role="note">
      <Icon name={icon} />
      <div>{children}</div>
    </div>
  );
}
