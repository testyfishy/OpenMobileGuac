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
import { parseCombo, type Combo } from '../../session/keys/KeyModel.ts';
import type { PointerMode } from '../../session/pointer/PointerModel.ts';
import { ClipboardSheet } from './ClipboardSheet.tsx';
import { ComboMenu } from './ComboMenu.tsx';
import { CredentialSheet } from './CredentialSheet.tsx';
import { FilesSheet } from './FilesSheet.tsx';
import { CursorArrow } from './icons.tsx';
import { InfoSheet } from './InfoSheet.tsx';
import { InputMenu } from './InputMenu.tsx';
import { KeyBar } from './KeyBar.tsx';
import { KeyBarEditor } from './KeyBarEditor.tsx';
import { resolveKeyBarLayout } from './keyBarLayout.ts';
import { MoreSheet } from './MoreSheet.tsx';
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
import { normalizeSessionSettings, type SessionSettings } from './settings.ts';
import { isSignInFailure } from './status.ts';
import { TextInputBar } from './TextInputBar.tsx';
import { StatusOverlay } from './StatusOverlay.tsx';
import { Toolbar } from './Toolbar.tsx';
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
  buildConnectData: (size: { width: number; height: number; dpi: number }) => string;
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
}

/** Longest clipboard text typed as keystrokes (each character is two key events). */
const MAX_TYPED_CHARS = 4000;
const TOOLBAR_AUTOHIDE_MS = 5000;
/** Protocols rendered by guacd's terminal emulator. */
const TERMINAL_PROTOCOLS = new Set(['ssh', 'telnet', 'kubernetes']);

type Menu = 'view' | 'combos' | 'input' | 'keybar' | 'more' | 'files' | 'clipboard' | 'info' | null;
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
  const surfaceRef = useRef<HTMLDivElement>(null);

  // ---- Controller lifecycle. Options first (effects run in order), then attach.
  useEffect(() => {
    controller.setOptions({
      createTunnel: () => latest.current.createTunnel(),
      buildConnectData: (size) => latest.current.buildConnectData(size),
      haptic: playHaptic,
      onRemoteClipboard: (text) => {
        clipDispatch({ type: 'add', text, direction: 'from-remote', at: Date.now() });
        if (!latest.current.settings.clipboardRemoteToDevice) return;
        void writeDeviceClipboard(text).then((ok) => {
          if (ok) setToast({ id: Date.now(), text: sessionStrings.toasts.remoteClipboardCopied });
        });
      },
      onLog: (entry) => latest.current.onLog?.(entry),
      onThumbnail: (url) => latest.current.onThumbnail?.(url),
      notify: (text) => setToast({ id: Date.now(), text }),
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
    controller.setAudioMuted(settings.audioMuted);
  }, [controller, settings.audioMuted]);

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
  useEffect(() => {
    const el = keyBarRef.current;
    if (!el) return;
    const report = () => controller.setKeyBarHeight(split ? 0 : el.offsetHeight);
    const ro = new ResizeObserver(report);
    ro.observe(el);
    report();
    return () => ro.disconnect();
  }, [controller, keyBarVisible, textBarVisible, split, active]);

  // ---- Immersive (DSP-7)
  useEffect(() => {
    if (!settings.immersive || !active) return;
    const sub = enterImmersive();
    return () => sub.dispose();
  }, [settings.immersive, active]);

  // ---- Toolbar auto-hide
  const [toolbarExpanded, setToolbarExpanded] = useState(true);
  const [menu, setMenu] = useState<Menu>(null);
  const [activity, setActivity] = useState(0);
  const connected = snap.phase.kind === 'connected';
  useEffect(() => {
    if (!toolbarExpanded || menu !== null || !connected) return;
    const t = setTimeout(() => setToolbarExpanded(false), TOOLBAR_AUTOHIDE_MS);
    return () => clearTimeout(t);
  }, [toolbarExpanded, menu, connected, activity]);
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
  const lastAutoSent = useRef<string | null>(null);
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

  const runCombo = (combo: Combo, label: string) => {
    controller.runCombo(combo);
    showToast(sessionStrings.toasts.sentCombo(label));
  };

  const closeMenu = useCallback(() => setMenu(null), []);

  const splitTop =
    fold.horizontalFold && fold.foldTop !== null && settings.splitLayout !== 'off'
      ? `${fold.foldTop}px`
      : `${Math.round(SPLIT_DISPLAY_SHARE * 100)}%`;
  const rootStyle = {
    '--omg-kb-cover': `${snap.keyboardCover}px`,
    '--omg-split-top': splitTop,
  } as CSSProperties;
  const effectiveMode: PointerMode =
    settings.pointerMode === 'touch' && !touchOffered ? 'direct' : settings.pointerMode;
  const prompt = snap.credentials;

  return (
    <div
      ref={rootRef}
      className="omg-session"
      style={rootStyle}
      data-pointer-mode={effectiveMode}
      data-keyboard={snap.keyboardActive ? 'open' : 'closed'}
      data-split={split ? 'on' : 'off'}
      data-immersive={settings.immersive ? 'on' : 'off'}
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
            <div className="omg-dock">
              <Toolbar
                expanded={toolbarExpanded}
                onExpandedChange={(v) => {
                  setToolbarExpanded(v);
                  bump();
                }}
                pointerMode={effectiveMode}
                onTogglePointerMode={togglePointerMode}
                onOpenView={() => setMenu('view')}
                onZoom={(f) => controller.zoomBy(f)}
                immersive={settings.immersive}
                keyboardActive={snap.keyboardActive}
                onToggleKeyboard={toggleKeyboard}
                pasteHint={terminal ? t.screen.pasteHintTerminal : t.screen.pasteHint}
                onPaste={paste}
                onTypeClipboard={typeClipboard}
                onOpenMore={() => setMenu('more')}
                moreBadge={runningTransfers}
                onActivity={bump}
              />
              <div ref={keyBarRef} className="omg-keybar-slot">
                {textBarVisible && (
                  <TextInputBar
                    onSend={(text, enter) => {
                      if (text !== '') controller.typeText(text);
                      if (enter) controller.pressKey('Enter');
                    }}
                    onClose={() => onSettingsChange({ textInputBar: false })}
                  />
                )}
                {keyBarVisible && (
                  <KeyBar
                    modifiers={snap.modifiers}
                    layout={resolveKeyBarLayout(settings.keyBarLayout)}
                    onKey={(name) => controller.pressKey(name)}
                    onModifier={(mod) => controller.tapModifier(mod)}
                    onCombo={runComboText}
                    onCollapse={split ? undefined : () => setKeyBarMode('hidden')}
                  />
                )}
              </div>
            </div>

            {menu === 'more' && (
              <MoreSheet
                showCtrlAltDel={showCtrlAltDel}
                audioMuted={settings.audioMuted}
                audioActive={snap.audioStreams > 0}
                keyBarOpen={keyBarVisible}
                activeTransfers={runningTransfers}
                hasFilesystem={transferSnap.filesystems.length > 0}
                onFiles={() => setMenu('files')}
                onClipboard={() => setMenu('clipboard')}
                onToggleAudio={() => {
                  const muted = !settings.audioMuted;
                  onSettingsChange({ audioMuted: muted });
                  showToast(muted ? t.toasts.soundOff : t.toasts.soundOn);
                }}
                onToggleKeyBar={() => {
                  setKeyBarMode(keyBarVisible ? 'hidden' : 'shown');
                  setMenu(null);
                }}
                onInput={() => setMenu('input')}
                onCombos={() => setMenu('combos')}
                onCtrlAltDel={() => {
                  runComboText('Ctrl+Alt+Del');
                  showToast(t.toasts.sentCombo('Ctrl+Alt+Del'));
                  setMenu(null);
                }}
                onTypeClipboard={() => {
                  setMenu(null);
                  typeClipboard();
                }}
                onInfo={() => setMenu('info')}
                onMinimize={
                  onMinimize
                    ? () => {
                        setMenu(null);
                        nativeHideKeyboard();
                        onMinimize();
                      }
                    : undefined
                }
                onDisconnect={exit}
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
                      ok ? sessionStrings.toasts.copiedToDevice : sessionStrings.toasts.copyFailed,
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
                onSetArgument={(name, value) => {
                  const ok = controller.setArgument(name, value);
                  showToast(
                    ok ? sessionStrings.toasts.argumentSent : sessionStrings.toasts.argumentLocked,
                  );
                  return ok;
                }}
                onClose={closeMenu}
              />
            )}
            {menu === 'view' && (
              <ViewMenu
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
                onChange={onSettingsChange}
                onEditKeyBar={() => setMenu('keybar')}
                onClose={closeMenu}
              />
            )}
            {menu === 'keybar' && (
              <KeyBarEditor
                layout={settings.keyBarLayout}
                customCombos={settings.customCombos}
                onChange={(layout) => onSettingsChange({ keyBarLayout: layout })}
                onClose={closeMenu}
              />
            )}
            {menu === 'combos' && (
              <ComboMenu
                customCombos={settings.customCombos}
                onRun={runCombo}
                onChangeCombos={(list) => onSettingsChange({ customCombos: list })}
                onTypeClipboard={typeClipboard}
                onClose={closeMenu}
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
            ) : (
              <StatusOverlay
                phase={snap.phase}
                title={title}
                onRetry={() => controller.retry()}
                onClose={exit}
              />
            )}

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
  );
}
