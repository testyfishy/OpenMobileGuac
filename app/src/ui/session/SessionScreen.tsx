import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type JSX,
} from 'react';
import type { TunnelLike } from '../../core/transport/TunnelLike.ts';
import {
  EMPTY_CLIPBOARD_HISTORY,
  reduceClipboard,
} from '../../session/clipboard/ClipboardHistory.ts';
import { isFinished } from '../../session/transfer/TransferModel.ts';
import type { ComboStep } from '../../session/keys/ComboLibrary.ts';
import { parseCombo } from '../../session/keys/KeyModel.ts';
import {
  DEFAULT_KEY_LIBRARY,
  LEGACY_SET_ID,
  legacySet,
  newComboId,
  reduceKeyLibrary,
  resolveActiveKeySet,
  stepSet,
  switchableSets,
  type KeyLibrary,
  type KeyLibraryAction,
} from '../../session/keys/KeySets.ts';
import type { PointerMode } from '../../session/pointer/PointerModel.ts';
import { ClipboardSheet } from './ClipboardSheet.tsx';
import { ComboMenu } from './ComboMenu.tsx';
import { CredentialSheet } from './CredentialSheet.tsx';
import { FilesSheet } from './FilesSheet.tsx';
import { ChromeButton } from './ChromeButton.tsx';
import { CursorArrow, IconEye, IconMic, IconViewers } from './icons.tsx';
import { InfoSheet } from './InfoSheet.tsx';
import { InputMenu } from './InputMenu.tsx';
import { KeyBar } from './KeyBar.tsx';
import { IncomingFileSheet } from './IncomingFileSheet.tsx';
import { KeySetManager, KeySetPicker, type SaveTextFile } from './KeySetManager.tsx';
import { microphoneAvailable, primeAudioInput } from './microphone.ts';
import type { StreamRequest } from './fileSave.ts';
import { keySetName, keySetNameIn } from './keySetNames.ts';
import { MoreSheet, type TerminalControls } from './MoreSheet.tsx';
import { ShareSheet, type SessionSharing } from './ShareSheet.tsx';
import { SheetBackContext, SheetSwipeContext } from './sheetBack.ts';
import { nextColorScheme, parseFontSize, stepFontSize } from '../../session/terminalFont.ts';
import {
  enterImmersive,
  keepScreenAwake,
  nativeHideKeyboard,
  nativeShowKeyboard,
  onFoldChange,
  onForeground,
  onNativeKeyboard,
  playHaptic,
  readDeviceClipboard,
  readFold,
  writeDeviceClipboard,
  type FoldInfo,
  type KeepAwakeState,
} from './platform.ts';
import { SessionController, type SessionLogLevel } from './SessionController.ts';
import { sessionStrings } from './sessionStrings.ts';
import type { SessionActionContext } from './sessionActions.tsx';
import { normalizeSessionSettings, type SessionSettings } from './settings.ts';
import { isSignInFailure } from './status.ts';
import { TextInputBar } from './TextInputBar.tsx';
import { StatusOverlay } from './StatusOverlay.tsx';
import { Toolbar } from './Toolbar.tsx';
import { ToolbarEditor } from './ToolbarEditor.tsx';
import {
  NO_EDGES,
  cutoutSide,
  dockReserve,
  effectiveToolbarStyle,
  landscapeSide,
  type CutoutSide,
  type Edges,
} from './toolbarItems.ts';
import { ViewMenu } from './ViewMenu.tsx';
import './SessionScreen.css';

export interface SessionLogEntry {
  readonly level: SessionLogLevel;
  readonly message: string;
}

export interface SessionScreenProps {
  /** Connection name. */
  title: string;
  /** 'rdp' | 'vnc' | 'ssh' | ... */
  protocol?: string;
  /** A fresh tunnel for each (re)connect attempt. */
  createTunnel: () => TunnelLike;
  /** Passed to client.connect(). */
  buildConnectData: (size: {
    width: number;
    height: number;
    dpi: number;
    /** false: request no audio (Quality low / Audio off). */
    audio?: boolean;
  }) => string;
  /** Holds a (re)connect while it returns a promise (the app lock). */
  connectGate?: () => Promise<void> | null;
  settings: SessionSettings;
  /** Persist per connection. */
  onSettingsChange: (patch: Partial<SessionSettings>) => void;
  /** User disconnected / closed. */
  onExit: () => void;
  isDemo?: boolean;
  /**
   * Shown (default true). False: stay connected, but ignore all input, release held keys
   * and buttons, drop the wake lock, pause loops and audio, and render no chrome.
   */
  active?: boolean;
  /** A small JPEG (≤ 320 px wide) of the remote screen: after connect, ≤ every 30 s, on hide/exit. */
  onThumbnail?: (dataUrl: string) => void;
  /** Lifecycle log (no secrets, clipboard contents or typed text). */
  onLog?: (entry: SessionLogEntry) => void;
  /** Back to the connection list, keeping the session open (shown in the More sheet). */
  onMinimize?: () => void;
  /**
   * The tunnel refused the Guacamole sign-in (`isSignInFailure`: an expired or revoked
   * token, typically on a reconnect after the connection dropped). Called once per ended
   * connection; the shell can sign in again and remount the session with a fresh tunnel.
   */
  onSignInExpired?: () => void;
  /**
   * Settings this connection stores itself (overriding the app / server defaults). Shown in
   * Session options with "Use app default".
   */
  overriddenKeys?: readonly string[];
  /** Forget the connection's own value for these keys (back to the app / server default). */
  onUseDefault?: (keys: string[]) => void;
  /**
   * KEY-9: the app's key library (key sets, saved combos, protocol defaults). Edits made in
   * the session go to `onKeyLibraryChange` (app-wide, not per connection). Without these
   * props the screen keeps a library of its own in memory (dev harness).
   */
  keyLibrary?: KeyLibrary;
  onKeyLibraryChange?: (next: KeyLibrary) => void;
  /** Save a text file for the user (key set export); default: a browser download. */
  saveTextFile?: SaveTextFile;
  /** Session info "Edit this connection" (only when the user may edit it). */
  onEditConnection?: () => void;
  /** "Share this session" (sharing profiles); absent for the demo. */
  sharing?: SessionSharing;
  /**
   * Someone else's session: joined from the admin's active sessions, or opened from a share
   * link. The view is never followed with a resize (it would resize the owner's desktop).
   */
  sharedViewer?: boolean;
  /**
   * FIL-1: the stream download request for a stream of this tunnel (native: received files
   * are fetched from it straight to disk, as the web client does). Absent: in band.
   */
  streamDownload?: (
    tunnelUuid: string,
    streamIndex: number,
    filename: string,
  ) => StreamRequest | null;
}

/** Longest clipboard text typed as keystrokes (each character is two key events). */
const MAX_TYPED_CHARS = 4000;
const TOOLBAR_AUTOHIDE_MS = 5000;
/** Protocols rendered by guacd's terminal emulator. */
const TERMINAL_PROTOCOLS = new Set(['ssh', 'telnet', 'kubernetes']);

type Menu =
  | 'view'
  | 'combos'
  | 'keysets'
  | 'keypicker'
  | 'input'
  | 'keybar'
  | 'toolbar'
  | 'more'
  | 'files'
  | 'clipboard'
  | 'info'
  | 'share'
  | null;

/**
 * Landscape from the viewport (so split screen and narrow windows count as portrait).
 * `fromScreen`: use the device orientation instead, for a rotation while a keyboard that
 * shrinks the WebView is open (the viewport would look landscape on a portrait phone).
 */
/** True when the device's short side is phone-sized (stable across rotation and keyboards). */
function isPhoneSized(): boolean {
  if (typeof window === 'undefined' || !window.screen) return true;
  return Math.min(window.screen.width, window.screen.height) <= 540;
}

function readCutout(): CutoutSide {
  if (typeof window === 'undefined') return 'unknown';
  return cutoutSide((window as { orientation?: unknown }).orientation);
}

function readLandscape(fromScreen = false): boolean {
  if (typeof window === 'undefined') return false;
  const type = typeof screen !== 'undefined' ? screen.orientation?.type : undefined;
  if (fromScreen && type) return type.startsWith('landscape');
  try {
    return window.matchMedia('(orientation: landscape)').matches;
  } catch {
    return window.innerWidth > window.innerHeight;
  }
}

function sameEdges(a: Edges, b: Edges): boolean {
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
}
type KeyBarMode = 'auto' | 'shown' | 'hidden';

/** Default split: the display gets this share of the height. */
const SPLIT_DISPLAY_SHARE = 0.58;

export function SessionScreen(props: SessionScreenProps): JSX.Element {
  const { title, onExit, isDemo, protocol, onMinimize } = props;
  // Read at render time: the table follows the app language (see sessionStrings.ts).
  const t = sessionStrings;
  const active = props.active !== false;
  const proto = (protocol ?? '').toLowerCase();
  const terminal = TERMINAL_PROTOCOLS.has(proto);
  // Ctrl+Alt+Del makes sense for graphical desktops (unknown protocol: offer it).
  const showCtrlAltDel = !terminal;
  // In-session overlay: the shell may not persist (yet) every field this screen offers,
  // so changes apply here at once and are also reported to the host.
  const [overlay, setOverlay] = useState<Partial<SessionSettings>>({});
  const settings = useMemo(
    () => normalizeSessionSettings({ ...props.settings, ...overlay }),
    [props.settings, overlay],
  );
  const hostChange = props.onSettingsChange;
  const onSettingsChange = useCallback(
    (patch: Partial<SessionSettings>) => {
      setOverlay((o) => ({ ...o, ...patch }));
      hostChange(patch);
    },
    [hostChange],
  );
  const settingsChangeRef = useRef(onSettingsChange);
  useEffect(() => {
    settingsChangeRef.current = onSettingsChange;
  });
  const hostUseDefault = props.onUseDefault;
  const useDefault = useCallback(
    (keys: string[]) => {
      setOverlay((o) => {
        const drop = new Set(keys);
        return Object.fromEntries(
          Object.entries(o).filter(([k]) => !drop.has(k)),
        ) as Partial<SessionSettings>;
      });
      hostUseDefault?.(keys);
    },
    [hostUseDefault],
  );
  const overridden = useMemo(
    () => new Set<string>([...(props.overriddenKeys ?? [])]),
    [props.overriddenKeys],
  );
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const showToast = useCallback((text: string) => setToast({ id: Date.now(), text }), []);

  // CLP-5: this session's clipboard texts, memory only.
  const [clipHistory, clipDispatch] = useReducer(reduceClipboard, EMPTY_CLIPBOARD_HISTORY);

  const [controller] = useState(() => new SessionController(settings));
  const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const transferSnap = useSyncExternalStore(
    controller.transfers.subscribe,
    controller.transfers.getSnapshot,
  );
  const runningTransfers = transferSnap.transfers.filter((t) => !isFinished(t)).length;

  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const displayRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const chromeRef = useRef<HTMLDivElement>(null);
  const keyBarRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);

  // ---- Controller lifecycle. Options first (effects run in order), then attach.
  useEffect(() => {
    // Before attach (which connects): the protocol decides terminal-only sizing.
    controller.setProtocol(latest.current.protocol);
    controller.setOptions({
      createTunnel: () => latest.current.createTunnel(),
      buildConnectData: (size) => latest.current.buildConnectData(size),
      connectGate: () => latest.current.connectGate?.() ?? null,
      haptic: playHaptic,
      onRemoteClipboard: (text) => {
        clipDispatch({ type: 'add', text, direction: 'from-remote', at: Date.now() });
        if (!latest.current.settings.clipboardRemoteToDevice) return;
        // A hidden session (behind the app or another session) does not write the device
        // clipboard (AUDIT MUL-1); the text stays in its clipboard history.
        if (latest.current.active === false) return;
        void writeDeviceClipboard(text).then((ok) => {
          if (ok) setToast({ id: Date.now(), text: sessionStrings.toasts.remoteClipboardCopied });
        });
      },
      onLog: (entry) => latest.current.onLog?.(entry),
      onThumbnail: (url) => latest.current.onThumbnail?.(url),
      notify: (text) => setToast({ id: Date.now(), text }),
      hideNativeKeyboard: nativeHideKeyboard,
      sharedViewer: latest.current.sharedViewer === true,
      streamDownload: (uuid, index, name) =>
        latest.current.streamDownload?.(uuid, index, name) ?? null,
      // The server refused audio input, access was denied or capture is unavailable: turn
      // "Send microphone" off so it is not retried on every connect.
      onMicrophoneProblem: () => settingsChangeRef.current({ microphone: false }),
    });
  }, [controller]);

  useEffect(() => {
    const els = {
      stage: stageRef.current,
      displayHost: displayRef.current,
      gestureLayer: gestureRef.current,
      cursor: cursorRef.current,
      field: fieldRef.current,
      safeAreaProbe: probeRef.current,
      chromeRoot: chromeRef.current,
    };
    const { stage, displayHost, gestureLayer, cursor, field, safeAreaProbe, chromeRoot } = els;
    if (
      !stage ||
      !displayHost ||
      !gestureLayer ||
      !cursor ||
      !field ||
      !safeAreaProbe ||
      !chromeRoot
    ) {
      return;
    }
    // A docked toolbar's space is known before the first connect, so the remote is asked for
    // (and fitted into) the area that is left.
    const tb = toolbarRef.current;
    const docked = (['dock-top', 'dock-bottom', 'dock-left', 'dock-right'] as const).find((s) =>
      tb?.classList.contains(`omg-toolbar--${s}`),
    );
    if (tb && docked) {
      const r = dockReserve(docked, { width: tb.offsetWidth, height: tb.offsetHeight });
      const splitOn = rootRef.current?.dataset['split'] === 'on';
      controller.setReservedInsets(splitOn ? { ...r, bottom: 0 } : r);
    }
    controller.attach({
      stage,
      displayHost,
      gestureLayer,
      cursor,
      field,
      safeAreaProbe,
      chromeRoot,
    });
    const kb = onNativeKeyboard((open, height) => controller.setNativeKeyboard(open, height));
    return () => {
      kb.dispose();
      controller.detach();
    };
  }, [controller]);

  useEffect(() => {
    controller.updateSettings(settings);
  }, [controller, settings]);

  // ---- Expired sign-in: hand over to the shell (once per ended connection)
  const signInFailed = isSignInFailure(snap.phase);
  useEffect(() => {
    if (signInFailed) latest.current.onSignInExpired?.();
  }, [signInFailed]);

  // ---- Shown / hidden (the shell keeps hidden sessions mounted)
  useEffect(() => {
    controller.setActive(active);
  }, [controller, active]);

  // ---- Audio (AUD-1)
  useEffect(() => {
    controller.setAudioMuted(settings.audio === 'muted');
  }, [controller, settings.audio]);

  useEffect(() => {
    controller.setProtocol(protocol);
  }, [controller, protocol]);

  const lastAutoSent = useRef<string | null>(null);
  // ---- Clipboard send on connect (CLP-1, opt-in, default off: iOS may show a paste prompt)
  const connectedNow = snap.phase.kind === 'connected';
  const sentOnConnect = useRef(false);
  useEffect(() => {
    // Once per open session (not on every reconnect, which would prompt again on iOS).
    if (!connectedNow) return;
    if (!settings.clipboardSendOnConnect || !active || sentOnConnect.current) return;
    sentOnConnect.current = true;
    void readDeviceClipboard().then((r) => {
      if (!r.ok || r.text === '') return;
      if (controller.sendClipboard(r.text)) {
        lastAutoSent.current = r.text;
        clipDispatch({ type: 'add', text: r.text, direction: 'to-remote', at: Date.now() });
        setToast({ id: Date.now(), text: sessionStrings.toasts.deviceClipboardSent });
      }
    });
  }, [connectedNow, settings.clipboardSendOnConnect, active, controller]);

  // ---- Split layout (DSP-8): display above, trackpad surface + key bar below
  const [fold, setFold] = useState<FoldInfo>(() => readFold());
  useEffect(() => {
    const sub = onFoldChange(() => setFold(readFold()));
    return () => sub.dispose();
  }, []);
  const split =
    settings.splitLayout === 'on' || (settings.splitLayout === 'auto' && fold.horizontalFold);
  useEffect(() => {
    controller.setTrackpadSurface(split ? surfaceRef.current : null);
    return () => controller.setTrackpadSurface(null);
  }, [controller, split]);

  // ---- Key bar: docked above the keyboard; its height is part of the keyboard inset
  // (except in the split layout, where it sits below the display, not over it).
  const [keyBarMode, setKeyBarMode] = useState<KeyBarMode>('auto');
  const keyBarVisible =
    split || keyBarMode === 'shown' || (keyBarMode === 'auto' && snap.keyboardActive);
  const textBarVisible = settings.textInputBar;

  // ---- Toolbar style: floating over the desktop, or docked (space reserved at an edge)
  const keyboardActive = snap.keyboardActive;
  const [landscape, setLandscape] = useState(readLandscape);
  const [cutout, setCutout] = useState(readCutout);
  useEffect(() => {
    // A keyboard that shrinks the WebView (Android) can make a phone look landscape: while
    // it is up, size changes are ignored (re-read when it closes), but a real rotation
    // (`orientationchange`, `screen.orientation` change) still applies at once.
    const on = () => {
      setLandscape(readLandscape());
      setCutout(readCutout());
    };
    const rotated = () => {
      const read = () => {
        setLandscape(readLandscape(keyboardActive));
        setCutout(readCutout());
      };
      read();
      // Some WebViews report the new orientation a little after the event.
      setTimeout(read, 250);
    };
    if (!keyboardActive) {
      on();
      window.addEventListener('resize', on);
    }
    window.addEventListener('orientationchange', rotated);
    const so = typeof screen !== 'undefined' ? screen.orientation : undefined;
    so?.addEventListener?.('change', rotated);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('orientationchange', rotated);
      so?.removeEventListener?.('change', rotated);
    };
  }, [keyboardActive]);
  const toolbarStyle = effectiveToolbarStyle(
    settings.toolbarStyle,
    landscape,
    // Phones only: a tablet in landscape has height to spare, so its dock stays put.
    isPhoneSized() ? landscapeSide(settings.toolbarLandscape, cutout) : 'same',
  );
  const docked = toolbarStyle !== 'floating';
  const dockBottom = toolbarStyle === 'dock-bottom';
  const [reserve, setReserve] = useState<Edges>(NO_EDGES);
  useEffect(() => {
    const el = toolbarRef.current;
    if (!docked || !el || !active) {
      setReserve((r) => (sameEdges(r, NO_EDGES) ? r : NO_EDGES));
      return;
    }
    const report = () => {
      // Docked at the bottom, the toolbar rides above the keyboard and drops its safe-area
      // padding: keep the keyboard-closed reserve so the desktop does not rescale.
      const next = dockReserve(toolbarStyle, { width: el.offsetWidth, height: el.offsetHeight });
      setReserve((r) => {
        const keepBottom =
          dockBottom && keyboardActive && r.bottom > 0 && r.top + r.left + r.right === 0;
        return keepBottom || sameEdges(r, next) ? r : next;
      });
    };
    const ro = new ResizeObserver(report);
    ro.observe(el);
    report();
    return () => ro.disconnect();
  }, [docked, dockBottom, toolbarStyle, active, keyboardActive]);
  useEffect(() => {
    // Split layout: the stage ends above the trackpad, so a bottom dock covers only that.
    controller.setReservedInsets(split ? { ...reserve, bottom: 0 } : reserve);
  }, [controller, reserve, split]);

  // ---- Key bar height: part of the keyboard inset (the view pans above it; no rescale).
  // Docked at the bottom, the whole dock (key bar + toolbar) rides above the keyboard.
  useEffect(() => {
    const el = dockBottom ? dockRef.current : keyBarRef.current;
    if (!el) return;
    const report = () => controller.setKeyBarHeight(split ? 0 : el.offsetHeight);
    const ro = new ResizeObserver(report);
    ro.observe(el);
    report();
    return () => ro.disconnect();
  }, [controller, keyBarVisible, textBarVisible, split, active, dockBottom]);

  // ---- Immersive (DSP-7)
  useEffect(() => {
    if (!settings.immersive || !active) return;
    const sub = enterImmersive();
    return () => sub.dispose();
  }, [settings.immersive, active]);

  // ---- Toolbar auto-hide
  const [toolbarExpanded, setToolbarExpanded] = useState(true);
  // The open sheet plus the sheets it was reached from, so a sub-sheet can go Back.
  const [menuNav, setMenuNav] = useState<{ menu: Menu; trail: Menu[] }>({
    menu: null,
    trail: [],
  });
  const menu = menuNav.menu;
  const setMenu = useCallback((next: Menu) => {
    setMenuNav((nav) => {
      if (next === null) return { menu: null, trail: [] };
      if (next === nav.menu) return nav;
      // Reopening a sheet already on the trail returns to it instead of growing a loop.
      const at = nav.trail.indexOf(next);
      if (at >= 0) return { menu: next, trail: nav.trail.slice(0, at) };
      return { menu: next, trail: nav.menu === null ? [] : [...nav.trail, nav.menu] };
    });
  }, []);
  const menuBack = useMemo(
    () =>
      menuNav.trail.length === 0
        ? null
        : () =>
            setMenuNav((nav) => ({
              menu: nav.trail[nav.trail.length - 1] ?? null,
              trail: nav.trail.slice(0, -1),
            })),
    [menuNav.trail.length],
  );
  const [activity, setActivity] = useState(0);
  const connected = snap.phase.kind === 'connected';
  const autoHide = !docked && settings.toolbarAutoHide && !keyboardActive;
  useEffect(() => {
    if (!autoHide || !toolbarExpanded || menu !== null || !connected) return;
    const t = setTimeout(() => setToolbarExpanded(false), TOOLBAR_AUTOHIDE_MS);
    return () => clearTimeout(t);
  }, [autoHide, toolbarExpanded, menu, connected, activity]);
  const bump = useCallback(() => setActivity((n) => n + 1), []);

  // ---- Toast timeout
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  // ---- Keep-awake (DSP-7): only while shown and connected
  const [keepAwakeState, setKeepAwakeState] = useState<KeepAwakeState>('released');
  useEffect(() => {
    if (!settings.keepAwake || !connected || !active) return;
    const lock = keepScreenAwake((s) => {
      setKeepAwakeState(s);
      if (s !== 'released') latest.current.onLog?.({ level: 'debug', message: `Keep-awake: ${s}` });
    });
    return () => lock.dispose();
  }, [settings.keepAwake, connected, active]);

  // ---- Clipboard auto-send on foreground (CLP-1, opt-in; CLP-4: never read otherwise)
  useEffect(() => {
    if (!settings.clipboardAutoSendOnFocus || !active) return;
    const sub = onForeground(() => {
      if (!controller.isConnected()) return;
      void readDeviceClipboard().then((r) => {
        if (!r.ok || r.text === '' || r.text === lastAutoSent.current) return;
        if (controller.sendClipboard(r.text)) {
          lastAutoSent.current = r.text;
          clipDispatch({ type: 'add', text: r.text, direction: 'to-remote', at: Date.now() });
          setToast({ id: Date.now(), text: sessionStrings.toasts.deviceClipboardSent });
        }
      });
    });
    return () => sub.dispose();
  }, [controller, settings.clipboardAutoSendOnFocus, active]);

  // ---- Commands
  const exit = useCallback(() => {
    controller.disconnect();
    nativeHideKeyboard();
    onExit();
  }, [controller, onExit]);

  const touchOffered = snap.touchSupport > 0;
  const togglePointerMode = () => {
    const cycle: PointerMode[] = touchOffered
      ? ['direct', 'trackpad', 'touch']
      : ['direct', 'trackpad'];
    const i = cycle.indexOf(settings.pointerMode);
    const next = cycle[(i + 1) % cycle.length] ?? 'direct';
    onSettingsChange({ pointerMode: next });
    showToast(t.toasts.pointerMode(t.pointerModes.labels[next], t.pointerModes.toastHints[next]));
  };

  const runComboText = (text: string) => {
    const r = parseCombo(text);
    if (r.ok) controller.runCombo(r.combo);
  };

  const toggleKeyboard = () => {
    // Must stay synchronous: iOS only raises the keyboard for focus() inside the tap.
    if (snap.keyboardActive) {
      controller.hideKeyboard();
      nativeHideKeyboard();
    } else {
      controller.showKeyboard();
      nativeShowKeyboard();
      if (keyBarMode === 'hidden') setKeyBarMode('auto');
    }
  };

  /**
   * Set the remote clipboard. Terminal protocols paste guacd's terminal clipboard with
   * Ctrl+Shift+V or a right-click (guacamole-server `terminal/terminal.c`). That is not
   * pressed automatically: with `disable-paste` the terminal keeps its own buffer (the last
   * selection, `ssh/user.c`), and an automatic paste would type stale text into a shell.
   */
  const sendToRemote = (text: string): boolean => {
    if (!controller.sendClipboard(text)) return false;
    clipDispatch({ type: 'add', text, direction: 'to-remote', at: Date.now() });
    return true;
  };

  const paste = () => {
    void readDeviceClipboard().then((r) => {
      if (!r.ok) return showToast(r.reason);
      const s = sessionStrings.toasts;
      if (r.text === '') return showToast(s.clipboardEmpty);
      if (sendToRemote(r.text)) {
        const n = [...r.text].length;
        showToast(terminal ? s.clipboardSentTerminal(n) : s.clipboardSent(n));
      } else {
        showToast(sessionStrings.common.notConnected);
      }
    });
  };

  const typeText = (text: string) => {
    if (!controller.isConnected()) return showToast(sessionStrings.common.notConnected);
    const chars = [...text];
    controller.typeText(chars.slice(0, MAX_TYPED_CHARS).join(''));
    showToast(
      chars.length > MAX_TYPED_CHARS
        ? sessionStrings.toasts.typedFirst(MAX_TYPED_CHARS)
        : sessionStrings.toasts.typed(chars.length),
    );
  };

  const typeClipboard = () => {
    void readDeviceClipboard().then((r) => {
      if (!r.ok) return showToast(r.reason);
      if (r.text === '') return showToast(sessionStrings.toasts.clipboardEmpty);
      typeText(r.text);
    });
  };

  const runSteps = (steps: readonly ComboStep[], label: string) => {
    if (!controller.isConnected()) return showToast(sessionStrings.common.notConnected);
    controller.runComboSteps(steps);
    showToast(sessionStrings.toasts.sentCombo(label));
  };

  // ---- KEY-9 key library and the active key set
  const [ownLibrary, setOwnLibrary] = useState<KeyLibrary>(DEFAULT_KEY_LIBRARY);
  const library = props.keyLibrary ?? ownLibrary;
  const hostLibrary = props.onKeyLibraryChange;
  const setLibrary = useCallback(
    (next: KeyLibrary) => {
      if (hostLibrary) hostLibrary(next);
      else setOwnLibrary(next);
    },
    [hostLibrary],
  );
  const libraryAction = (a: KeyLibraryAction) => setLibrary(reduceKeyLibrary(library, a).library);
  const legacy = settings.keyBarLayout
    ? legacySet(settings.keyBarLayout, t.keySets.legacyName)
    : undefined;
  const connectionSet = overlay.keySet ?? (overridden.has('keySet') ? settings.keySet : undefined);
  const activeSet = resolveActiveKeySet({
    library,
    connectionSet,
    legacyLayout: settings.keyBarLayout,
    protocol: proto,
    defaultSet: settings.keySet,
    legacyName: t.keySets.legacyName,
  }).set;
  const sets = switchableSets(library, legacy);
  const chooseSet = (id: string, toast = false) => {
    onSettingsChange({ keySet: id });
    if (toast) {
      const name = id === LEGACY_SET_ID ? t.keySets.legacyName : keySetNameIn(library, id);
      showToast(t.keySets.switched(name));
    }
  };
  const runSaved = (id: string) => {
    const c = library.combos.find((x) => x.id === id);
    if (c) runSteps(c.steps, c.name);
  };

  const closeMenu = useCallback(() => setMenu(null), [setMenu]);

  const splitTop =
    fold.horizontalFold && fold.foldTop !== null && settings.splitLayout !== 'off'
      ? `${fold.foldTop}px`
      : `${Math.round(SPLIT_DISPLAY_SHARE * 100)}%`;
  const rootStyle = {
    '--omg-kb-cover': `${snap.keyboardCover}px`,
    '--omg-split-top': splitTop,
    '--omg-dock-top': `${reserve.top}px`,
    '--omg-dock-bottom': `${reserve.bottom}px`,
    '--omg-dock-left': `${reserve.left}px`,
    '--omg-dock-right': `${reserve.right}px`,
  } as CSSProperties;
  const effectiveMode: PointerMode =
    settings.pointerMode === 'touch' && !touchOffered ? 'direct' : settings.pointerMode;
  const prompt = snap.credentials;

  const toggleAudio = () => {
    // On ↔ muted here. "Off (not requested)" is changed back to on, which needs a reconnect.
    const next = settings.audio === 'on' ? 'muted' : 'on';
    onSettingsChange({ audio: next });
    showToast(next === 'muted' ? t.toasts.soundOff : t.toasts.soundOn);
  };
  // AUD-2: not in the Demo (no server takes audio input) or where the WebView cannot capture.
  const [micAvailable] = useState(() => !isDemo && microphoneAvailable());
  const toggleMic = () => {
    const on = !settings.microphone;
    // Inside the tap: mobile WebViews start the shared AudioContext only from a gesture.
    if (on) primeAudioInput();
    onSettingsChange({ microphone: on });
    showToast(on ? (connectedNow ? t.mic.starting : t.mic.notConnected) : t.mic.off);
  };
  const toggleViewOnly = () => {
    const on = !settings.viewOnly;
    onSettingsChange({ viewOnly: on });
    showToast(on ? t.toasts.viewOnlyOn : t.toasts.viewOnlyOff);
  };
  const actionContext: SessionActionContext = {
    pointerMode: effectiveMode,
    keyboardActive,
    keyBarVisible,
    audioMuted: settings.audio !== 'on',
    micOn: settings.microphone,
    micLive: snap.microphone === 'live',
    micAvailable,
    viewOnly: settings.viewOnly,
    showCtrlAltDel,
    canMinimize: onMinimize !== undefined,
    pasteHint: terminal ? t.screen.pasteHintTerminal : t.screen.pasteHint,
    pasteLongPress: settings.pasteLongPress,
    runningTransfers,
    onTogglePointerMode: togglePointerMode,
    onToggleKeyboard: () => {
      // Synchronous on purpose (iOS raises the keyboard only inside the tap).
      if (menu !== null) setMenu(null);
      toggleKeyboard();
    },
    onToggleKeyBar: () => setKeyBarMode(keyBarVisible ? 'hidden' : 'shown'),
    onPaste: () => {
      setMenu(null);
      paste();
    },
    onTypeClipboard: () => {
      setMenu(null);
      typeClipboard();
    },
    onView: () => setMenu('view'),
    onZoomReset: () => {
      controller.resetZoom();
      showToast(t.toasts.zoomReset);
    },
    onZoom: (f) => controller.zoomBy(f),
    onCombos: () => setMenu('combos'),
    onKeySets: () => setMenu('keypicker'),
    onCtrlAltDel: () => {
      runComboText('Ctrl+Alt+Del');
      showToast(t.toasts.sentCombo('Ctrl+Alt+Del'));
      setMenu(null);
    },
    onClipboard: () => setMenu('clipboard'),
    onFiles: () => setMenu('files'),
    onToggleAudio: toggleAudio,
    onToggleMic: toggleMic,
    onToggleViewOnly: toggleViewOnly,
    onOptions: () => setMenu('input'),
    onInfo: () => setMenu('info'),
    onMinimize: () => {
      setMenu(null);
      nativeHideKeyboard();
      onMinimize?.();
    },
    onDisconnect: exit,
  };

  const toolbar = (
    <Toolbar
      ref={toolbarRef}
      style={toolbarStyle}
      labels={settings.toolbarLabels}
      expanded={docked || toolbarExpanded}
      onExpandedChange={(v) => {
        setToolbarExpanded(v);
        bump();
      }}
      immersive={settings.immersive}
      context={actionContext}
      items={settings.toolbarItems}
      onOpenMore={() => setMenu('more')}
      moreBadge={runningTransfers}
      onActivity={bump}
    />
  );
  const keyBarSlot = (
    <div ref={keyBarRef} className="omg-keybar-slot">
      {textBarVisible && (
        <TextInputBar
          onSend={(text, enter) => {
            if (text !== '') controller.typeText(text);
            if (enter) controller.pressKey('Enter');
          }}
          onHideKeyboard={() => {
            controller.hideKeyboard();
            nativeHideKeyboard();
          }}
        />
      )}
      {keyBarVisible && (
        <KeyBar
          modifiers={snap.modifiers}
          layout={activeSet.rows}
          onKey={(name) => controller.pressKey(name)}
          onModifier={(mod) => controller.tapModifier(mod)}
          onCombo={runComboText}
          onText={(text) => controller.typeText(text)}
          onSaved={runSaved}
          combos={library.combos}
          setName={keySetName(activeSet)}
          onNextSet={() => chooseSet(stepSet(sets, activeSet.id, 1).id, true)}
          {...(settings.keySetLongPress ? { onPickSet: () => setMenu('keypicker') } : {})}
          {...(settings.keySetSwipe
            ? { onSwipeSet: (d: -1 | 1) => chooseSet(stepSet(sets, activeSet.id, d).id, true) }
            : {})}
          onCollapse={split ? undefined : () => setKeyBarMode('hidden')}
          keyboardActive={keyboardActive}
          onHideKeyboard={toggleKeyboard}
          {...(settings.keyBarSwipeDismiss
            ? {
                onSwipeDown: () => {
                  if (keyboardActive) toggleKeyboard();
                  else if (!split) setKeyBarMode('hidden');
                },
              }
            : {})}
        />
      )}
    </div>
  );

  return (
    <SheetSwipeContext.Provider value={settings.sheetSwipeClose}>
      <div
        ref={rootRef}
        className="omg-session"
        style={rootStyle}
        data-pointer-mode={effectiveMode}
        data-keyboard={snap.keyboardActive ? 'open' : 'closed'}
        data-split={split ? 'on' : 'off'}
        data-immersive={settings.immersive ? 'on' : 'off'}
        data-toolbar={toolbarStyle}
        data-cutout={landscape ? cutout : 'unknown'}
        data-active={active ? 'true' : 'false'}
        aria-hidden={active ? undefined : true}
      >
        <div ref={probeRef} className="omg-safe-probe" aria-hidden="true" />
        <div ref={stageRef} className="omg-stage">
          <div ref={displayRef} className="omg-display" />
          <div ref={cursorRef} className="omg-cursor" aria-hidden="true">
            <div data-cursor-image="" />
            <div data-cursor-fallback="">
              <CursorArrow />
            </div>
          </div>
          <div
            ref={gestureRef}
            className="omg-gesture"
            role="application"
            aria-label={t.screen.remoteDesktop(title)}
            aria-roledescription={t.screen.remoteDesktopRole}
          />
        </div>
        {split && (
          <div
            ref={surfaceRef}
            className="omg-trackpad"
            role="application"
            aria-label={t.screen.trackpadSurface}
            aria-roledescription={t.screen.trackpadRole}
          >
            <span className="omg-trackpad__hint" aria-hidden="true">
              {t.common.trackpad}
            </span>
          </div>
        )}

        <textarea
          ref={fieldRef}
          className="omg-text-input"
          aria-label={t.screen.keyboardInput}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          inputMode="text"
          rows={1}
          tabIndex={active ? undefined : -1}
          data-gramm="false"
          data-1p-ignore=""
          data-lpignore="true"
        />

        <div ref={chromeRef} className="omg-chrome" hidden={!active}>
          {active && (
            <>
              {isDemo && <div className="omg-badge">{t.common.demo}</div>}
              {docked && !dockBottom && toolbar}
              <div ref={dockRef} className="omg-dock">
                {dockBottom ? (
                  <>
                    {keyBarSlot}
                    {toolbar}
                  </>
                ) : (
                  <>
                    {!docked && toolbar}
                    {keyBarSlot}
                  </>
                )}
              </div>

              <SheetBackContext.Provider value={menuBack}>
                {menu === 'more' && (
                  <MoreSheet
                    context={actionContext}
                    pointerMode={effectiveMode}
                    audioActive={snap.audioStreams > 0}
                    hasFilesystem={transferSnap.filesystems.length > 0}
                    toggles={{
                      naturalScroll: settings.naturalScroll,
                      tapDrag: settings.tapDrag,
                      largeCursor: settings.largeCursor,
                      textInputBar: settings.textInputBar,
                      split,
                      immersive: settings.immersive,
                    }}
                    onToggle={(key, on) => {
                      if (key === 'split') onSettingsChange({ splitLayout: on ? 'on' : 'off' });
                      else onSettingsChange({ [key]: on });
                    }}
                    onEditToolbar={() => setMenu('toolbar')}
                    quality={settings.quality}
                    audio={settings.audio}
                    viewOnly={settings.viewOnly}
                    reconnectToApply={snap.reconnectToApply}
                    onQuality={(q) => onSettingsChange({ quality: q })}
                    onAudio={(a) => onSettingsChange({ audio: a })}
                    onReconnect={() => {
                      setMenu(null);
                      controller.reconnect();
                    }}
                    terminal={
                      terminal
                        ? terminalControls(snap.mutableArguments, (n, v) =>
                            controller.setArgument(n, v),
                          )
                        : null
                    }
                    {...(props.sharing ? { onShare: () => setMenu('share') } : {})}
                    onClose={closeMenu}
                  />
                )}
                {menu === 'toolbar' && (
                  <ToolbarEditor
                    items={settings.toolbarItems}
                    style={settings.toolbarStyle}
                    labels={settings.toolbarLabels}
                    context={actionContext}
                    onItems={(items) => onSettingsChange({ toolbarItems: items })}
                    onStyle={(s) => onSettingsChange({ toolbarStyle: s })}
                    onLabels={(l) => onSettingsChange({ toolbarLabels: l })}
                    onClose={closeMenu}
                  />
                )}
                {menu === 'files' && (
                  <FilesSheet
                    transfers={controller.transfers}
                    connected={connected}
                    onClose={closeMenu}
                  />
                )}
                {menu === 'clipboard' && (
                  <ClipboardSheet
                    history={clipHistory}
                    terminal={terminal}
                    onSend={sendToRemote}
                    onType={typeText}
                    onCopyToDevice={(text) => {
                      void writeDeviceClipboard(text).then((ok) =>
                        showToast(
                          ok
                            ? sessionStrings.toasts.copiedToDevice
                            : sessionStrings.toasts.copyFailed,
                        ),
                      );
                    }}
                    onReadDevice={async () => {
                      const r = await readDeviceClipboard();
                      if (!r.ok) {
                        showToast(r.reason);
                        return null;
                      }
                      return r.text;
                    }}
                    onClear={() => clipDispatch({ type: 'clear' })}
                    onClose={closeMenu}
                  />
                )}
                {menu === 'share' && props.sharing && (
                  <ShareSheet
                    sharing={props.sharing}
                    tunnelUuid={controller.tunnelUuid()}
                    onClose={closeMenu}
                  />
                )}
                {menu === 'info' && (
                  <InfoSheet
                    title={title}
                    protocol={protocol}
                    isDemo={isDemo}
                    settings={settings}
                    getInfo={controller.getInfo}
                    keepAwake={
                      settings.keepAwake
                        ? t.info.keepAwake[keepAwakeState]
                        : t.info.keepAwakeOffInSettings
                    }
                    mutableArguments={snap.mutableArguments}
                    {...(props.onEditConnection
                      ? { onEditConnection: props.onEditConnection }
                      : {})}
                    onSetArgument={(name, value) => {
                      const ok = controller.setArgument(name, value);
                      showToast(
                        ok
                          ? sessionStrings.toasts.argumentSent
                          : sessionStrings.toasts.argumentLocked,
                      );
                      return ok;
                    }}
                    onClose={closeMenu}
                  />
                )}
                {menu === 'view' && (
                  <ViewMenu
                    zoomResetGesture={settings.gestureZoomReset && effectiveMode !== 'touch'}
                    fitMode={settings.fitMode}
                    matchDeviceSize={settings.matchDeviceSize}
                    protocol={protocol}
                    onFitMode={(m) => {
                      onSettingsChange({ fitMode: m });
                      showToast(
                        m === settings.fitMode
                          ? t.toasts.viewReset
                          : t.toasts.view(t.fitModes.labels[m].toLowerCase()),
                      );
                      if (m === settings.fitMode) controller.resetZoom();
                    }}
                    onResetZoom={() => {
                      controller.resetZoom();
                      showToast(t.toasts.zoomReset);
                    }}
                    onZoom={(f) => controller.zoomBy(f)}
                    onMatchDeviceSize={(on) => {
                      onSettingsChange({ matchDeviceSize: on });
                      showToast(on ? t.toasts.matchOn : t.toasts.matchOff);
                    }}
                    onClose={closeMenu}
                  />
                )}
                {menu === 'input' && (
                  <InputMenu
                    settings={settings}
                    touchSupport={snap.touchSupport}
                    overridden={overridden}
                    onChange={onSettingsChange}
                    {...(props.onUseDefault ? { onUseDefault: useDefault } : {})}
                    onEditList={(editor) =>
                      setMenu(
                        editor === 'toolbar'
                          ? 'toolbar'
                          : editor === 'keySets'
                            ? 'keysets'
                            : 'combos',
                      )
                    }
                    summaryContext={{ keySetName: () => keySetName(activeSet) }}
                    onClose={closeMenu}
                  />
                )}
                {menu === 'keypicker' && (
                  <KeySetPicker
                    sets={sets}
                    activeId={activeSet.id}
                    onUse={(id) => chooseSet(id, true)}
                    onManage={() => setMenu('keysets')}
                    onClose={closeMenu}
                  />
                )}
                {menu === 'keysets' && (
                  <KeySetManager
                    library={library}
                    onLibrary={setLibrary}
                    activeId={activeSet.id}
                    onUse={(id) => chooseSet(id)}
                    legacy={legacy}
                    onCombos={() => setMenu('combos')}
                    {...(props.saveTextFile ? { saveFile: props.saveTextFile } : {})}
                    onClose={closeMenu}
                  />
                )}
                {menu === 'combos' && (
                  <ComboMenu
                    combos={library.combos}
                    legacy={settings.customCombos}
                    onRun={runSteps}
                    onLibrary={libraryAction}
                    newId={() => newComboId(library)}
                    onTypeClipboard={typeClipboard}
                    onClose={closeMenu}
                  />
                )}
              </SheetBackContext.Provider>

              {transferSnap.prompts[0] && !prompt && (
                <IncomingFileSheet
                  prompt={transferSnap.prompts[0]}
                  waiting={transferSnap.prompts.length - 1}
                  onAnswer={(accept) => {
                    const pr = transferSnap.prompts[0];
                    if (!pr) return;
                    controller.transfers.answerIncoming(pr.id, accept);
                    if (!accept) showToast(t.files.declined(pr.filename));
                  }}
                />
              )}
              {prompt ? (
                <CredentialSheet
                  title={title}
                  fields={prompt}
                  onSubmit={(values) => controller.submitCredentials(values)}
                  onCancel={() => {
                    // As the web client: disconnect; the overlay then offers Reconnect.
                    controller.cancelCredentials();
                    nativeHideKeyboard();
                  }}
                />
              ) : snap.quietReconnect ? null : (
                <StatusOverlay
                  phase={snap.phase}
                  title={title}
                  onRetry={() => controller.retry()}
                  onClose={exit}
                />
              )}

              {snap.viewOnly ||
              snap.reconnectToApply ||
              snap.quietReconnect ||
              snap.microphone !== 'off' ||
              snap.viewers.length > 0 ? (
                <div className="omg-pills">
                  {snap.microphone !== 'off' ? (
                    <ChromeButton
                      className="omg-pill omg-pill--mic"
                      aria-label={t.mic.stop}
                      onClick={toggleMic}
                    >
                      <IconMic off={false} />{' '}
                      {snap.microphone === 'live' ? t.mic.live : t.mic.starting}
                    </ChromeButton>
                  ) : null}
                  {snap.viewers.length > 0 ? (
                    <ChromeButton
                      className="omg-pill omg-pill--viewers"
                      onClick={() =>
                        showToast(
                          t.viewers.list(
                            snap.viewers.map((n) => n || t.viewers.anonymous).join(', '),
                          ),
                        )
                      }
                    >
                      <IconViewers /> {t.viewers.pill(snap.viewers.length)}
                    </ChromeButton>
                  ) : null}
                  {snap.quietReconnect ? (
                    <span className="omg-pill" role="status">
                      {t.screen.resuming}
                    </span>
                  ) : null}
                  {snap.viewOnly ? (
                    <ChromeButton className="omg-pill omg-pill--viewonly" onClick={toggleViewOnly}>
                      <IconEye off={false} /> {t.screen.viewOnlyPill}
                    </ChromeButton>
                  ) : null}
                  {snap.reconnectToApply ? (
                    <ChromeButton className="omg-pill" onClick={() => controller.reconnect()}>
                      {t.screen.reconnectToApply}
                    </ChromeButton>
                  ) : null}
                </div>
              ) : null}

              <div className="omg-toast-region" role="status" aria-live="polite">
                {toast && (
                  <div key={toast.id} className="omg-toast">
                    {toast.text}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </SheetSwipeContext.Provider>
  );
}

/** − / + font size and colour scheme for terminal sessions, when the server offers them. */
function terminalControls(
  args: readonly { name: string; value: string }[],
  set: (name: string, value: string) => boolean,
): TerminalControls | null {
  const font = args.find((a) => a.name === 'font-size');
  const scheme = args.find((a) => a.name === 'color-scheme');
  if (!font && !scheme) return null;
  return {
    fontSize: font ? parseFontSize(font.value) : null,
    colorScheme: scheme ? scheme.value || 'gray-black' : null,
    onFontStep: (delta) => {
      if (font) set('font-size', String(stepFontSize(parseFontSize(font.value), delta)));
    },
    onNextScheme: () => {
      if (scheme) set('color-scheme', nextColorScheme(scheme.value));
    },
  };
}
