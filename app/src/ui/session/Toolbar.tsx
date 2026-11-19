import { useRef } from 'react';
import type { PointerMode } from '../../session/pointer/PointerModel.ts';
import { ChromeButton } from './ChromeButton.tsx';
import {
  IconChevronDown,
  IconKeyboard,
  IconMenu,
  IconMore,
  IconMultiTouch,
  IconPaste,
  IconTouch,
  IconTrackpad,
  IconView,
  IconZoomIn,
  IconZoomOut,
} from './icons.tsx';

export interface ToolbarProps {
  readonly expanded: boolean;
  readonly onExpandedChange: (expanded: boolean) => void;
  readonly pointerMode: PointerMode;
  readonly onTogglePointerMode: () => void;
  readonly onOpenView: () => void;
  /** Shown in touch pass-through mode, where pinch goes to the remote. */
  readonly onZoom?: (factor: number) => void;
  /** Immersive: the collapsed handle becomes a thin edge grip. */
  readonly immersive?: boolean;
  readonly keyboardActive: boolean;
  readonly onToggleKeyboard: () => void;
  /** Hide the paste button (no clipboard path for this protocol). */
  readonly showPaste?: boolean;
  /** Accessible description of what Paste does for this protocol. */
  readonly pasteHint?: string;
  readonly onPaste: () => void;
  readonly onTypeClipboard: () => void;
  readonly onOpenMore: () => void;
  /** Small count on the More button (running transfers). */
  readonly moreBadge?: number;
  /** Interaction anywhere in the toolbar (resets the auto-hide timer). */
  readonly onActivity: () => void;
}

const LONG_PRESS_MS = 500;

/**
 * Session toolbar: one compact row at the bottom edge (thumb reach in portrait and
 * landscape) with pointer mode, keyboard, paste, view and More; everything else is in the
 * More sheet. It collapses to a small handle on the right edge, above the bottom 60 px of
 * the desktop (taskbars, status lines). Buttons never take focus from the hidden field.
 */
export function Toolbar(props: ToolbarProps) {
  const { expanded, onExpandedChange, pointerMode, keyboardActive, onActivity } = props;
  const pressStart = useRef<number | null>(null);
  const longPressed = useRef(false);

  if (!expanded) {
    return (
      <div className="omg-toolbar omg-toolbar--collapsed">
        <ChromeButton
          className={props.immersive ? 'omg-handle omg-handle--grip' : 'omg-handle'}
          aria-label="Show session toolbar"
          aria-expanded={false}
          onClick={() => onExpandedChange(true)}
        >
          <IconMenu />
          {(props.moreBadge ?? 0) > 0 && <span className="omg-badge-dot" aria-hidden="true" />}
        </ChromeButton>
      </div>
    );
  }

  const trackpad = pointerMode === 'trackpad';
  const touch = pointerMode === 'touch';
  const modeLabel = trackpad ? 'Trackpad' : touch ? 'Multi-touch' : 'Touch';
  const badge = props.moreBadge ?? 0;
  return (
    <div
      className="omg-toolbar"
      role="toolbar"
      aria-label="Session"
      onPointerDownCapture={onActivity}
      onKeyDownCapture={onActivity}
    >
      <div className="omg-toolbar__scroll">
        <ChromeButton
          className={
            trackpad ? 'omg-tool omg-tool--mode-trackpad' : 'omg-tool omg-tool--mode-direct'
          }
          aria-label={`Pointer: ${modeLabel}. Switch pointer mode`}
          onClick={props.onTogglePointerMode}
        >
          {trackpad ? <IconTrackpad /> : touch ? <IconMultiTouch /> : <IconTouch />}
          <span className="omg-tool__label">{modeLabel}</span>
        </ChromeButton>
        <ChromeButton
          className={keyboardActive ? 'omg-tool omg-tool--on' : 'omg-tool'}
          aria-label={keyboardActive ? 'Hide keyboard' : 'Show keyboard'}
          aria-pressed={keyboardActive}
          onClick={props.onToggleKeyboard}
        >
          <IconKeyboard />
          <span className="omg-tool__label">Keyboard</span>
        </ChromeButton>
        {props.showPaste !== false && (
          <ChromeButton
            className="omg-tool"
            aria-label={`${props.pasteHint ?? 'Paste device clipboard to the remote'}. Long press to type it instead`}
            onPointerDown={() => {
              pressStart.current = performance.now();
              longPressed.current = false;
            }}
            onPointerUp={() => {
              const start = pressStart.current;
              pressStart.current = null;
              if (start !== null && performance.now() - start >= LONG_PRESS_MS) {
                longPressed.current = true;
                props.onTypeClipboard();
              }
            }}
            onPointerCancel={() => {
              pressStart.current = null;
            }}
            onContextMenu={(e) => e.preventDefault()}
            onClick={() => {
              if (longPressed.current) {
                longPressed.current = false;
                return;
              }
              props.onPaste();
            }}
          >
            <IconPaste />
            <span className="omg-tool__label">Paste</span>
          </ChromeButton>
        )}
        {touch && props.onZoom && (
          <>
            <ChromeButton
              className="omg-tool"
              aria-label="Zoom in"
              onClick={() => props.onZoom?.(1.25)}
            >
              <IconZoomIn />
              <span className="omg-tool__label">Zoom</span>
            </ChromeButton>
            <ChromeButton
              className="omg-tool"
              aria-label="Zoom out"
              onClick={() => props.onZoom?.(0.8)}
            >
              <IconZoomOut />
              <span className="omg-tool__label">Out</span>
            </ChromeButton>
          </>
        )}
        <ChromeButton
          className="omg-tool"
          aria-label="View mode and zoom"
          aria-haspopup="dialog"
          onClick={props.onOpenView}
        >
          <IconView />
          <span className="omg-tool__label">View</span>
        </ChromeButton>
        <ChromeButton
          className="omg-tool"
          aria-label={
            badge > 0
              ? `More actions (${badge} transfer${badge === 1 ? '' : 's'} running)`
              : 'More actions'
          }
          aria-haspopup="dialog"
          onClick={props.onOpenMore}
        >
          <IconMore />
          <span className="omg-tool__label">More</span>
          {badge > 0 && (
            <span className="omg-tool__badge" aria-hidden="true">
              {badge}
            </span>
          )}
        </ChromeButton>
      </div>
      <ChromeButton
        className="omg-tool omg-tool--collapse"
        aria-label="Hide session toolbar"
        aria-expanded={true}
        onClick={() => onExpandedChange(false)}
      >
        <IconChevronDown />
      </ChromeButton>
    </div>
  );
}
