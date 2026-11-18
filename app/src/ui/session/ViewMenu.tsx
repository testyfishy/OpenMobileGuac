import { FIT_MODES, type FitMode } from '../../session/viewport/Viewport.ts';
import { ChromeButton } from './ChromeButton.tsx';
import { FIT_MODE_LABELS } from './settings.ts';
import { Sheet } from './Sheet.tsx';

export interface ViewMenuProps {
  readonly fitMode: FitMode;
  readonly matchDeviceSize: boolean;
  readonly protocol?: string;
  readonly onFitMode: (mode: FitMode) => void;
  readonly onResetZoom: () => void;
  readonly onMatchDeviceSize: (on: boolean) => void;
  readonly onClose: () => void;
}

const DESCRIPTIONS: Record<FitMode, string> = {
  'fit-screen': 'Whole desktop visible',
  'fit-width': 'Fill the width, scroll down',
  'fit-height': 'Fill the height, scroll sideways',
  'one-to-one': 'One remote pixel per screen pixel',
};

/** DSP-1 view modes, reset zoom (DSP-2) and "match device size" (DSP-4). */
export function ViewMenu({
  fitMode,
  matchDeviceSize,
  protocol,
  onFitMode,
  onResetZoom,
  onMatchDeviceSize,
  onClose,
}: ViewMenuProps) {
  return (
    <Sheet title="View" onClose={onClose}>
      <div className="omg-choice-list" role="radiogroup" aria-label="View mode">
        {FIT_MODES.map((m) => (
          <ChromeButton
            key={m}
            role="radio"
            aria-checked={m === fitMode}
            className={m === fitMode ? 'omg-choice omg-choice--on' : 'omg-choice'}
            onClick={() => onFitMode(m)}
          >
            <span className="omg-choice__label">{FIT_MODE_LABELS[m]}</span>
            <span className="omg-choice__hint">{DESCRIPTIONS[m]}</span>
          </ChromeButton>
        ))}
      </div>
      <div className="omg-sheet__actions">
        <ChromeButton className="omg-btn--ghost" onClick={onResetZoom}>
          Reset zoom
        </ChromeButton>
      </div>
      <ChromeButton
        role="switch"
        aria-checked={matchDeviceSize}
        className="omg-switch-row"
        onClick={() => onMatchDeviceSize(!matchDeviceSize)}
      >
        <span>
          <span className="omg-choice__label">Match device size</span>
          <span className="omg-choice__hint">
            {protocol === 'vnc'
              ? 'Most VNC servers cannot resize; the request may be ignored'
              : 'Ask the remote to resize to this screen (RDP with display update, SSH)'}
          </span>
        </span>
        <span
          className={matchDeviceSize ? 'omg-switch omg-switch--on' : 'omg-switch'}
          aria-hidden="true"
        />
      </ChromeButton>
    </Sheet>
  );
}
