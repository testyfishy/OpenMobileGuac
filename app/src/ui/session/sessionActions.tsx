import type { ReactNode } from 'react';
import type { PointerMode } from '../../session/pointer/PointerModel.ts';
import {
  IconBack,
  IconClipboard,
  IconCombo,
  IconFolder,
  IconInfo,
  IconKeyboard,
  IconKeySets,
  IconKeys,
  IconMultiTouch,
  IconPaste,
  IconPower,
  IconShield,
  IconSliders,
  IconTouch,
  IconTrackpad,
  IconView,
  IconVolume,
  IconEye,
  IconZoomIn,
  IconZoomOut,
  IconZoomReset,
} from './icons.tsx';
import { sessionStrings } from './sessionStrings.ts';
import type { ToolbarAction } from './toolbarItems.ts';

/** One session action as the toolbar, the More sheet and the toolbar editor show it. */
export interface SessionAction {
  readonly id: ToolbarAction;
  readonly icon: ReactNode;
  /** Short label under the toolbar icon. */
  readonly label: string;
  /** Accessible name (and the name in the More sheet / editor). */
  readonly name: string;
  /** On/off state (keyboard up, extra keys shown, trackpad mode, muted). */
  readonly pressed?: boolean;
  /** Not offered for this connection (e.g. Ctrl+Alt+Del in a terminal). */
  readonly available: boolean;
  readonly badge?: number;
  readonly danger?: boolean;
  /** Opens a sheet (aria-haspopup). */
  readonly opensSheet?: boolean;
  readonly onRun: () => void;
  /** Long press (Paste: type the clipboard instead). */
  readonly onLongPress?: () => void;
}

export interface SessionActionContext {
  readonly pointerMode: PointerMode;
  readonly keyboardActive: boolean;
  readonly keyBarVisible: boolean;
  readonly audioMuted: boolean;
  readonly viewOnly: boolean;
  readonly showCtrlAltDel: boolean;
  readonly canMinimize: boolean;
  readonly pasteHint: string;
  readonly runningTransfers: number;
  readonly onTogglePointerMode: () => void;
  readonly onToggleKeyboard: () => void;
  readonly onToggleKeyBar: () => void;
  readonly onPaste: () => void;
  readonly onTypeClipboard: () => void;
  readonly onView: () => void;
  readonly onZoomReset: () => void;
  readonly onZoom: (factor: number) => void;
  readonly onCombos: () => void;
  /** KEY-9: open the key set switcher. */
  readonly onKeySets: () => void;
  readonly onCtrlAltDel: () => void;
  readonly onClipboard: () => void;
  readonly onFiles: () => void;
  readonly onToggleAudio: () => void;
  readonly onToggleViewOnly: () => void;
  readonly onOptions: () => void;
  readonly onInfo: () => void;
  readonly onMinimize: () => void;
  readonly onDisconnect: () => void;
}

export type SessionActions = Readonly<Record<ToolbarAction, SessionAction>>;

/** Every action with its current state, keyed by id. */
export function buildSessionActions(c: SessionActionContext): SessionActions {
  const t = sessionStrings.toolbar;
  const short = t.short;
  const names = t.names;
  const trackpad = c.pointerMode === 'trackpad';
  const touch = c.pointerMode === 'touch';
  const modeLabel = trackpad
    ? sessionStrings.common.trackpad
    : touch
      ? t.modeMultiTouch
      : t.modeTouch;
  const a = (
    id: ToolbarAction,
    icon: ReactNode,
    onRun: () => void,
    extra: Partial<SessionAction> = {},
  ): SessionAction => ({
    id,
    icon,
    label: short[id],
    name: names[id],
    available: true,
    onRun,
    ...extra,
  });
  return {
    pointer: a(
      'pointer',
      trackpad ? <IconTrackpad /> : touch ? <IconMultiTouch /> : <IconTouch />,
      c.onTogglePointerMode,
      {
        label: modeLabel,
        name: t.pointer(modeLabel),
        pressed: trackpad || touch,
      },
    ),
    keyboard: a('keyboard', <IconKeyboard />, c.onToggleKeyboard, {
      name: c.keyboardActive ? t.hideKeyboard : t.showKeyboard,
      pressed: c.keyboardActive,
    }),
    'extra-keys': a('extra-keys', <IconKeys />, c.onToggleKeyBar, {
      name: c.keyBarVisible ? t.extraKeysOn : t.extraKeysOff,
      pressed: c.keyBarVisible,
    }),
    paste: a('paste', <IconPaste />, c.onPaste, {
      name: t.pasteLongPress(c.pasteHint),
      onLongPress: c.onTypeClipboard,
    }),
    view: a('view', <IconView />, c.onView, { name: t.viewLabel, opensSheet: true }),
    'zoom-reset': a('zoom-reset', <IconZoomReset />, c.onZoomReset),
    'zoom-in': a('zoom-in', <IconZoomIn />, () => c.onZoom(1.25)),
    'zoom-out': a('zoom-out', <IconZoomOut />, () => c.onZoom(0.8)),
    combos: a('combos', <IconCombo />, c.onCombos, { opensSheet: true }),
    'key-sets': a('key-sets', <IconKeySets />, c.onKeySets, { opensSheet: true }),
    'ctrl-alt-del': a('ctrl-alt-del', <IconShield />, c.onCtrlAltDel, {
      available: c.showCtrlAltDel,
    }),
    'type-clipboard': a('type-clipboard', <IconPaste />, c.onTypeClipboard),
    clipboard: a('clipboard', <IconClipboard />, c.onClipboard, { opensSheet: true }),
    files: a('files', <IconFolder />, c.onFiles, {
      opensSheet: true,
      ...(c.runningTransfers > 0 ? { badge: c.runningTransfers } : {}),
    }),
    sound: a('sound', <IconVolume muted={c.audioMuted} />, c.onToggleAudio, {
      label: c.audioMuted ? sessionStrings.toasts.soundOff : short.sound,
      name: c.audioMuted ? t.soundOff : t.soundOn,
      pressed: c.audioMuted,
    }),
    'view-only': a('view-only', <IconEye off={false} />, c.onToggleViewOnly, {
      pressed: c.viewOnly,
    }),
    options: a('options', <IconSliders />, c.onOptions, { opensSheet: true }),
    info: a('info', <IconInfo />, c.onInfo, { opensSheet: true }),
    back: a('back', <IconBack />, c.onMinimize, { available: c.canMinimize }),
    disconnect: a('disconnect', <IconPower />, c.onDisconnect, { danger: true }),
  };
}
