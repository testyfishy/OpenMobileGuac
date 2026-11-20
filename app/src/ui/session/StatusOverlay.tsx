import { useEffect, useState } from 'react';
import { sessionStrings } from './sessionStrings.ts';
import type { SessionPhase } from './status.ts';

export interface StatusOverlayProps {
  readonly phase: SessionPhase;
  readonly title: string;
  readonly onRetry: () => void;
  readonly onClose: () => void;
}

/** Connection-state overlay (DSP-9): connecting, reconnecting, error, disconnected. */
/**
 * A first connect still running after this long gets the "waking" explanation: with
 * Wake-on-LAN configured (`wol-send-packet`, guacd waits `wol-boot-wait-time` before
 * connecting) the server is starting the computer, which takes a while. The WebSocket
 * tunnel's own pings (echoed by the web application every 500 ms) keep it from timing out
 * meanwhile, so the app just waits; Cancel stays available.
 */
export const WAKING_AFTER_MS = 8000;

export function StatusOverlay({ phase, title, onRetry, onClose }: StatusOverlayProps) {
  const connecting = phase.kind === 'connecting';
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!connecting) return undefined;
    const timer = setTimeout(() => setSlow(true), WAKING_AFTER_MS);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [connecting]);
  if (phase.kind === 'connected') return null;
  const t = sessionStrings.status;
  const c = sessionStrings.common;
  const busy = phase.kind === 'connecting' || phase.kind === 'reconnecting';
  let heading: string;
  let detail: string | null = null;
  switch (phase.kind) {
    case 'connecting':
      heading = slow ? t.waking : t.connecting(title);
      if (slow) detail = t.wakingDetail;
      break;
    case 'reconnecting':
      if (phase.waitingForNetwork) {
        heading = t.waitingForNetwork;
        detail = t.waitingForNetworkDetail;
      } else {
        heading = t.reconnecting;
        detail = t.attempt(phase.reason, phase.attempt, phase.maxAttempts);
      }
      break;
    case 'error':
      heading = phase.heading ?? t.headings.couldNotConnect;
      detail = phase.message;
      break;
    case 'disconnected':
      heading = phase.byServer ? t.sessionEnded : t.disconnected;
      detail = phase.byServer ? t.endedByRemote(title) : t.ended(title);
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
              {phase.kind === 'disconnected' ? t.reconnect : t.retry}
            </button>
          )}
          <button type="button" className="omg-btn omg-btn--ghost" onClick={onClose}>
            {busy ? c.cancel : c.close}
          </button>
        </div>
      </div>
    </div>
  );
}
