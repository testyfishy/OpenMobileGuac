import { useEffect, useState, type ReactNode } from 'react';
import { ChromeButton } from './ChromeButton.tsx';
import {
  IconBack,
  IconClipboard,
  IconCombo,
  IconFolder,
  IconInfo,
  IconKeys,
  IconPaste,
  IconPower,
  IconShield,
  IconSliders,
  IconVolume,
} from './icons.tsx';
import { sessionStrings } from './sessionStrings.ts';
import { Sheet } from './Sheet.tsx';

export interface MoreSheetProps {
  /** Show the one-tap Ctrl+Alt+Del (RDP / VNC). */
  readonly showCtrlAltDel: boolean;
  readonly audioMuted: boolean;
  /** An audio stream is open (otherwise the toggle still works, with a hint). */
  readonly audioActive: boolean;
  readonly keyBarOpen: boolean;
  readonly activeTransfers: number;
  readonly hasFilesystem: boolean;
  readonly onFiles: () => void;
  readonly onClipboard: () => void;
  readonly onToggleAudio: () => void;
  readonly onToggleKeyBar: () => void;
  readonly onInput: () => void;
  readonly onCombos: () => void;
  readonly onCtrlAltDel: () => void;
  readonly onTypeClipboard: () => void;
  readonly onInfo: () => void;
  /** Back to the connection list with the session kept open (`onMinimize`). */
  readonly onMinimize?: () => void;
  readonly onDisconnect: () => void;
  readonly onClose: () => void;
}

const CONFIRM_MS = 3000;

function Tile({
  icon,
  label,
  hint,
  pressed,
  danger,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  pressed?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  const cls = ['omg-tile', pressed ? 'omg-tile--on' : '', danger ? 'omg-tile--danger' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <ChromeButton
      className={cls}
      aria-pressed={pressed}
      onClick={onClick}
      aria-label={hint ? `${label}. ${hint}` : label}
    >
      {icon}
      <span className="omg-tile__label">{label}</span>
      {hint && (
        <span className="omg-tile__hint" aria-hidden="true">
          {hint}
        </span>
      )}
    </ChromeButton>
  );
}

/** Secondary session actions, one tap away from the compact toolbar. */
export function MoreSheet(p: MoreSheetProps) {
  const [confirmExit, setConfirmExit] = useState(false);
  useEffect(() => {
    if (!confirmExit) return;
    const t = setTimeout(() => setConfirmExit(false), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [confirmExit]);
  const t = sessionStrings.more;

  return (
    <Sheet title={t.title} onClose={p.onClose}>
      <div className="omg-tiles">
        <Tile
          icon={<IconFolder />}
          label={t.files}
          hint={
            p.activeTransfers > 0
              ? t.running(p.activeTransfers)
              : p.hasFilesystem
                ? t.browseRemote
                : t.sendOrReceive
          }
          onClick={p.onFiles}
        />
        <Tile
          icon={<IconClipboard />}
          label={t.clipboard}
          hint={t.clipboardHint}
          onClick={p.onClipboard}
        />
        <Tile
          icon={<IconVolume muted={p.audioMuted} />}
          label={p.audioMuted ? sessionStrings.toasts.soundOff : sessionStrings.toasts.soundOn}
          hint={p.audioActive ? undefined : t.noAudio}
          pressed={!p.audioMuted}
          onClick={p.onToggleAudio}
        />
        <Tile
          icon={<IconKeys />}
          label={t.extraKeys}
          pressed={p.keyBarOpen}
          onClick={p.onToggleKeyBar}
        />
        <Tile icon={<IconCombo />} label={t.keyCombos} onClick={p.onCombos} />
        {p.showCtrlAltDel && (
          <Tile
            icon={<IconShield />}
            label="Ctrl+Alt+Del"
            hint={t.sendNow}
            onClick={p.onCtrlAltDel}
          />
        )}
        <Tile
          icon={<IconPaste />}
          label={t.typeClipboard}
          hint={t.asKeystrokes}
          onClick={p.onTypeClipboard}
        />
        <Tile icon={<IconSliders />} label={t.inputOptions} onClick={p.onInput} />
        <Tile icon={<IconInfo />} label={t.sessionInfo} onClick={p.onInfo} />
        {p.onMinimize && (
          <Tile
            icon={<IconBack />}
            label={t.backToConnections}
            hint={t.keepOpen}
            onClick={p.onMinimize}
          />
        )}
        <Tile
          icon={<IconPower />}
          label={confirmExit ? t.tapAgain : t.disconnect}
          danger
          pressed={confirmExit}
          onClick={() => {
            if (confirmExit) p.onDisconnect();
            else setConfirmExit(true);
          }}
        />
      </div>
    </Sheet>
  );
}
