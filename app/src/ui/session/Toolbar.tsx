import { useEffect, useRef, useState } from 'react';
import type { PointerMode } from '../../session/pointer/PointerModel.ts';
import { ChromeButton } from './ChromeButton.tsx';
import {
  IconChevronDown,
  IconCombo,
  IconKeyboard,
  IconKeys,
  IconMenu,
  IconPaste,
  IconPower,
  IconTouch,
  IconTrackpad,
  IconView,
} from './icons.tsx';

export interface ToolbarProps {
  readonly expanded: boolean;
  readonly onExpandedChange: (expanded: boolean) => void;
  readonly pointerMode: PointerMode;
  readonly onTogglePointerMode: () => void;
  readonly onOpenView: () => void;
  readonly keyboardActive: boolean;
  readonly onToggleKeyboard: () => void;
  readonly keyBarOpen: boolean;
  readonly onToggleKeyBar: () => void;
  readonly onPaste: () => void;
  readonly onTypeClipboard: () => void;
  readonly onOpenCombos: () => void;
  readonly onDisconnect: () => void;
  /** Interaction anywhere in the toolbar (resets the auto-hide timer). */
  readonly onActivity: () => void;
}

const LONG_PRESS_MS = 500;
const CONFIRM_MS = 3000;

/**
 * Session toolbar: a compact bar at the bottom edge (thumb reach in portrait and
 * landscape) that collapses to a small handle. Buttons never take focus from the hidden
 * text field.
 */
export function Toolbar(props: ToolbarProps) {
  const { expanded, onExpandedChange, pointerMode, keyboardActive, keyBarOpen, onActivity } = props;
  const [confirmExit, setConfirmExit] = useState(false);
  const pressStart = useRef<number | null>(null);
  const longPressed = useRef(false);

  useEffect(() => {
    if (!confirmExit) return;
    const t = setTimeout(() => setConfirmExit(false), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [confirmExit]);

  if (!expanded) {
    return (
      <div className="omg-toolbar omg-toolbar--collapsed">
        <ChromeButton
          className="omg-handle"
          aria-label="Show session toolbar"
          aria-expanded={false}
          onClick={() => onExpandedChange(true)}
        >
          <IconMenu />
        </ChromeButton>
      </div>
    );
  }

  const trackpad = pointerMode === 'trackpad';
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
          aria-label={
            trackpad
              ? 'Pointer: trackpad. Switch to direct touch'
              : 'Pointer: direct touch. Switch to trackpad'
          }
          onClick={props.onTogglePointerMode}
        >
          {trackpad ? <IconTrackpad /> : <IconTouch />}
          <span className="omg-tool__label">{trackpad ? 'Trackpad' : 'Touch'}</span>
        </ChromeButton>
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
          className={keyboardActive ? 'omg-tool omg-tool--on' : 'omg-tool'}
          aria-label={keyboardActive ? 'Hide keyboard' : 'Show keyboard'}
          aria-pressed={keyboardActive}
          onClick={props.onToggleKeyboard}
        >
          <IconKeyboard />
          <span className="omg-tool__label">Keyboard</span>
        </ChromeButton>
        <ChromeButton
          className={keyBarOpen ? 'omg-tool omg-tool--on' : 'omg-tool'}
          aria-label={keyBarOpen ? 'Hide extra keys' : 'Show extra keys'}
          aria-pressed={keyBarOpen}
          onClick={props.onToggleKeyBar}
        >
          <IconKeys />
          <span className="omg-tool__label">Keys</span>
        </ChromeButton>
        <ChromeButton
          className="omg-tool"
          aria-label="Paste device clipboard to the remote. Long press to type it instead"
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
        <ChromeButton
          className="omg-tool"
          aria-label="Key combos"
          aria-haspopup="dialog"
          onClick={props.onOpenCombos}
        >
          <IconCombo />
          <span className="omg-tool__label">Combos</span>
        </ChromeButton>
        <ChromeButton
          className={
            confirmExit
              ? 'omg-tool omg-tool--danger omg-tool--confirm'
              : 'omg-tool omg-tool--danger'
          }
          aria-label={confirmExit ? 'Tap again to disconnect' : 'Disconnect'}
          onClick={() => {
            if (confirmExit) props.onDisconnect();
            else setConfirmExit(true);
          }}
        >
          <IconPower />
          <span className="omg-tool__label">{confirmExit ? 'Sure?' : 'Exit'}</span>
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
