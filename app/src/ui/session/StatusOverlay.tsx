import type { SessionPhase } from './status.ts';

export interface StatusOverlayProps {
  readonly phase: SessionPhase;
  readonly title: string;
  readonly onRetry: () => void;
  readonly onClose: () => void;
}

/** Connection-state overlay (DSP-9): connecting, reconnecting, error, disconnected. */
export function StatusOverlay({ phase, title, onRetry, onClose }: StatusOverlayProps) {
  if (phase.kind === 'connected') return null;
  const busy = phase.kind === 'connecting' || phase.kind === 'reconnecting';
  let heading: string;
  let detail: string | null = null;
  switch (phase.kind) {
    case 'connecting':
      heading = `Connecting to ${title}…`;
      break;
    case 'reconnecting':
      heading = 'Connection lost. Reconnecting…';
      detail = `${phase.reason} Attempt ${phase.attempt} of ${phase.maxAttempts}.`;
      break;
    case 'error':
      heading = 'Could not connect';
      detail = phase.message;
      break;
    case 'disconnected':
      heading = 'Disconnected';
      detail = `The session with ${title} has ended.`;
      break;
  }
  return (
    <div
      className={busy ? 'omg-overlay omg-overlay--busy' : 'omg-overlay'}
      role={phase.kind === 'error' ? 'alert' : 'status'}
      aria-live="polite"
    >
      <div className="omg-overlay__card">
        {busy && <div className="omg-spinner" aria-hidden="true" />}
        <p className="omg-overlay__heading">{heading}</p>
        {detail && <p className="omg-overlay__detail">{detail}</p>}
        <div className="omg-overlay__actions">
          {!busy && (
            <button type="button" className="omg-btn omg-btn--primary" onClick={onRetry}>
              {phase.kind === 'disconnected' ? 'Reconnect' : 'Retry'}
            </button>
          )}
          <button type="button" className="omg-btn omg-btn--ghost" onClick={onClose}>
            {busy ? 'Cancel' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
