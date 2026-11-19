import { FIT_MODES, type FitMode } from '../../session/viewport/Viewport.ts';
import { ChromeButton } from './ChromeButton.tsx';
import { sessionStrings } from './sessionStrings.ts';
import { Sheet } from './Sheet.tsx';

export interface ViewMenuProps {
  readonly fitMode: FitMode;
  readonly matchDeviceSize: boolean;
  readonly protocol?: string;
  readonly onFitMode: (mode: FitMode) => void;
  readonly onResetZoom: () => void;
  readonly onZoom: (factor: number) => void;
  readonly onMatchDeviceSize: (on: boolean) => void;
  readonly onClose: () => void;
}

/** DSP-1 view modes, reset zoom (DSP-2) and "match device size" (DSP-4). */
export function ViewMenu({
  fitMode,
  matchDeviceSize,
  protocol,
  onFitMode,
  onResetZoom,
  onZoom,
  onMatchDeviceSize,
  onClose,
}: ViewMenuProps) {
  const t = sessionStrings.view;
  const fit = sessionStrings.fitModes;
  return (
    <Sheet title={t.title} onClose={onClose}>
      <div className="omg-choice-list" role="radiogroup" aria-label={t.modeGroup}>
        {FIT_MODES.map((m) => (
          <ChromeButton
            key={m}
            role="radio"
            aria-checked={m === fitMode}
            className={m === fitMode ? 'omg-choice omg-choice--on' : 'omg-choice'}
            onClick={() => onFitMode(m)}
          >
            <span className="omg-choice__label">{fit.labels[m]}</span>
            <span className="omg-choice__hint">{fit.hints[m]}</span>
          </ChromeButton>
        ))}
      </div>
      <div className="omg-sheet__actions">
        <ChromeButton
          className="omg-btn--ghost"
          onClick={() => onZoom(0.8)}
          aria-label={sessionStrings.toolbar.zoomOut}
        >
          {t.zoomOutButton}
        </ChromeButton>
        <ChromeButton
          className="omg-btn--ghost"
          onClick={() => onZoom(1.25)}
          aria-label={sessionStrings.toolbar.zoomIn}
        >
          {t.zoomInButton}
        </ChromeButton>
        <ChromeButton className="omg-btn--ghost" onClick={onResetZoom}>
          {t.resetZoom}
        </ChromeButton>
      </div>
      <p className="omg-muted">{t.tip}</p>
      <ChromeButton
        role="switch"
        aria-checked={matchDeviceSize}
        className="omg-switch-row"
        onClick={() => onMatchDeviceSize(!matchDeviceSize)}
      >
        <span>
          <span className="omg-choice__label">{t.matchDevice}</span>
          <span className="omg-choice__hint">
            {protocol === 'vnc' ? t.matchHintVnc : t.matchHint}
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
