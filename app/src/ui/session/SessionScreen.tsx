import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type JSX,
} from 'react';
import type { TunnelLike } from '../../core/transport/TunnelLike.ts';
import type { Combo } from '../../session/keys/KeyModel.ts';
import { ComboMenu } from './ComboMenu.tsx';
import { CursorArrow } from './icons.tsx';
import { KeyBar } from './KeyBar.tsx';
import {
  keepScreenAwake,
  nativeHideKeyboard,
  nativeShowKeyboard,
  onForeground,
  onNativeKeyboard,
  playHaptic,
  readDeviceClipboard,
  writeDeviceClipboard,
} from './platform.ts';
import { SessionController } from './SessionController.ts';
import { POINTER_MODE_LABELS, type SessionSettings } from './settings.ts';
import { StatusOverlay } from './StatusOverlay.tsx';
import { Toolbar } from './Toolbar.tsx';
import { ViewMenu } from './ViewMenu.tsx';
import './SessionScreen.css';

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
}

/** Longest clipboard text typed as keystrokes (each character is two key events). */
const MAX_TYPED_CHARS = 4000;
const TOOLBAR_AUTOHIDE_MS = 5000;

type Menu = 'view' | 'combos' | null;
type KeyBarMode = 'auto' | 'shown' | 'hidden';

const POINTER_MODE_HINT = {
  direct: 'Tap to click, long-press for right click, drag to pan',
  trackpad: 'Drag to move the pointer, tap to click, two-finger tap for right click',
} as const;

export function SessionScreen(props: SessionScreenProps): JSX.Element {
  const { title, settings, onSettingsChange, onExit, isDemo, protocol } = props;
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const showToast = useCallback((text: string) => setToast({ id: Date.now(), text }), []);

  const [controller] = useState(() => new SessionController(settings));
  const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot);

  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const displayRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const chromeRef = useRef<HTMLDivElement>(null);
  const keyBarRef = useRef<HTMLDivElement>(null);

  // ---- Controller lifecycle. Options first (effects run in order), then attach.
  useEffect(() => {
    controller.setOptions({
      createTunnel: () => latest.current.createTunnel(),
      buildConnectData: (size) => latest.current.buildConnectData(size),
      haptic: playHaptic,
      onRemoteClipboard: (text) => {
        if (!latest.current.settings.clipboardRemoteToDevice) return;
        void writeDeviceClipboard(text).then((ok) => {
          if (ok) setToast({ id: Date.now(), text: 'Remote clipboard copied to this device' });
        });
      },
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

  // ---- Key bar: docked above the keyboard; its height is part of the keyboard inset
  const [keyBarMode, setKeyBarMode] = useState<KeyBarMode>('auto');
  const keyBarVisible = keyBarMode === 'shown' || (keyBarMode === 'auto' && snap.keyboardActive);
  useEffect(() => {
    const el = keyBarRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => controller.setKeyBarHeight(el.offsetHeight));
    ro.observe(el);
    controller.setKeyBarHeight(el.offsetHeight);
    return () => ro.disconnect();
  }, [controller, keyBarVisible]);

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
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  // ---- Keep-awake (DSP-7)
  useEffect(() => {
    if (!settings.keepAwake || !connected) return;
    const lock = keepScreenAwake();
    return () => lock.dispose();
  }, [settings.keepAwake, connected]);

  // ---- Clipboard auto-send on foreground (CLP-1, opt-in; CLP-4: never read otherwise)
  const lastAutoSent = useRef<string | null>(null);
  useEffect(() => {
    if (!settings.clipboardAutoSendOnFocus) return;
    const sub = onForeground(() => {
      if (!controller.isConnected()) return;
      void readDeviceClipboard().then((r) => {
        if (!r.ok || r.text === '' || r.text === lastAutoSent.current) return;
        if (controller.sendClipboard(r.text)) {
          lastAutoSent.current = r.text;
          setToast({ id: Date.now(), text: 'Device clipboard sent to the remote' });
        }
      });
    });
    return () => sub.dispose();
  }, [controller, settings.clipboardAutoSendOnFocus]);

  // ---- Commands
  const exit = useCallback(() => {
    controller.disconnect();
    nativeHideKeyboard();
    onExit();
  }, [controller, onExit]);

  const togglePointerMode = () => {
    const next = settings.pointerMode === 'direct' ? 'trackpad' : 'direct';
    onSettingsChange({ pointerMode: next });
    showToast(`${POINTER_MODE_LABELS[next]}: ${POINTER_MODE_HINT[next]}`);
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

  const paste = () => {
    void readDeviceClipboard().then((r) => {
      if (!r.ok) return showToast(r.reason);
      if (r.text === '') return showToast('The device clipboard is empty');
      if (controller.sendClipboard(r.text)) {
        showToast(`Clipboard sent (${[...r.text].length} characters). Paste on the remote.`);
      } else {
        showToast('Not connected');
      }
    });
  };

  const typeClipboard = () => {
    void readDeviceClipboard().then((r) => {
      if (!r.ok) return showToast(r.reason);
      if (r.text === '') return showToast('The device clipboard is empty');
      if (!controller.isConnected()) return showToast('Not connected');
      const chars = [...r.text];
      const text = chars.slice(0, MAX_TYPED_CHARS).join('');
      controller.typeText(text);
      showToast(
        chars.length > MAX_TYPED_CHARS
          ? `Typed the first ${MAX_TYPED_CHARS} characters`
          : `Typed ${chars.length} characters`,
      );
    });
  };

  const runCombo = (combo: Combo, label: string) => {
    controller.runCombo(combo);
    showToast(`Sent ${label}`);
  };

  const rootStyle = {
    '--omg-kb-cover': `${snap.keyboardCover}px`,
  } as CSSProperties;

  return (
    <div
      ref={rootRef}
      className="omg-session"
      style={rootStyle}
      data-pointer-mode={settings.pointerMode}
      data-keyboard={snap.keyboardActive ? 'open' : 'closed'}
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
          aria-label={`Remote desktop: ${title}`}
          aria-roledescription="remote desktop"
        />
      </div>

      <textarea
        ref={fieldRef}
        className="omg-text-input"
        aria-label="Keyboard input for the remote desktop"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        inputMode="text"
        rows={1}
        data-gramm="false"
        data-1p-ignore=""
        data-lpignore="true"
      />

      <div ref={chromeRef} className="omg-chrome">
        {isDemo && <div className="omg-badge">Demo</div>}
        <div className="omg-dock">
          <Toolbar
            expanded={toolbarExpanded}
            onExpandedChange={(v) => {
              setToolbarExpanded(v);
              bump();
            }}
            pointerMode={settings.pointerMode}
            onTogglePointerMode={togglePointerMode}
            onOpenView={() => setMenu('view')}
            keyboardActive={snap.keyboardActive}
            onToggleKeyboard={toggleKeyboard}
            keyBarOpen={keyBarVisible}
            onToggleKeyBar={() => setKeyBarMode(keyBarVisible ? 'hidden' : 'shown')}
            onPaste={paste}
            onTypeClipboard={typeClipboard}
            onOpenCombos={() => setMenu('combos')}
            onDisconnect={exit}
            onActivity={bump}
          />
          <div ref={keyBarRef} className="omg-keybar-slot">
            {keyBarVisible && (
              <KeyBar
                modifiers={snap.modifiers}
                onKey={(name) => controller.pressKey(name)}
                onModifier={(mod) => controller.tapModifier(mod)}
                onCollapse={() => setKeyBarMode('hidden')}
              />
            )}
          </div>
        </div>

        {menu === 'view' && (
          <ViewMenu
            fitMode={settings.fitMode}
            matchDeviceSize={settings.matchDeviceSize}
            protocol={protocol}
            onFitMode={(m) => {
              onSettingsChange({ fitMode: m });
              showToast(`View: ${m === settings.fitMode ? 'reset' : m.replace(/-/g, ' ')}`);
              if (m === settings.fitMode) controller.resetZoom();
            }}
            onResetZoom={() => {
              controller.resetZoom();
              showToast('Zoom reset');
            }}
            onMatchDeviceSize={(on) => {
              onSettingsChange({ matchDeviceSize: on });
              showToast(on ? 'Matching the remote to this screen' : 'Remote size left as is');
            }}
            onClose={() => setMenu(null)}
          />
        )}
        {menu === 'combos' && (
          <ComboMenu
            customCombos={settings.customCombos}
            onRun={runCombo}
            onChangeCombos={(list) => onSettingsChange({ customCombos: list })}
            onTypeClipboard={typeClipboard}
            onClose={() => setMenu(null)}
          />
        )}

        <StatusOverlay
          phase={snap.phase}
          title={title}
          onRetry={() => controller.retry()}
          onClose={exit}
        />

        <div className="omg-toast-region" role="status" aria-live="polite">
          {toast && (
            <div key={toast.id} className="omg-toast">
              {toast.text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
