/**
 * SessionController: the imperative heart of the session screen. It owns the Guacamole
 * client and tunnel, the display element, the pure session models (Viewport,
 * GestureRecognizer, PointerModel, KeyModel, TextInputDiff) and all DOM listeners, and
 * writes per-frame state (display transform, cursor position) straight to the DOM.
 *
 * React only renders the chrome; it reads discrete state through `subscribe` /
 * `getSnapshot` (for `useSyncExternalStore`) and calls the command methods.
 */

import { PipFeed, pipAvailable, pipWanted } from './pipFeed.ts';
import Guacamole from '../../vendor/guacamole-common-js';
import { resumeNeedsReconnect } from '../sessions/backgroundPolicy.ts';
import {
  TERMINAL_PROTOCOLS,
  fontSizeAfterPinch,
  parseFontSize,
} from '../../session/terminalFont.ts';
import {
  requestedDisplaySize,
  requestsAudio,
  resizeDebounceMs,
  type DisplayRequest,
  type Quality,
} from '../../session/viewport/remoteSize.ts';
import { TunnelState, type TunnelLike } from '../../core/transport/TunnelLike.ts';
import {
  GestureRecognizer,
  type Gesture,
  type PointerInput,
} from '../../session/gesture/GestureRecognizer.ts';
import {
  HardwareKeyboard,
  decideHardwareKey,
  isModifierKey,
  mapCommandKey,
} from '../../session/keys/HardwareKeyboard.ts';
import { comboSchedule, type ComboStep } from '../../session/keys/ComboLibrary.ts';
import { onTapRecognised, onTouchDown } from './tapDismiss.ts';
import {
  KEYSYM,
  KeyModel,
  type Combo,
  type KeyEvent,
  type Modifier,
  type ModifierState,
} from '../../session/keys/KeyModel.ts';
import {
  caretResync,
  diffTextInput,
  initialTextInput,
  textInputKeyEvents,
} from '../../session/keys/TextInputDiff.ts';
import {
  PointerModel,
  ScrollAccumulator,
  wheelStates,
  type HapticHint,
  type MouseState,
  type PointerMode,
  type PointerOutput,
} from '../../session/pointer/PointerModel.ts';
import { TouchPassthrough, type TouchContact } from '../../session/pointer/TouchPassthrough.ts';
import {
  applyViewportCommands,
  createViewport,
  setAlignX,
  ensureVisible,
  isFlinging,
  isZoomedIn,
  relayout,
  remoteToScreen,
  resetToMode,
  scaleOf,
  screenToRemote,
  setMode,
  stepFling,
  toCssTransform,
  visibleRect,
  zoomAt,
  type Insets,
  type Size,
  type ViewportState,
} from '../../session/viewport/Viewport.ts';
import {
  extraButtonCombo,
  penButtons,
  pointerButtons,
  pointerKind,
  toGuacMouseTemplate,
  wheelDeltaPx,
} from './inputMapping.ts';
import {
  argumentValues,
  describeRequiredParams,
  type RequiredField,
} from '../../session/credentials/requiredParams.ts';
import { RequiredAnswerGuard } from '../../session/credentials/rememberedParams.ts';
import { ArgvTracker, sendArgumentValues, type MutableArgument } from './argv.ts';
import { SessionAudio } from './audio.ts';
import { SessionMicrophone, type MicProblem, type MicState } from './microphone.ts';
import { readTextStream, writeTextStream } from './clipboardText.ts';
import { createFileReceiver, type StreamRequest } from './fileSave.ts';
import { isOnline, onAppResume, onNetworkChange } from './platform.ts';
import { sessionStrings } from './sessionStrings.ts';
import { TransferManager } from './transfers.ts';
import { computeLayout, cursorDrawScale, visualViewportInset } from './layout.ts';
import {
  gestureConfigFromSettings,
  normalizeSessionSettings,
  pointerConfigFromSettings,
  type ResolvedSessionSettings,
  type SessionSettings,
} from './settings.ts';
import {
  INITIAL_SESSION_MACHINE,
  isRetryableStatus,
  phaseChanged,
  reduceSession,
  type SessionEvent,
  type SessionMachine,
  type SessionPhase,
} from './status.ts';

export interface SessionElements {
  /** Full-screen stage; its box is the Viewport's "screen". */
  readonly stage: HTMLElement;
  /** Receives the display element and the CSS transform. */
  readonly displayHost: HTMLElement;
  /** Transparent overlay receiving pointer events. */
  readonly gestureLayer: HTMLElement;
  /** Cursor overlay element (positioned by the controller). */
  readonly cursor: HTMLElement;
  /** Hidden text field for the soft keyboard. */
  readonly field: HTMLTextAreaElement;
  /** Element whose padding is `env(safe-area-inset-*)`. */
  readonly safeAreaProbe: HTMLElement;
  /** Root of the chrome (buttons etc.): keys typed while focus is inside it are ignored. */
  readonly chromeRoot: HTMLElement;
}

export interface SessionSnapshot {
  readonly phase: SessionPhase;
  readonly zoomed: boolean;
  readonly modifiers: Readonly<Record<Modifier, ModifierState>>;
  /** Whether the hidden field is focused (soft keyboard requested). */
  readonly keyboardActive: boolean;
  /** Height (px) of the stage covered by the soft keyboard, for docking the key bar. */
  readonly keyboardCover: number;
  readonly remoteSize: Size;
  /** Touches the server accepts (RDP multi-touch, PTR-6); 0 = touch pass-through unavailable. */
  readonly touchSupport: number;
  /** A hardware key was seen recently (KEY-6): the soft keyboard is probably not shown. */
  readonly hardwareKeyboard: boolean;
  /** The hardware mouse is captured (pointer lock). */
  readonly pointerLocked: boolean;
  /** The server asked for these parameters (`required`); null when no prompt is open. */
  readonly credentials: readonly RequiredField[] | null;
  /** The session is shown (the `active` prop). */
  readonly active: boolean;
  /** Audio streams the server opened in this connection. */
  readonly audioStreams: number;
  /** Connection parameters the server lets the user change in session (`argv`). */
  readonly mutableArguments: readonly MutableArgument[];
  /** Reconnecting right after a return to the app: show a small pill, not the overlay. */
  readonly quietReconnect: boolean;
  /** Quality, size or audio settings changed since connecting: offer "Reconnect to apply". */
  readonly reconnectToApply: boolean;
  /** View only: no input reaches the remote. */
  readonly viewOnly: boolean;
  /**
   * Other users connected to this session, by name ('' = anonymous, e.g. a share link), as
   * announced by guacd's `msg` USER_JOINED / USER_LEFT (sent to the owner only).
   */
  readonly viewers: readonly string[];
  /** AUD-2: the microphone stream (`live` = audio is being sent). */
  readonly microphone: MicState;
}

export type SessionLogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * SRV-11: remembered answers to the server's `required` prompt, already bound to this
 * session's server and connection by the host (values never go to another one).
 */
export interface CredentialMemory {
  /** Values for every requested name, or null (then the prompt is shown). */
  recall(names: readonly string[]): Promise<Readonly<Record<string, string>> | null>;
  /** Keep (or refresh the last use of) values that led to a connected session. */
  remember(names: readonly string[], values: Readonly<Record<string, string>>): void;
  /** Values that were rejected, or that the user chose not to remember. */
  forget(names: readonly string[]): void;
}

export interface SessionControllerOptions {
  readonly createTunnel: () => TunnelLike;
  readonly buildConnectData: (size: ConnectSize) => string;
  readonly haptic: (hint: HapticHint) => void;
  /** Text arrived from the remote clipboard. */
  readonly onRemoteClipboard: (text: string) => void;
  /** Lifecycle log: never secrets, clipboard contents or typed text. */
  readonly onLog?: (entry: { level: SessionLogLevel; message: string }) => void;
  /** A small JPEG data URL of the remote screen. */
  readonly onThumbnail?: (dataUrl: string) => void;
  /** Short user-facing notice (toast), e.g. a finished download. */
  readonly notify?: (text: string) => void;
  /** Hide the native soft keyboard (tap-to-dismiss; the field is blurred as well). */
  readonly hideNativeKeyboard?: () => void;
  /**
   * Called before every (re)connect. A promise holds the connect until it settles: the app
   * lock uses it so no reconnect sends the stored token while the lock screen is up.
   */
  readonly connectGate?: () => Promise<void> | null;
  /**
   * Someone else's session (joined from the admin list, or opened from a share link): the
   * view is never followed with `size`, which would resize the owner's desktop.
   */
  readonly sharedViewer?: boolean;
  /**
   * AUD-2: the microphone stopped on its own (server refused audio input, access denied,
   * not available). The host turns "Send microphone" off.
   */
  readonly onMicrophoneProblem?: (problem: MicProblem) => void;
  /**
   * FIL-1: the web application's stream download request for a stream of this tunnel
   * (`api/session/tunnels/{uuid}/streams/{index}/{name}` with the token header), or null
   * when downloads must stay in band (Demo, no server).
   */
  readonly streamDownload?: (
    tunnelUuid: string,
    streamIndex: number,
    filename: string,
  ) => StreamRequest | null;
  /** SRV-11: remembered prompt answers; null or absent = always ask. Read at each prompt. */
  readonly credentialMemory?: () => CredentialMemory | null;
}

/** The `size` sent at connect, plus whether audio types are advertised (Quality, AUD-1). */
export interface ConnectSize {
  readonly width: number;
  readonly height: number;
  readonly dpi: number;
  /** false: advertise no audio mimetypes, so guacd sends no audio. Default true. */
  readonly audio?: boolean;
}

/** Figures for the session info sheet. */
export interface SessionInfo {
  readonly remoteSize: Size;
  /** What was asked for at connect (null before the first connect). */
  readonly requested:
    (DisplayRequest & { readonly audio: boolean; readonly quality: Quality }) | null;
  /** Received data rate over the last few seconds, kbit/s; null until measurable. */
  readonly receivedKbps: number | null;
  /** Remote pixels → CSS pixels. */
  readonly scale: number;
  readonly tunnelType: string;
  readonly connectedForMs: number | null;
  readonly receivedBytes: number;
  readonly receivedInstructions: number;
  readonly sentBytes: number;
  readonly sentInstructions: number;
  /** `sync` instructions received (one per server frame). */
  readonly frames: number;
  /** From `Guacamole.Display.Statistics` (sync-based); null when not yet known. */
  readonly processingLagMs: number | null;
  readonly serverFps: number | null;
  readonly clientFps: number | null;
  readonly desktopFps: number | null;
  readonly dropRate: number | null;
  readonly tunnelState: string;
  readonly audioContext: string;
  readonly online: boolean;
}

const MATCH_SIZE_DEBOUNCE_MS = 400;

/** The settings a connection is made with; a change means "Reconnect to apply". */
function connectSettingsKey(s: ResolvedSessionSettings): string {
  return [
    s.quality,
    s.audio === 'off' ? 'noaudio' : 'audio',
    s.remoteResolution,
    s.remoteResolution === 'custom' ? `${s.remoteWidth}x${s.remoteHeight}` : '',
    s.remoteScale,
  ].join('|');
}

/** How long after a return to the app a drop is reconnected quietly (no overlay, no delay). */
const QUIET_RECONNECT_MS = 10_000;
/** After a return to the app, look at the tunnel this much later (longer than UNSTABLE's 1.5 s). */
const RESUME_CHECK_MS = 2000;
/** How often `whenTunnelAlive` looks again. */
const TUNNEL_ALIVE_POLL_MS = 250;
function devicePixelRatio(): number {
  const r = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
  return Number.isFinite(r) && r > 0 ? r : 1;
}
const FOLLOW_MARGIN_PX = 48;
const MOUSE_WHEEL_STEP_PX = 50;
/** Wait before acting on a caret move in the hidden field (IMEs move it transiently). */
const CARET_SETTLE_MS = 80;
/** Large-cursor scale factor. */
const LARGE_CURSOR_SCALE = 1.75;
/** First thumbnail this long after connecting (the desktop has usually drawn by then). */
const FIRST_THUMBNAIL_MS = 1500;
/** At most one thumbnail per this interval while shown. */
const THUMBNAIL_INTERVAL_MS = 30_000;
const THUMBNAIL_MAX_WIDTH = 320;
/** `Display.statisticWindow` (ms): frame statistics for the info sheet. */
const STATISTIC_WINDOW_MS = 5000;

type GuacClient = InstanceType<typeof Guacamole.Client>;

export class SessionController {
  private opts: SessionControllerOptions | null = null;
  private settings: ResolvedSessionSettings;
  private els: SessionElements | null = null;

  // Models
  private viewport: ViewportState;
  private readonly recognizer = new GestureRecognizer();
  /** Split layout trackpad surface: always a trackpad. */
  private readonly surfaceRecognizer = new GestureRecognizer();
  private surface: HTMLElement | null = null;
  private readonly surfaceCleanups: (() => void)[] = [];
  private readonly pointer: PointerModel;
  private readonly keys = new KeyModel();
  private readonly hw = new HardwareKeyboard();
  private readonly wheel = new ScrollAccumulator(MOUSE_WHEEL_STEP_PX);
  private readonly wheelX = new ScrollAccumulator(MOUSE_WHEEL_STEP_PX);
  private readonly touches = new TouchPassthrough(0);
  private touchSupport = 0;
  private lastMouseButtons = 0;
  private pointerLocked = false;
  private hardwareKeyboardSeen = false;
  private baseline = initialTextInput();
  private composing = false;
  /** A flush was asked for during a composition: it runs when the composition ends. */
  private flushAfterComposition = false;
  private caretTimer: ReturnType<typeof setTimeout> | null = null;
  private cursorHidden = false;

  // Connection
  private client: GuacClient | null = null;
  private tunnel: TunnelLike | null = null;
  private generation = 0;
  private machine: SessionMachine = INITIAL_SESSION_MACHINE;
  /** Set while we close on purpose (user, unmount, retry teardown). */
  private closingOnPurpose = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** A connect is waiting on `connectGate`. */
  private gateHeld = false;
  private protocol = '';
  /** When the page was last hidden (app in the background), for the resume decision. */
  private hiddenAt: number | null = null;
  /** When the current tunnel last delivered an instruction (diagnostics). */
  private lastRxAt = 0;
  /** Until this time, reconnects are immediate and the overlay stays hidden. */
  private quietUntil = 0;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  /** When the resume check last found the tunnel open (its pings answered while back). */
  private resumeCheckedAt = 0;
  /** `connectSettingsKey` of the settings the current connection was made with. */
  private connectKey: string | null = null;
  /** What the last connect asked for (Session info). */
  private requested: (DisplayRequest & { audio: boolean; quality: Quality }) | null = null;
  /** The last `size` sent (connect or resize), to skip repeats. */
  private lastSentSize: { width: number; height: number } | null = null;
  /** (time, received bytes) samples for the data rate. */
  private rateSamples: { at: number; bytes: number }[] = [];
  /** Fields of an open `required` prompt. */
  private credentials: readonly RequiredField[] | null = null;
  /** SRV-11: what was answered in this connection attempt, and what to remember or forget. */
  private readonly answers = new RequiredAnswerGuard();
  private active = true;
  private readonly audio = new SessionAudio(
    (m) => this.log('info', m),
    () => this.publish(),
  );
  private readonly argv = new ArgvTracker(() => this.publish());
  /** AUD-2: microphone input, only while "Send microphone" is on and the session is shown. */
  private pip: PipFeed | null = null;
  private readonly mic = new SessionMicrophone({
    changed: () => this.publish(),
    log: (m) => this.log('info', m),
    problem: (p) => {
      const t = sessionStrings.mic;
      this.opts?.notify?.(
        p === 'not-accepted' ? t.notAccepted : p === 'denied' ? t.denied : t.unavailable,
      );
      this.opts?.onMicrophoneProblem?.(p);
    },
  });
  /** File transfers (FIL-1); the screen subscribes to it directly. */
  readonly transfers = new TransferManager({
    // FIL-1: written to the device as it arrives (stream endpoint on native, else in band).
    receiver: createFileReceiver({
      mode: () => this.settings.receivedFiles,
      streamRequest: (index, name) => {
        const uuid = this.tunnel?.uuid;
        return uuid ? (this.opts?.streamDownload?.(uuid, index, name) ?? null) : null;
      },
      log: (level, message) => this.log(level, message),
    }),
    log: (level, message) => this.log(level, message),
    notify: (text) => this.opts?.notify?.(text),
    incomingPolicy: () => this.settings.remoteFiles,
  });
  /** Pending step of a running combo with pauses (KEY-9). */
  private comboTimer: ReturnType<typeof setTimeout> | null = null;
  /** Pointers swallowed by "hide only" tap-to-hide, until they lift. */
  private readonly swallowed = new Set<number>();
  private thumbTimer: ReturnType<typeof setTimeout> | null = null;
  private lastThumbAt = 0;
  private stats = emptyStats();
  private displayStats: InstanceType<typeof Guacamole.Display.Statistics> | null = null;
  /** The current (or last) tunnel, described for the info sheet. */
  private infoTunnel: TunnelLike | null = null;
  /** Users joined to this session (guacd user id → name), see `viewers`. */
  private readonly joined = new Map<string, string>();
  private viewerNames: readonly string[] = [];

  // Layout
  private stable: Size | null = null;
  private nativeKeyboardOpen = false;
  private nativeKeyboardHeight = 0;
  private webKeyboardSeen = false;
  private keyBarHeight = 0;
  /** Space a docked toolbar takes at each edge (merged into the safe-area insets). */
  private reserved: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  private keyboardCover = 0;
  private measured: Size = { width: 0, height: 0 };
  private matchSizeTimer: ReturnType<typeof setTimeout> | null = null;
  /** The soft keyboard was open at the last measure. */
  private keyboardUp = false;
  /** A follow-the-view resize was held back while the keyboard was up. */
  private matchAfterKeyboard = false;

  // Input / frame loop
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private flingFrame: number | null = null;
  private flingLast = 0;
  private lastMouse: MouseState | null = null;
  private cursorCanvas: HTMLCanvasElement | null = null;
  private cursorHotspot = { x: 0, y: 0 };

  // Store
  private snapshot: SessionSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly cleanups: (() => void)[] = [];
  private disposed = false;

  constructor(settings: SessionSettings) {
    this.settings = normalizeSessionSettings(settings);
    this.pointer = new PointerModel({
      ...pointerConfigFromSettings(this.settings),
      followMarginPx: FOLLOW_MARGIN_PX,
    });
    this.configureRecognizers();
    this.viewport = createViewport({
      remote: { width: 0, height: 0 },
      screen: { width: 0, height: 0 },
      alignX: this.settings.displayAlign,
      mode: this.settings.fitMode,
      pixelRatio: devicePixelRatio(),
    });
    this.snapshot = this.buildSnapshot();
  }

  /** Pointer mode in effect: touch pass-through falls back to direct when unsupported. */
  private effectiveMode(): PointerMode {
    const m = this.settings.pointerMode;
    return m === 'touch' && this.touchSupport <= 0 ? 'direct' : m;
  }

  private configureRecognizers(): Gesture[] {
    const g = gestureConfigFromSettings(this.settings);
    const out = this.recognizer.setConfig({
      ...g,
      ...this.pointer.recognizerOptions(this.effectiveMode()),
    });
    out.push(
      ...this.surfaceRecognizer.setConfig({ ...g, ...this.pointer.recognizerOptions('trackpad') }),
    );
    return out;
  }

  // =====================================================================================
  // Store (useSyncExternalStore)

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SessionSnapshot => this.snapshot;

  private buildSnapshot(): SessionSnapshot {
    return {
      phase: this.machine.phase,
      zoomed: isZoomedIn(this.viewport),
      modifiers: this.keys.modifiers(),
      keyboardActive: this.els !== null && document.activeElement === this.els.field,
      keyboardCover: this.keyboardCover,
      remoteSize: this.viewport.remote,
      touchSupport: this.touchSupport,
      hardwareKeyboard: this.hardwareKeyboardSeen,
      pointerLocked: this.pointerLocked,
      credentials: this.credentials,
      active: this.active,
      audioStreams: this.audio.streamCount(),
      mutableArguments: this.argv.arguments(),
      quietReconnect:
        (this.machine.phase.kind === 'reconnecting' || this.machine.phase.kind === 'connecting') &&
        this.machine.everConnected &&
        this.quiet(),
      reconnectToApply:
        this.machine.phase.kind === 'connected' &&
        this.connectKey !== null &&
        this.connectKey !== connectSettingsKey(this.settings),
      viewOnly: this.settings.viewOnly,
      viewers: this.viewerNames,
      microphone: this.mic.getState(),
    };
  }

  private publish(): void {
    const next = this.buildSnapshot();
    const prev = this.snapshot;
    const same =
      prev.phase === next.phase &&
      prev.zoomed === next.zoomed &&
      prev.keyboardActive === next.keyboardActive &&
      prev.keyboardCover === next.keyboardCover &&
      prev.remoteSize.width === next.remoteSize.width &&
      prev.remoteSize.height === next.remoteSize.height &&
      prev.touchSupport === next.touchSupport &&
      prev.hardwareKeyboard === next.hardwareKeyboard &&
      prev.pointerLocked === next.pointerLocked &&
      prev.credentials === next.credentials &&
      prev.active === next.active &&
      prev.audioStreams === next.audioStreams &&
      prev.reconnectToApply === next.reconnectToApply &&
      prev.quietReconnect === next.quietReconnect &&
      prev.viewOnly === next.viewOnly &&
      prev.viewers === next.viewers &&
      prev.microphone === next.microphone &&
      prev.mutableArguments === next.mutableArguments &&
      (Object.keys(next.modifiers) as Modifier[]).every(
        (m) => prev.modifiers[m] === next.modifiers[m],
      );
    if (same) return;
    this.snapshot = next;
    for (const l of this.listeners) l();
  }

  // =====================================================================================
  // Lifecycle

  /**
   * Attach to the DOM and start connecting. May be called again after `detach()` (React
   * StrictMode mounts effects twice in development).
   */
  attach(els: SessionElements): void {
    this.detach();
    this.disposed = false;
    this.els = els;
    this.machine = INITIAL_SESSION_MACHINE;
    if (!isOnline()) this.machine = reduceSession(this.machine, { type: 'network', online: false });
    this.stable = null;
    els.field.value = this.baseline;
    this.listen();
    this.audio.listen();
    this.measure();
    this.connect();
  }

  /** Disconnect and remove every DOM listener and timer. Idempotent. */
  detach(): void {
    if (this.disposed || !this.els) return;
    if (this.machine.phase.kind === 'connected') this.captureThumbnail();
    this.releaseInputs();
    this.teardownClient(true);
    this.log('info', 'Session closed');
    this.clearTimers();
    this.audio.unlisten();
    for (const c of this.cleanups.splice(0)) c();
    this.disposed = true;
    this.syncPip();
  }

  /**
   * Shown (true) or hidden behind the app (false). Hidden: stay connected, but release
   * held keys and buttons, ignore all input, stop the fling loop and audio output; the
   * shell owns any background timeout. Shown again: re-fit to the (maybe resized) stage.
   */
  setActive(active: boolean): void {
    if (active === this.active) return;
    if (!active) {
      if (this.machine.phase.kind === 'connected') this.captureThumbnail();
      this.releaseInputs();
      const field = this.els?.field;
      if (field && document.activeElement === field) field.blur();
      this.exitPointerLock();
      if (this.flingFrame !== null) cancelAnimationFrame(this.flingFrame);
      this.flingFrame = null;
      if (this.tickTimer) clearTimeout(this.tickTimer);
      this.tickTimer = null;
      if (this.caretTimer) clearTimeout(this.caretTimer);
      this.caretTimer = null;
    }
    this.active = active;
    this.audio.setActive(active);
    this.syncMicrophone();
    this.syncPip();
    this.log('debug', active ? 'Session shown' : 'Session hidden');
    if (active) {
      this.stable = null;
      this.measure();
      // Some WebViews settle the size of a re-shown element a frame later.
      requestAnimationFrame(() => this.measure());
      this.lastThumbAt = Date.now();
    }
    this.publish();
  }

  /** AUD-1: mute or unmute this session's audio. */
  setAudioMuted(muted: boolean): void {
    this.audio.setMuted(muted);
    this.publish();
  }

  /** Change a connection parameter the server reported as changeable (`argv`). */
  setArgument(name: string, value: string): boolean {
    const ok = this.argv.setValue(name, value);
    if (ok) this.log('info', `Connection parameter "${name}" changed`);
    return ok;
  }

  /**
   * Answer the server's `required` prompt. `remember`: the prompt's Remember box was ticked;
   * the values are then handed to the credential memory once the connection succeeds (and
   * never otherwise). Unticked: anything remembered for these fields is forgotten.
   */
  submitCredentials(values: Readonly<Record<string, string>>, remember = false): void {
    const fields = this.credentials;
    const client = this.client;
    if (!fields || !client) return;
    this.credentials = null;
    const sent = argumentValues(fields, values);
    sendArgumentValues(client, sent);
    const answer = Object.fromEntries(sent.map((a) => [a.name, a.value]));
    const forget = this.answers.answeredByUser(
      sent.map((a) => a.name),
      answer,
      remember,
    );
    if (forget) this.opts?.credentialMemory?.()?.forget(forget);
    this.log('info', `Sent ${fields.length} requested parameter(s)`);
    this.publish();
  }

  /** Cancel the prompt: disconnect cleanly, as the web client does. */
  cancelCredentials(): void {
    if (!this.credentials) return;
    this.credentials = null;
    this.log('info', 'Credential prompt cancelled');
    this.disconnect();
  }

  private forgetAnswers(list: readonly (readonly string[])[]): void {
    if (list.length === 0) return;
    const memory = this.opts?.credentialMemory?.() ?? null;
    for (const names of list) memory?.forget(names);
  }

  private log(level: SessionLogLevel, message: string): void {
    try {
      this.opts?.onLog?.({ level, message });
    } catch {
      // never let logging break the session
    }
  }

  /** Callbacks from the host. Set before `attach()`. */
  setOptions(opts: SessionControllerOptions): void {
    this.opts = opts;
  }

  /** Apply changed settings (mode switches, speed, match-device...). */
  updateSettings(settings: SessionSettings): void {
    this.applySettings(settings);
  }

  /** The connection's protocol (lower case), for terminal-only features. */
  setProtocol(protocol: string | undefined): void {
    this.protocol = (protocol ?? '').toLowerCase();
  }

  /** Pinch sets the terminal font size: the option is on and the server offers `font-size`. */
  private pinchChangesFont(): boolean {
    return (
      this.settings.terminalPinchFont &&
      TERMINAL_PROTOCOLS.has(this.protocol) &&
      this.argv.arguments().some((a) => a.name === 'font-size')
    );
  }

  /** "Reconnect to apply": a fresh connection with the current Quality settings. */
  reconnect(): void {
    if (this.disposed) return;
    this.log('info', 'Reconnecting to apply changed settings');
    this.releaseInputs();
    this.machine = { ...INITIAL_SESSION_MACHINE, everConnected: true };
    this.connect();
  }

  /** User pressed Retry. */
  retry(): void {
    if (this.disposed) return;
    this.machine = INITIAL_SESSION_MACHINE;
    this.connect();
  }

  /** User pressed Disconnect. */
  disconnect(): void {
    if (this.machine.phase.kind === 'connected') this.captureThumbnail();
    this.releaseInputs();
    this.dispatch({ type: 'user-disconnect' });
    this.teardownClient(true);
  }

  private dispatch(e: SessionEvent): void {
    const prev = this.machine.phase;
    this.machine = reduceSession(this.machine, e);
    const phase = this.machine.phase;
    // A new phase object with the same meaning (the held connect after unlock, a network
    // event while reconnecting) is not logged again: it read as a second reconnect.
    if (phaseChanged(prev, phase)) this.logPhase(phase);
    if (phase.kind !== prev.kind) this.syncPip();
    if (phase !== prev && phase.kind === 'reconnecting' && e.type === 'closed') {
      if (phase.waitingForNetwork) {
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = null;
      } else {
        this.scheduleRetry(this.quiet() && phase.attempt === 1 ? 0 : phase.delayMs);
      }
    }
    this.publish();
  }

  private logPhase(phase: SessionPhase): void {
    switch (phase.kind) {
      case 'connecting':
        this.log('info', 'Connecting');
        break;
      case 'connected':
        this.log('info', 'Connected');
        break;
      case 'reconnecting':
        if (phase.waitingForNetwork) {
          this.log(
            'warn',
            `Connection lost; waiting for the network (attempt ${phase.attempt}; ${this.appStateText()})`,
          );
        } else {
          this.log(
            'warn',
            `Connection lost; reconnect attempt ${phase.attempt} of ${phase.maxAttempts} in ${this.quiet() && phase.attempt === 1 ? 0 : phase.delayMs} ms (${this.appStateText()})`,
          );
        }
        break;
      case 'error':
        this.log(
          'error',
          `Session ended: ${phase.reason ?? 'error'}${phase.code !== null ? ` (0x${phase.code.toString(16).padStart(4, '0')})` : ''}: ${phase.message}`,
        );
        break;
      case 'disconnected':
        this.log('info', phase.byServer ? 'The server ended the session' : 'Disconnected');
        break;
    }
  }

  private scheduleRetry(delayMs: number): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.disposed && this.machine.phase.kind === 'reconnecting') this.connect();
    }, delayMs);
  }

  /** Network back / app resumed: retry a pending reconnect now instead of after the backoff. */
  private retrySoon(why: string): void {
    if (this.disposed) return;
    const phase = this.machine.phase;
    if (phase.kind === 'reconnecting') {
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = null;
      this.log('info', `${why}: reconnecting now`);
      this.connect();
    } else if (
      phase.kind === 'error' &&
      this.machine.everConnected &&
      (phase.reason === 'network' || phase.code === null)
    ) {
      // Gave up while the network was gone: one fresh round of attempts.
      this.log('info', `${why}: trying again`);
      this.machine = {
        ...INITIAL_SESSION_MACHINE,
        everConnected: true,
        offline: this.machine.offline,
      };
      this.connect();
    }
  }

  private onNetwork(online: boolean): void {
    this.log(online ? 'info' : 'warn', online ? 'Network online' : 'Network offline');
    this.dispatch({ type: 'network', online });
    if (online) this.retrySoon('Network back');
  }

  private onResume(): void {
    const t = this.tunnel;
    const away = this.hiddenAt === null ? 0 : Date.now() - this.hiddenAt;
    this.hiddenAt = null;
    if (this.machine.phase.kind === 'connected' && t && t.state === TunnelState.UNSTABLE) {
      this.log('warn', 'Resumed with an unstable tunnel');
    }
    // A drop caused by the time away is reconnected at once and without the error overlay
    // (AUDIT #8: iOS pauses the WebView, so keep-alives stop and guacd ends the user after
    // GUACD_TIMEOUT, 15 s). The viewport, pointer mode and settings stay as they were. The
    // decision is made from what the tunnel reports, never from the time alone: a session
    // the Android foreground service kept alive is left untouched.
    this.quietUntil = Date.now() + QUIET_RECONNECT_MS;
    this.retrySoon('App resumed');
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = null;
      if (this.disposed) return;
      const state = this.tunnel ? this.tunnel.state : TunnelState.CLOSED;
      if (this.machine.phase.kind === 'connected' && state === TunnelState.OPEN) {
        this.resumeCheckedAt = Date.now();
      }
      if (resumeNeedsReconnect(this.machine.phase.kind, state)) {
        this.log(
          'info',
          `Back after ${Math.round(away / 1000)} s with a dead tunnel: reconnecting`,
        );
        this.reconnect();
      }
    }, RESUME_CHECK_MS);
  }

  /**
   * Hidden, or within a quiet window after returning to the app: a network drop is
   * reconnected at once and silently. (A clean close is never retried; see status.ts.)
   */
  /** "foreground, shown" / "background, hidden" / "foreground, hidden" (DIAG: where the app was). */
  private appStateText(): string {
    const app = document.visibilityState === 'hidden' ? 'background' : 'foreground';
    const online = isOnline() ? '' : ', offline';
    return `${app}, session ${this.active ? 'shown' : 'hidden'}${online}`;
  }

  private quiet(): boolean {
    return document.visibilityState === 'hidden' || Date.now() < this.quietUntil;
  }

  private connect(): void {
    const els = this.els;
    if (!els || this.disposed) return;
    const hold = this.opts?.connectGate?.() ?? null;
    if (hold) {
      if (!this.gateHeld) {
        this.gateHeld = true;
        this.log('info', `Connect held until the app is unlocked (${this.appStateText()})`);
        void hold.then(() => {
          this.gateHeld = false;
          if (!this.disposed) this.connect();
        });
      }
      return;
    }
    this.teardownClient(true);
    const gen = ++this.generation;
    this.closingOnPurpose = false;
    this.answers.begin();
    this.dispatch({ type: 'connect' });

    const opts = this.opts;
    if (!opts) return;
    let tunnel: TunnelLike;
    try {
      tunnel = opts.createTunnel();
    } catch (err) {
      this.dispatch({ type: 'error', code: 0x0200, display: errorText(err) });
      this.dispatch({ type: 'closed', intentional: false });
      return;
    }
    const client = new Guacamole.Client(tunnel as unknown as InstanceType<typeof Guacamole.Tunnel>);
    this.tunnel = tunnel;
    this.client = client;
    this.infoTunnel = tunnel;
    const live = () => gen === this.generation && !this.disposed;
    this.countTraffic(tunnel, live);

    tunnel.onerror = (status) => {
      if (!live()) return;
      this.log(
        'warn',
        `Tunnel error 0x${status.code.toString(16).padStart(4, '0')} after ${Date.now() - this.lastRxAt} ms without an instruction (${this.appStateText()})`,
      );
      this.dispatch({
        type: 'error',
        code: status.code,
        message: status.message,
        source: 'tunnel',
      });
    };
    tunnel.onstatechange = (state) => {
      if (!live()) return;
      if (state === TunnelState.UNSTABLE) {
        this.log(
          'warn',
          `Tunnel unstable (no instruction for ${Date.now() - this.lastRxAt} ms; ${this.appStateText()})`,
        );
      }
      if (state !== TunnelState.CLOSED) return;
      // Not by us and no error first: the server closed the tunnel cleanly (a `disconnect`,
      // or an administrator killing the connection, which closes with SUCCESS and no
      // instruction). Never auto-reconnected (AUDIT #7).
      const byServer = !this.closingOnPurpose && this.machine.lastError === null;
      const intentional = this.closingOnPurpose || byServer;
      if (!this.closingOnPurpose) {
        // SRV-11: remembered values answered this attempt and it ended before the desktop
        // was shown: forget them, unless the tunnel itself reported a network loss.
        const err = this.machine.lastError;
        const networkDrop = err !== null && err.source === 'tunnel' && isRetryableStatus(err.code);
        this.forgetAnswers(this.answers.ended(networkDrop));
      }
      this.dispatch({ type: 'closed', intentional, byServer });
      this.releaseInputs();
      this.mic.stop();
      this.transfers.detachClient();
      this.credentials = null;
      // The client does not follow a tunnel close on its own; stop its keep-alive.
      this.closingOnPurpose = true;
      client.disconnect();
      this.publish();
    };
    client.onerror = (status) => {
      if (!live()) return;
      this.forgetAnswers(this.answers.serverError(status.code));
      this.log('warn', `Server error 0x${status.code.toString(16).padStart(4, '0')}`);
      this.dispatch({
        type: 'error',
        code: status.code,
        message: status.message,
        source: 'client',
      });
    };
    client.onstatechange = (state) => {
      if (!live()) return;
      if (state === Guacamole.Client.State.CONNECTED) {
        this.dispatch({ type: 'connected' });
        this.onConnected();
      }
    };
    // Server credential prompt (SRV-11): `required` arrives while the client is WAITING,
    // before the first frame (`Client.js` handler "required").
    client.onrequired = (names) => {
      if (!live()) return;
      const fields = describeRequiredParams(names);
      this.log('info', `Server requested: ${fields.map((f) => f.name).join(', ')}`);
      if (fields.length === 0) return;
      const asked = fields.map((f) => f.name);
      const ask = () => {
        this.credentials = fields;
        this.publish();
      };
      // SRV-11: answer with remembered values at most once per field and attempt; a second
      // request for a field already answered means the remembered value was rejected.
      const step = this.answers.onRequired(asked);
      if (step.forget.length > 0) {
        this.log('info', 'Remembered values were not accepted: asking again');
        this.forgetAnswers(step.forget);
      }
      const memory = step.action === 'recall' ? (this.opts?.credentialMemory?.() ?? null) : null;
      if (!memory) {
        ask();
        return;
      }
      void memory
        .recall(asked)
        .catch(() => null)
        .then((values) => {
          if (!live() || this.client !== client) return;
          if (!values) {
            ask();
            return;
          }
          const sent = argumentValues(fields, values);
          sendArgumentValues(client, sent);
          this.answers.answeredAutomatically(
            asked,
            Object.fromEntries(sent.map((a) => [a.name, a.value])),
          );
          this.log(
            'info',
            `Answered ${fields.length} requested parameter(s) with remembered values`,
          );
        });
    };
    client.onsync = () => {
      this.pip?.displayChanged();
      if (!live()) return;
      this.stats.frames++;
      if (
        this.active &&
        this.machine.phase.kind === 'connected' &&
        Date.now() - this.lastThumbAt >= THUMBNAIL_INTERVAL_MS
      ) {
        this.captureThumbnail();
      }
    };
    this.audio.install(client);
    this.transfers.install(client);
    this.argv.install(client);
    // PTR-6: the server declares multi-touch support per layer (RDP with touch enabled), as
    // the web client's ManagedClient records it.
    this.setTouchSupport(0);
    client.onmultitouch = (_layer, touches) => {
      if (live()) this.setTouchSupport(touches);
    };
    // Shared sessions (guacd 1.5+): the owner is told who joins and leaves (`msg`). The
    // library fires onjoin/onleave from its "msg" handler (vendored Client.js).
    this.setViewers(null);
    client.onjoin = (userId, name) => {
      if (!live()) return;
      this.joined.set(userId, name);
      this.setViewers([...this.joined.values()]);
      this.log('info', 'A user joined this session');
      this.opts?.notify?.(viewerNotice(name, true));
    };
    client.onleave = (userId, name) => {
      if (!live()) return;
      const known = this.joined.get(userId);
      this.joined.delete(userId);
      this.setViewers([...this.joined.values()]);
      this.log('info', 'A user left this session');
      this.opts?.notify?.(viewerNotice(known ?? name, false));
    };
    client.onclipboard = (stream, mimetype) => {
      if (!live() || !/^text\//.test(mimetype)) return;
      // Raw bytes, decoded once at the end: upstream StringReader garbles emoji.
      readTextStream(stream, (text) => {
        if (live()) this.opts?.onRemoteClipboard(text);
      });
    };

    const display = client.getDisplay();
    display.scale(1);
    // Frame statistics computed by the library from `sync` timing (Display.js
    // `notifyFlushed`), for the info sheet.
    this.displayStats = null;
    display.statisticWindow = STATISTIC_WINDOW_MS;
    display.onstatistics = (s) => {
      if (live()) this.displayStats = s;
    };
    const el = display.getElement();
    els.displayHost.replaceChildren(el);
    // Our overlay draws the cursor; hide the library's software cursor layer, which
    // `sendMouseState` and the server `mouse` instruction would otherwise show as well.
    display.getCursorLayer().getElement().style.visibility = 'hidden';
    display.onresize = (w, h) => {
      if (live()) this.onRemoteResize({ width: w, height: h });
    };
    display.oncursor = (canvas, x, y) => {
      if (!live()) return;
      this.setCursorImage(canvas.width > 0 && canvas.height > 0 ? canvas : null, x, y);
    };
    this.setCursorImage(null, 0, 0);

    const avail = this.availableSize();
    const size = this.displayRequest(
      avail.width || window.innerWidth,
      avail.height || window.innerHeight,
    );
    const audio = requestsAudio(this.settings.quality, this.settings.audio);
    this.requested = { ...size, audio, quality: this.settings.quality };
    this.connectKey = connectSettingsKey(this.settings);
    this.lastSentSize = { width: size.width, height: size.height };
    this.log(
      'info',
      `Requesting ${size.width}x${size.height} at ${size.dpi} DPI (quality ${this.settings.quality}, audio ${audio ? 'on' : 'off'})`,
    );
    try {
      client.connect(opts.buildConnectData({ ...size, audio }));
    } catch (err) {
      const status = err as { code?: number; message?: string };
      this.dispatch({
        type: 'error',
        code: typeof status.code === 'number' ? status.code : 0x0200,
        display: typeof status.code === 'number' ? undefined : errorText(err),
      });
      this.dispatch({ type: 'closed', intentional: false });
    }
  }

  /** Close the current client/tunnel without triggering reconnect logic. */
  private teardownClient(onPurpose: boolean): void {
    if (this.retryTimer && onPurpose && this.machine.phase.kind !== 'reconnecting') {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const client = this.client;
    const tunnel = this.tunnel;
    this.client = null;
    this.tunnel = null;
    this.generation++;
    if (!client) return;
    this.closingOnPurpose = onPurpose;
    client.onclipboard = null;
    client.onmultitouch = null;
    client.onstatechange = null;
    client.onerror = null;
    client.onrequired = null;
    client.onsync = null;
    client.onaudio = null;
    client.onargv = null;
    client.onjoin = null;
    client.onleave = null;
    this.mic.stop();
    this.setViewers(null);
    const display = client.getDisplay();
    display.onstatistics = null;
    display.statisticWindow = 0;
    this.transfers.detachClient();
    this.audio.reset();
    this.argv.reset();
    if (this.credentials) {
      this.credentials = null;
      this.publish();
    }
    if (this.thumbTimer) clearTimeout(this.thumbTimer);
    this.thumbTimer = null;
    try {
      client.disconnect();
    } catch {
      // ignore
    }
    if (tunnel) {
      tunnel.onstatechange = null;
      tunnel.onerror = null;
    }
  }

  private onConnected(): void {
    // Sync the remote pointer with the model so the cursor overlay starts in a known place.
    this.lastMouse = null;
    this.updateCursor();
    this.scheduleMatchSize();
    this.credentials = null;
    // SRV-11: typed values (Remember ticked) are kept, remembered ones refreshed, only now.
    const memory = this.opts?.credentialMemory?.() ?? null;
    for (const a of this.answers.connected()) memory?.remember(a.names, a.values);
    this.syncMicrophone();
    this.syncPip();
    this.stats.connectedAt = Date.now();
    // The first thumbnail comes from the timer below, not from the next `sync`.
    this.lastThumbAt = Date.now();
    if (this.thumbTimer) clearTimeout(this.thumbTimer);
    this.thumbTimer = setTimeout(() => {
      this.thumbTimer = null;
      this.captureThumbnail();
    }, FIRST_THUMBNAIL_MS);
    this.publish();
  }

  // =====================================================================================
  // Thumbnails, statistics, info

  /** `onThumbnail`: a JPEG at most 320 px wide from `Display.flatten()`. Never throws. */
  private captureThumbnail(): void {
    const cb = this.opts?.onThumbnail;
    const client = this.client;
    if (!cb || !client) return;
    this.lastThumbAt = Date.now();
    try {
      const display = client.getDisplay();
      if (display.getWidth() <= 0 || display.getHeight() <= 0) return;
      const src = display.flatten();
      if (src.width <= 0 || src.height <= 0) return;
      const k = Math.min(1, THUMBNAIL_MAX_WIDTH / src.width);
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(src.width * k));
      out.height = Math.max(1, Math.round(src.height * k));
      const ctx = out.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(src, 0, 0, out.width, out.height);
      const url = out.toDataURL('image/jpeg', 0.7);
      if (url.startsWith('data:image/jpeg')) cb(url);
    } catch {
      // Tainted or lost canvas: no thumbnail this time.
    }
  }

  /** Count protocol traffic: wraps the tunnel's instruction handler and sender. */
  private countTraffic(tunnel: TunnelLike, live: () => boolean): void {
    this.stats = emptyStats();
    const stats = this.stats;
    this.lastRxAt = Date.now();
    const inner = tunnel.oninstruction;
    if (inner) {
      tunnel.oninstruction = (opcode, args) => {
        if (live()) {
          this.lastRxAt = Date.now();
          stats.rxInstr++;
          stats.rxBytes += instructionLength(opcode, args);
        }
        inner(opcode, args);
      };
    }
    const send = tunnel.sendMessage.bind(tunnel);
    tunnel.sendMessage = (...elements: unknown[]) => {
      if (live()) {
        stats.txInstr++;
        stats.txBytes += elements.reduce<number>((n, e) => n + String(e).length + 3, 0);
      }
      send(...elements);
    };
  }

  /** A fresh snapshot of figures for the info sheet. */
  getInfo = (): SessionInfo => {
    const s = this.displayStats;
    const num = (v: number | null | undefined) =>
      typeof v === 'number' && Number.isFinite(v) ? v : null;
    const t = this.tunnel;
    const now = Date.now();
    this.rateSamples = [
      ...this.rateSamples.filter((x) => now - x.at <= 5000),
      { at: now, bytes: this.stats.rxBytes },
    ];
    const first = this.rateSamples[0];
    const receivedKbps =
      first && now - first.at >= 900 && this.stats.rxBytes >= first.bytes
        ? ((this.stats.rxBytes - first.bytes) * 8) / (now - first.at)
        : null;
    return {
      remoteSize: this.viewport.remote,
      requested: this.requested,
      receivedKbps,
      scale: scaleOf(this.viewport),
      tunnelType: this.infoTunnel
        ? describeTunnel(this.infoTunnel)
        : sessionStrings.info.tunnelTypes.none,
      connectedForMs:
        this.machine.phase.kind === 'connected' && this.stats.connectedAt > 0
          ? Date.now() - this.stats.connectedAt
          : null,
      receivedBytes: this.stats.rxBytes,
      receivedInstructions: this.stats.rxInstr,
      sentBytes: this.stats.txBytes,
      sentInstructions: this.stats.txInstr,
      frames: this.stats.frames,
      processingLagMs: num(s?.processingLag),
      serverFps: num(s?.serverFps),
      clientFps: num(s?.clientFps),
      desktopFps: num(s?.desktopFps),
      dropRate: num(s?.dropRate),
      tunnelState: tunnelStateName(t ? t.state : TunnelState.CLOSED),
      audioContext: this.audio.contextState(),
      online: isOnline(),
    };
  };

  /** Replace the viewer list (`null` = nobody: a new or closed connection). */
  private setViewers(names: readonly string[] | null): void {
    if (names === null) this.joined.clear();
    const next = names ?? [];
    if (next.length === 0 && this.viewerNames.length === 0) return;
    this.viewerNames = next;
    this.publish();
  }

  private setTouchSupport(n: number): void {
    const next = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    if (next === this.touchSupport) return;
    const wasMode = this.effectiveMode();
    this.touchSupport = next;
    this.touches.setMaxTouches(next);
    if (this.effectiveMode() !== wasMode) this.onModeChanged();
    this.publish();
  }

  private clearTimers(): void {
    const timers = [
      this.retryTimer,
      this.resumeTimer,
      this.tickTimer,
      this.matchSizeTimer,
      this.caretTimer,
      this.thumbTimer,
    ];
    for (const t of timers) if (t) clearTimeout(t);
    this.retryTimer = this.tickTimer = this.matchSizeTimer = this.caretTimer = null;
    this.resumeTimer = null;
    this.thumbTimer = null;
    if (this.flingFrame !== null) cancelAnimationFrame(this.flingFrame);
    this.flingFrame = null;
  }

  // =====================================================================================
  // Settings

  private applySettings(input: SessionSettings): void {
    const prev = this.settings;
    const next = normalizeSessionSettings(input);
    this.settings = next;
    if (prev.displayAlign !== next.displayAlign) {
      this.setViewport(setAlignX(this.viewport, next.displayAlign));
    }
    if (prev.fitMode !== next.fitMode) {
      this.setViewport(setMode(this.viewport, next.fitMode));
    }
    const prevMode =
      prev.pointerMode === 'touch' && this.touchSupport <= 0 ? 'direct' : prev.pointerMode;
    const pc = pointerConfigFromSettings(next);
    const pcPrev = pointerConfigFromSettings(prev);
    const pointerChanged = (Object.keys(pc) as (keyof typeof pc)[]).some(
      (k) => pc[k] !== pcPrev[k],
    );
    if (pointerChanged) {
      this.applyPointerOutput(this.pointer.setConfig(pc, this.viewport));
    }
    if (prevMode !== this.effectiveMode()) {
      this.onModeChanged();
    } else {
      const gc = gestureConfigFromSettings(next);
      const gcPrev = gestureConfigFromSettings(prev);
      const gestureChanged = (Object.keys(gc) as (keyof typeof gc)[]).some(
        (k) => gc[k] !== gcPrev[k],
      );
      if (gestureChanged || pc.tapDrag !== pcPrev.tapDrag)
        this.handleGestures(this.configureRecognizers());
    }
    if (prev.largeCursor !== next.largeCursor) this.updateCursor();
    if (prev.pointerLock && !next.pointerLock) this.exitPointerLock();
    if (!prev.matchDeviceSize && next.matchDeviceSize) this.scheduleMatchSize();
    if (!prev.viewOnly && next.viewOnly) {
      // Let go of anything held, while sending is still allowed, then block all input.
      this.settings = prev;
      this.releaseInputs();
      this.settings = next;
      this.log('info', 'View only on');
    } else if (prev.viewOnly && !next.viewOnly) {
      // Resync: locked key-bar modifiers were not held on the remote while blocked.
      this.releaseInputs();
      this.log('info', 'View only off');
    }
    if (prev.audio !== next.audio) this.audio.setMuted(next.audio === 'muted');
    if (prev.microphone !== next.microphone || prev.viewOnly !== next.viewOnly) {
      this.syncMicrophone();
    }
    if (prev.pictureInPicture !== next.pictureInPicture) this.syncPip();
    this.publish();
  }

  /** More sheet: open the Picture in Picture window now (a tap). */
  openPictureInPicture(): void {
    void this.pip?.open();
  }

  /**
   * Picture in Picture (experimental, iOS). The feed runs while the setting is on and the
   * session is open and shown, and keeps running in the background: that is its point. It
   * also lives through a reconnect (frames pause until the new client draws), so a dropped
   * tunnel does not close the window. It stops once the session has ended (`pipWanted`).
   */
  private syncPip(): void {
    const want = pipWanted({
      setting: this.settings.pictureInPicture,
      available: pipAvailable(),
      active: this.active,
      disposed: this.disposed,
      phase: this.machine.phase.kind,
      everConnected: this.machine.everConnected,
    });
    if (want && !this.pip) {
      this.pip = new PipFeed(
        () => {
          const display = this.client?.getDisplay();
          if (!display || display.getWidth() <= 0 || display.getHeight() <= 0) return null;
          return display.flatten();
        },
        (message) => this.log('info', message),
        { disposableSource: true },
      );
      void this.pip.start();
    } else if (!want && this.pip) {
      this.pip.stop();
      this.pip = null;
    }
  }

  /**
   * AUD-2: the microphone runs only while "Send microphone" is on, the session is connected,
   * shown and in the foreground, and not view only. It stops otherwise (hidden, background,
   * disconnect) and starts again when all of that holds once more.
   */
  private syncMicrophone(): void {
    const client = this.client;
    const want =
      this.settings.microphone &&
      !this.settings.viewOnly &&
      this.active &&
      !this.disposed &&
      client !== null &&
      this.machine.phase.kind === 'connected' &&
      (typeof document === 'undefined' || document.visibilityState !== 'hidden');
    if (want) this.mic.start(client);
    else this.mic.stop();
  }

  /** The effective pointer mode changed: drop in-flight input and reconfigure. */
  private onModeChanged(): void {
    this.handleGestures(this.recognizer.reset(performance.now()));
    this.sendTouches(this.touches.releaseAll());
    this.applyPointerOutput(this.pointer.releaseAll(this.viewport));
    this.handleGestures(this.configureRecognizers());
    if (this.effectiveMode() === 'trackpad') this.bringPointerIntoView();
    this.exitPointerLock();
    this.updateCursor();
  }

  // =====================================================================================
  // Viewport, layout and display

  resetZoom(): void {
    this.setViewport(resetToMode(this.viewport));
  }

  /** Toolbar zoom (needed in touch pass-through mode, where pinch goes to the remote). */
  zoomBy(factor: number): void {
    const vis = visibleRect(this.viewport);
    this.setViewport(
      zoomAt(this.viewport, factor, { x: vis.x + vis.width / 2, y: vis.y + vis.height / 2 }),
    );
  }

  /** Height of the key bar docked above the keyboard / bottom edge (0 when hidden). */
  setKeyBarHeight(px: number): void {
    const h = Math.max(0, Math.round(px));
    if (h === this.keyBarHeight) return;
    this.keyBarHeight = h;
    this.measure();
  }

  /**
   * Space a docked toolbar takes at the edges (CSS px, its safe-area padding included). The
   * desktop is fitted into what is left, so the toolbar never covers it.
   */
  setReservedInsets(edges: Insets): void {
    const r = {
      top: Math.max(0, Math.round(edges.top)),
      right: Math.max(0, Math.round(edges.right)),
      bottom: Math.max(0, Math.round(edges.bottom)),
      left: Math.max(0, Math.round(edges.left)),
    };
    const p = this.reserved;
    if (r.top === p.top && r.right === p.right && r.bottom === p.bottom && r.left === p.left) {
      return;
    }
    this.reserved = r;
    this.measure();
    this.scheduleMatchSize();
  }

  /** The screen minus the docked toolbar: what the remote desktop is fitted into. */
  private availableSize(): Size {
    const { width, height } = this.viewport.screen;
    const r = this.reserved;
    return {
      width: Math.max(0, width - r.left - r.right),
      height: Math.max(0, height - r.top - r.bottom),
    };
  }

  private setViewport(next: ViewportState): void {
    this.viewport = next;
    this.render();
    this.publish();
    if (isFlinging(next)) this.startFlingLoop();
  }

  private render(): void {
    const els = this.els;
    if (!els) return;
    els.displayHost.style.transform = toCssTransform(this.viewport);
    this.updateCursor();
  }

  private readInsets(): Insets {
    const probe = this.els?.safeAreaProbe;
    if (!probe) return { top: 0, right: 0, bottom: 0, left: 0 };
    const cs = getComputedStyle(probe);
    const px = (v: string) => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    };
    // A docked toolbar's measured size already includes the safe area on its edge.
    const r = this.reserved;
    return {
      top: Math.max(px(cs.paddingTop), r.top),
      right: Math.max(px(cs.paddingRight), r.right),
      bottom: Math.max(px(cs.paddingBottom), r.bottom),
      left: Math.max(px(cs.paddingLeft), r.left),
    };
  }

  /** Re-measure the stage, safe area, keyboard and key bar, and relayout. */
  measure = (): void => {
    const els = this.els;
    // Hidden: the stage may be 0×0; re-fit when shown again (setActive).
    if (!els || this.disposed || !this.active) return;
    const rect = els.stage.getBoundingClientRect();
    this.measured = { width: rect.width, height: rect.height };
    const vv = window.visualViewport;
    const fieldFocused = document.activeElement === els.field;
    const vvInset = vv ? visualViewportInset(rect.bottom, vv.offsetTop, vv.height) : 0;
    const keyboardOpen = this.nativeKeyboardOpen || (fieldFocused && vvInset > 40);
    // Mobile web: the user dismissed the keyboard with a system control but the field kept
    // focus. Blur it so the keyboard button reflects that and raises it again on one tap.
    if (fieldFocused && vvInset > 40) this.webKeyboardSeen = true;
    else if (!fieldFocused) this.webKeyboardSeen = false;
    else if (this.webKeyboardSeen && vvInset <= 1 && !this.nativeKeyboardOpen) {
      this.webKeyboardSeen = false;
      els.field.blur();
    }
    const out = computeLayout({
      measured: this.measured,
      stable: this.stable,
      keyboardOpen,
      nativeKeyboardHeight: this.nativeKeyboardHeight,
      visualViewportInset: vvInset,
    });
    this.stable = out.stable;
    const wasKeyboardUp = this.keyboardUp;
    this.keyboardUp = keyboardOpen;
    const shrink = out.screen.height - this.measured.height;
    this.keyboardCover = Math.max(0, out.keyboardInset - shrink);
    const insets = this.readInsets();
    // The key bar slot sits right above the keyboard; when the keyboard is hidden its
    // measured height already includes the bottom safe-area padding (see the CSS).
    const keyboardInset = out.keyboardInset + this.keyBarHeight;
    const prev = this.viewport;
    const screenChanged =
      Math.abs(prev.screen.width - out.screen.width) >= 0.5 ||
      Math.abs(prev.screen.height - out.screen.height) >= 0.5;
    const frame = this.reserved;
    const pf = prev.frame;
    const insetsChanged =
      !pf ||
      pf.top !== frame.top ||
      pf.bottom !== frame.bottom ||
      pf.left !== frame.left ||
      pf.right !== frame.right ||
      prev.insets.top !== insets.top ||
      prev.insets.bottom !== insets.bottom ||
      prev.insets.left !== insets.left ||
      prev.insets.right !== insets.right;
    const kbChanged = Math.abs(prev.keyboardInset - keyboardInset) >= 0.5;
    if (wasKeyboardUp && !keyboardOpen && this.matchAfterKeyboard) {
      this.matchAfterKeyboard = false;
      this.scheduleMatchSize();
    }
    if (!screenChanged && !insetsChanged && !kbChanged) {
      this.publish();
      return;
    }
    let next: ViewportState;
    if (prev.screen.width === 0 || prev.screen.height === 0) {
      next = createViewport({
        remote: prev.remote,
        screen: out.screen,
        insets,
        frame,
        alignX: this.settings.displayAlign,
        keyboardInset,
        mode: this.settings.fitMode,
        pixelRatio: devicePixelRatio(),
      });
    } else if (!screenChanged && !insetsChanged) {
      next = relayout(prev, { keyboardInset });
    } else {
      next = relayout(prev, { screen: out.screen, insets, frame, keyboardInset });
    }
    if (kbChanged && keyboardInset > prev.keyboardInset && this.lastMouse) {
      // Keyboard (or key bar) came up: keep the pointer / focus point above it (DSP-5).
      next = ensureVisible(next, this.lastMouse, FOLLOW_MARGIN_PX);
    }
    this.setViewport(next);
    if (screenChanged) this.scheduleMatchSize();
  };

  private onRemoteResize(remote: Size): void {
    const prev = this.viewport;
    const next =
      prev.remote.width === 0 || prev.remote.height === 0
        ? createViewport({
            remote,
            screen: prev.screen,
            insets: prev.insets,
            ...(prev.frame ? { frame: prev.frame } : {}),
            alignX: this.settings.displayAlign,
            keyboardInset: prev.keyboardInset,
            mode: this.settings.fitMode,
            pixelRatio: devicePixelRatio(),
          })
        : relayout(prev, { remote });
    this.viewport = next;
    // Start the trackpad pointer in the middle of the first frame.
    if (prev.remote.width === 0 || prev.remote.height === 0) {
      this.pointer.setPointer({ x: remote.width / 2, y: remote.height / 2 });
    }
    this.applyPointerOutput(this.pointer.handleRemoteResize(next));
    this.setViewport(this.viewport);
  }

  /** The size to request for an available area (CSS px), from the Quality settings. */
  private displayRequest(cssWidth: number, cssHeight: number): DisplayRequest {
    const s = this.settings;
    return requestedDisplaySize({
      quality: s.quality,
      resolution: s.remoteResolution,
      customWidth: s.remoteWidth,
      customHeight: s.remoteHeight,
      scalePercent: s.remoteScale,
      cssWidth,
      cssHeight,
      devicePixelRatio: devicePixelRatio(),
      terminal: TERMINAL_PROTOCOLS.has(this.protocol),
    });
  }

  /**
   * Follow the view (DSP-4, "Match device size", on by default as in the web client's
   * `guacClient.js` `mainElementResized`): send the size of the area left for the desktop,
   * debounced, only when it differs from the last request.
   *
   * - A fixed or custom Remote resolution is never overridden.
   * - Not while the soft keyboard is up: the keyboard only covers the desktop (the view pans
   *   above it), so asking for a shorter desktop and back on every keyboard toggle would
   *   make RDP redraw (or, with `resize-method=reconnect`, reconnect) twice per word typed.
   *   A change that happens with the keyboard up (a rotation) is sent when it closes.
   * - Not in a joined or shared session: guacd honours `size` from any user that is not
   *   read-only (`rdp/user.c`), so a viewer would resize the owner's desktop.
   */
  private scheduleMatchSize(): void {
    if (!this.settings.matchDeviceSize || this.opts?.sharedViewer) return;
    // A fixed remote resolution never follows the device.
    const r = this.settings.remoteResolution;
    if (r !== 'auto' && r !== 'device') return;
    if (this.keyboardUp) {
      this.matchAfterKeyboard = true;
      return;
    }
    if (this.matchSizeTimer) clearTimeout(this.matchSizeTimer);
    this.matchSizeTimer = setTimeout(
      () => {
        this.matchSizeTimer = null;
        const client = this.client;
        if (!client || !this.settings.matchDeviceSize) return;
        if (this.machine.phase.kind !== 'connected') return;
        if (this.keyboardUp) {
          this.matchAfterKeyboard = true;
          return;
        }
        const { width, height } = this.availableSize();
        if (width <= 0 || height <= 0) return;
        const size = this.displayRequest(width, height);
        // Compare with what was last asked for, not the remote size: guacd converts the
        // request (DPI, multiple of 4), so the two rarely match and would resize forever.
        const last = this.lastSentSize;
        if (last && last.width === size.width && last.height === size.height) return;
        this.lastSentSize = { width: size.width, height: size.height };
        client.sendSize(size.width, size.height);
      },
      Math.max(MATCH_SIZE_DEBOUNCE_MS, resizeDebounceMs(this.settings.quality)),
    );
  }

  private startFlingLoop(): void {
    if (this.flingFrame !== null) return;
    this.flingLast = performance.now();
    const step = (now: number) => {
      this.flingFrame = null;
      if (this.disposed) return;
      const dt = Math.min(64, Math.max(0, now - this.flingLast));
      this.flingLast = now;
      this.viewport = stepFling(this.viewport, dt);
      this.render();
      if (isFlinging(this.viewport)) this.flingFrame = requestAnimationFrame(step);
      else this.publish();
    };
    this.flingFrame = requestAnimationFrame(step);
  }

  /**
   * Entering trackpad mode with the pointer off-screen would leave the user hunting for
   * it; move it to the centre of the visible area instead (without clicking).
   */
  private bringPointerIntoView(): void {
    const vp = this.viewport;
    if (vp.remote.width <= 0 || vp.remote.height <= 0) return;
    const p = this.lastMouse ?? this.pointer.getPointer(vp);
    const s = remoteToScreen(vp, p);
    const vis = visibleRect(vp);
    const inside =
      s.x >= vis.x && s.y >= vis.y && s.x <= vis.x + vis.width && s.y <= vis.y + vis.height;
    if (inside) {
      this.pointer.setPointer(p);
      return;
    }
    const c = screenToRemote(vp, { x: vis.x + vis.width / 2, y: vis.y + vis.height / 2 });
    this.pointer.setPointer(c);
    const pos = this.pointer.getPointer(vp);
    const held = this.lastMouse;
    this.sendMouse([
      {
        x: pos.x,
        y: pos.y,
        left: held?.left ?? false,
        middle: held?.middle ?? false,
        right: held?.right ?? false,
        up: false,
        down: false,
      },
    ]);
  }

  // =====================================================================================
  // Cursor overlay (DSP-6)

  private setCursorImage(canvas: HTMLCanvasElement | null, hx: number, hy: number): void {
    const el = this.els?.cursor;
    if (!el) return;
    // A fully transparent image means the remote hid its cursor (or sent an empty one).
    this.cursorHidden = canvas !== null && isFullyTransparent(canvas);
    this.cursorCanvas = canvas;
    this.cursorHotspot = canvas ? { x: hx, y: hy } : { x: 0, y: 0 };
    const img = el.querySelector<HTMLElement>('[data-cursor-image]');
    if (img) img.replaceChildren(...(canvas ? [canvas] : []));
    this.updateCursor();
  }

  /**
   * DSP-6: the server image when it has one; the fallback arrow when there is none, or in
   * trackpad mode when the server image is fully transparent (the user must see where the
   * pointer is). In direct mode a transparent server cursor stays hidden.
   */
  private updateCursor(): void {
    const els = this.els;
    if (!els) return;
    const vp = this.viewport;
    const connected = this.client !== null && vp.remote.width > 0;
    const mode = this.effectiveMode();
    const trackpadLike = mode === 'trackpad' || this.surface !== null || this.pointerLocked;
    const showImage = this.cursorCanvas !== null && !this.cursorHidden;
    const showFallback = !showImage && (this.cursorCanvas === null || trackpadLike);
    const img = els.cursor.querySelector<HTMLElement>('[data-cursor-image]');
    const fallback = els.cursor.querySelector<HTMLElement>('[data-cursor-fallback]');
    if (img) img.style.display = showImage ? 'block' : 'none';
    if (fallback) fallback.style.display = showFallback ? 'block' : 'none';
    const remotePoint = this.lastMouse ?? this.pointer.getPointer(vp);
    const s = remoteToScreen(vp, remotePoint);
    const k = cursorDrawScale(scaleOf(vp)) * (this.settings.largeCursor ? LARGE_CURSOR_SCALE : 1);
    const hx = showImage ? this.cursorHotspot.x : 0;
    const hy = showImage ? this.cursorHotspot.y : 0;
    els.cursor.style.transform = `translate3d(${s.x - hx * k}px, ${s.y - hy * k}px, 0) scale(${k})`;
    els.cursor.dataset.mode = trackpadLike ? 'trackpad' : mode;
    els.cursor.dataset.large = this.settings.largeCursor ? 'true' : 'false';
    // `inherit`, not `visible`: a session hidden behind the app's other screens is
    // `visibility: hidden` on an ancestor, and an explicit `visible` would show through it.
    els.cursor.style.visibility = connected && mode !== 'touch' ? 'inherit' : 'hidden';
  }

  // =====================================================================================
  // Sending

  /**
   * Send mouse states. Runs of `withShift` states (horizontal wheel) are wrapped in a
   * Shift press/release, unless Shift is already held (sticky lock or hardware key).
   */
  private sendMouse(states: readonly MouseState[]): void {
    if (states.length === 0) return;
    const client = this.inputClient();
    let shiftPressed = false;
    const shiftHeld = () => {
      const held = new Set([...this.keys.heldKeysyms(), ...this.hw.held()]);
      return held.has(KEYSYM.Shift_L) || held.has(KEYSYM.Shift_R);
    };
    for (const s of states) {
      const prev = this.lastMouse;
      const newBits =
        s.up ||
        s.down ||
        (s.left && !(prev?.left ?? false)) ||
        (s.middle && !(prev?.middle ?? false)) ||
        (s.right && !(prev?.right ?? false));
      if (newBits) {
        // Text held by commit-on-word goes first; lazy hardware Ctrl/Alt apply to the
        // click / drag / wheel (Ctrl+click, Ctrl+wheel, Alt+drag).
        this.flushText();
        const mods = this.hwOut(this.hw.flush());
        if (mods.length > 0) this.sendKeyEvents(mods);
      }
      if (s.withShift && !shiftPressed && !shiftHeld()) {
        client?.sendKeyEvent(1, KEYSYM.Shift_L);
        shiftPressed = true;
      } else if (!s.withShift && shiftPressed) {
        client?.sendKeyEvent(0, KEYSYM.Shift_L);
        shiftPressed = false;
      }
      if (client) client.sendMouseState(new Guacamole.Mouse.State(toGuacMouseTemplate(s)), false);
      this.lastMouse = s;
    }
    if (shiftPressed) client?.sendKeyEvent(0, KEYSYM.Shift_L);
    this.updateCursor();
  }

  /** The client for remote input, or null in view-only mode (nothing is sent). */
  private inputClient(): GuacClient | null {
    return this.settings.viewOnly ? null : this.client;
  }

  private sendTouches(contacts: readonly TouchContact[]): void {
    const client = this.inputClient();
    if (!client) return;
    for (const c of contacts) {
      const state = new Guacamole.Touch.State({
        id: c.id,
        x: c.x,
        y: c.y,
        radiusX: c.radiusX,
        radiusY: c.radiusY,
        angle: c.angle,
      });
      // Touch.State turns force 0 into 1 (`template.force || 1.0`): assign afterwards.
      state.force = c.force;
      client.sendTouchState(state, false);
    }
  }

  sendKeyEvents(events: readonly KeyEvent[]): void {
    const client = this.inputClient();
    if (client) for (const e of events) client.sendKeyEvent(e.pressed ? 1 : 0, e.keysym);
    this.publish();
  }

  /** Key bar / named key with sticky modifiers applied. */
  pressKey(name: string | number): void {
    this.flushText();
    this.sendKeyEvents(this.keys.pressKey(name));
  }

  tapModifier(mod: Modifier): void {
    this.sendKeyEvents(this.keys.tapModifier(mod));
  }

  runCombo(combo: Combo): void {
    this.flushText();
    this.sendKeyEvents(this.keys.runCombo(combo));
  }

  /**
   * KEY-9: a saved combo, with the pauses between its steps. Each step presses and releases
   * its keys before a pause, so stopping (disconnect, hide, blur) never leaves a key held.
   * A new combo stops one still running.
   */
  runComboSteps(steps: readonly ComboStep[]): void {
    this.flushText();
    this.cancelCombo();
    const phases = comboSchedule(steps, this.keys.heldKeysyms());
    const run = (i: number) => {
      this.comboTimer = null;
      const p = phases[i];
      if (!p || !this.client) return;
      this.sendKeyEvents(p.events);
      if (i + 1 < phases.length) this.comboTimer = setTimeout(() => run(i + 1), p.waitMs);
    };
    run(0);
  }

  /** Stop a combo still waiting between steps. Returns whether one was running. */
  cancelCombo(): boolean {
    if (this.comboTimer === null) return false;
    clearTimeout(this.comboTimer);
    this.comboTimer = null;
    return true;
  }

  /** CLP-3 / text input bar: type text as keystrokes. */
  typeText(text: string): void {
    this.flushText();
    this.sendKeyEvents(this.keys.typeText(text));
  }

  /**
   * CLP-1: set the remote clipboard. A clipboard stream as in the web client, but written as
   * `TextEncoder` UTF-8 bytes: upstream StringWriter mis-encodes characters above U+FFFF.
   */
  sendClipboard(text: string): boolean {
    const client = this.inputClient();
    if (!client || this.machine.phase.kind !== 'connected') return false;
    writeTextStream(client.createClipboardStream('text/plain'), text);
    return true;
  }

  /** The open tunnel's UUID (session sharing), or null. */
  tunnelUuid(): string | null {
    return this.machine.phase.kind === 'connected' ? (this.tunnel?.uuid ?? null) : null;
  }

  isConnected(): boolean {
    return this.machine.phase.kind === 'connected';
  }

  /**
   * For sends made right after the app comes back (auto-send on focus): resolves true once
   * the session is connected over a tunnel that has proved alive since the call (no resume
   * check pending, and an instruction arrived or the resume check found it open; after a
   * reconnect if the old tunnel died while away), or false after `timeoutMs`. Writing at
   * once could go into a tunnel guacd already dropped, and be lost. Internal pings never
   * reach `oninstruction`, hence the resume check as the second proof on an idle desktop.
   */
  whenTunnelAlive(timeoutMs = 10_000): Promise<boolean> {
    const since = Date.now();
    const alive = () =>
      this.machine.phase.kind === 'connected' &&
      this.tunnel !== null &&
      this.tunnel.state === TunnelState.OPEN &&
      this.resumeTimer === null &&
      (this.lastRxAt > since || this.resumeCheckedAt >= since);
    return new Promise((resolve) => {
      const timer = setInterval(() => {
        if (this.disposed || Date.now() - since >= timeoutMs) {
          clearInterval(timer);
          resolve(false);
        } else if (alive()) {
          clearInterval(timer);
          resolve(true);
        }
      }, TUNNEL_ALIVE_POLL_MS);
    });
  }

  private applyPointerOutput(out: PointerOutput): void {
    this.sendMouse(out.mouse);
    if (out.viewport.length > 0) {
      this.viewport = applyViewportCommands(this.viewport, out.viewport);
      this.render();
      if (isFlinging(this.viewport)) this.startFlingLoop();
      this.publish();
    }
    if (this.settings.haptics) for (const h of out.haptics) this.opts?.haptic(h);
  }

  private handleGestures(gestures: readonly Gesture[], fromSurface = false): void {
    for (const g of gestures) {
      if (g.type === 'pending-tap' && g.phase === 'start') this.flushBeforeClick();
      if (fromSurface) {
        // The trackpad surface does not zoom the display (its coordinates are not the
        // display's).
        if (g.type === 'pinch') continue;
        this.applyPointerOutput(this.pointer.handle(g, this.viewport, 'trackpad'));
      } else {
        if (g.type === 'pinch' && this.pinchChangesFont()) {
          // Terminal option: the pinch sets the server font size instead of zooming.
          if (g.phase === 'end' && !g.cancelled) {
            const cur = this.argv.arguments().find((a) => a.name === 'font-size');
            const next = fontSizeAfterPinch(parseFontSize(cur?.value), g.totalScale);
            if (cur && String(next) !== cur.value) this.setArgument('font-size', String(next));
          }
          continue;
        }
        if (g.type === 'tap' || g.type === 'two-finger-tap' || g.type === 'three-finger-tap') {
          this.flushBeforeClick();
        }
        if (g.type === 'tap' || (g.type === 'pending-tap' && g.phase === 'start')) {
          this.maybeDismissKeyboardOnTap();
        }
        this.applyPointerOutput(this.pointer.handle(g, this.viewport));
      }
    }
    this.scheduleTick();
  }

  /**
   * Opt-in (`tapDismissKeyboard`): a one-finger tap on the display while the soft keyboard is
   * up hides it. The tap is still delivered (it clicks), so no button is left half pressed.
   */
  private maybeDismissKeyboardOnTap(): void {
    const mode = this.settings.tapDismissKeyboard;
    if (onTapRecognised(mode, this.fieldFocused()) !== 'hide-and-pass') return;
    this.hideKeyboard();
    this.opts?.hideNativeKeyboard?.();
  }

  private fieldFocused(): boolean {
    const field = this.els?.field;
    return !!field && document.activeElement === field;
  }

  /** Before a click: send text held by commit-on-word and press lazy hardware modifiers. */
  private flushBeforeClick(): void {
    this.flushText();
    const mods = this.hwOut(this.hw.flush());
    if (mods.length > 0) this.sendKeyEvents(mods);
  }

  private scheduleTick(): void {
    if (this.tickTimer) clearTimeout(this.tickTimer);
    this.tickTimer = null;
    const a = this.recognizer.nextDeadline();
    const b = this.surfaceRecognizer.nextDeadline();
    const deadline = a === null ? b : b === null ? a : Math.min(a, b);
    if (deadline === null) return;
    const delay = Math.max(0, deadline - performance.now());
    this.tickTimer = setTimeout(() => {
      this.tickTimer = null;
      const now = performance.now();
      const fromSurface = this.surfaceRecognizer.tick(now);
      this.handleGestures(this.recognizer.tick(now));
      this.handleGestures(fromSurface, true);
    }, delay + 1);
  }

  private releaseInputs(): void {
    this.cancelCombo();
    this.swallowed.clear();
    const client = this.client;
    const released: KeyEvent[] = [...this.hwOut(this.hw.releaseAll()), ...this.keys.releaseAll()];
    if (client) for (const e of released) client.sendKeyEvent(e.pressed ? 1 : 0, e.keysym);
    this.sendTouches(this.touches.releaseAll());
    this.handleGestures(this.recognizer.reset(performance.now()));
    this.handleGestures(this.surfaceRecognizer.reset(performance.now()), true);
    this.applyPointerOutput(this.pointer.releaseAll(this.viewport));
    this.lastMouseButtons = 0;
    this.publish();
  }

  // =====================================================================================
  // Soft keyboard (KEY-1) and the hidden field (KEY-2)

  /**
   * Raise the soft keyboard. MUST be called synchronously from a user gesture handler
   * (click), or iOS will not show the keyboard.
   */
  showKeyboard(): void {
    const field = this.els?.field;
    if (!field) return;
    // Re-focusing an already focused field (keyboard dismissed with the system back key)
    // does not raise the keyboard again; blur first.
    if (document.activeElement === field) field.blur();
    field.focus({ preventScroll: true });
    this.resetField();
    this.publish();
  }

  hideKeyboard(): void {
    const field = this.els?.field;
    if (field && document.activeElement === field) field.blur();
    this.publish();
  }

  private resetField(): void {
    const field = this.els?.field;
    if (!field) return;
    this.flushAfterComposition = false;
    this.baseline = initialTextInput();
    field.value = this.baseline;
    caretToEnd(field);
  }

  private processField(composing: boolean, flush = false): void {
    const field = this.els?.field;
    if (!field) return;
    const keepContext = this.keepsTypingContext();
    const update = diffTextInput(this.baseline, field.value, composing, {
      commit: this.settings.textInputMode,
      flush,
      keepContext,
    });
    // A sticky modifier turns the text into a shortcut (Ctrl+A): what the field holds no
    // longer mirrors the remote.
    const chord =
      keepContext &&
      (update.text !== '' || update.backspaces > 0) &&
      Object.values(this.keys.modifiers()).some((m) => m !== 'off');
    const events = textInputKeyEvents(update, this.keys);
    this.baseline = update.baseline;
    if (update.reset) field.value = update.baseline;
    if (update.reset || !composing) caretToEnd(field);
    this.sendKeyEvents(events);
    if (chord && !composing) this.resetField();
  }

  /** Autocorrect / sentence capitals: the field keeps the sentence, not just the word. */
  private keepsTypingContext(): boolean {
    return this.settings.keyboardAutocorrect || this.settings.keyboardCapitals;
  }

  /**
   * Before anything other than typed text reaches the remote (a key bar key, a click):
   * send the word still held by commit-on-word, and drop the kept sentence, which no
   * longer matches where the remote caret is. `keepContext`: only send the held word (a
   * modifier key alone moves nothing on the remote).
   * During a composition the field must not be touched: the flush runs when it ends.
   */
  private flushText(keepContext = false): void {
    if (this.composing) {
      this.flushAfterComposition = true;
      return;
    }
    const field = this.els?.field;
    if (!field) return;
    if (this.settings.textInputMode === 'word' && field.value !== this.baseline) {
      this.processField(false, true);
    }
    if (!keepContext && this.keepsTypingContext() && field.value !== initialTextInput()) {
      this.resetField();
    }
  }

  /**
   * KEY-2 robustness: the caret of the hidden field was moved (iOS space-bar trackpad,
   * selection handles). After it settles, turn a collapsed move into Left presses and
   * reset the field, or collapse a selection back to the end (see `caretResync`).
   */
  private scheduleCaretCheck(): void {
    if (this.caretTimer) clearTimeout(this.caretTimer);
    const field = this.els?.field;
    if (!field || document.activeElement !== field || this.composing) return;
    const value = field.value;
    this.caretTimer = setTimeout(() => {
      this.caretTimer = null;
      if (document.activeElement !== field || this.composing || field.value !== value) return;
      if (field.value !== this.baseline) this.flushText();
      const r = caretResync(
        field.value,
        field.selectionStart ?? field.value.length,
        field.selectionEnd ?? field.value.length,
        this.composing,
      );
      if (r.arrows < 0) {
        const events: KeyEvent[] = [];
        for (let i = 0; i < -r.arrows; i++) events.push(...this.keys.pressKey('Left'));
        this.sendKeyEvents(events);
      }
      if (r.reset) this.resetField();
      else if (r.restoreCaret) caretToEnd(field);
    }, CARET_SETTLE_MS);
  }

  // =====================================================================================
  // DOM listeners

  private on<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    fn: (e: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, fn as EventListener, options);
    this.cleanups.push(() => target.removeEventListener(type, fn as EventListener, options));
  }

  private onWindow<K extends keyof WindowEventMap>(
    type: K,
    fn: (e: WindowEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void {
    window.addEventListener(type, fn as EventListener, options);
    this.cleanups.push(() => window.removeEventListener(type, fn as EventListener, options));
  }

  private listen(): void {
    const els = this.els;
    if (!els) return;
    const layer = els.gestureLayer;

    // ---- Pointer events on the gesture layer
    const localPoint = (e: PointerEvent | WheelEvent) => {
      const r = els.stage.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const pointerHandler = (type: 'down' | 'move' | 'up' | 'cancel') => (e: PointerEvent) => {
      // Keep focus on the hidden field and stop browser gestures/selection.
      if (e.cancelable) e.preventDefault();
      if (!this.active) return;
      const kind = pointerKind(e.pointerType);
      // "Hide only": the touch that lands while the keyboard is up just hides it.
      if (this.swallowed.has(e.pointerId)) {
        if (type === 'up' || type === 'cancel') this.swallowed.delete(e.pointerId);
        return;
      }
      if (
        type === 'down' &&
        kind !== 'mouse' &&
        onTouchDown(this.settings.tapDismissKeyboard, this.fieldFocused()) === 'hide-and-swallow'
      ) {
        this.swallowed.add(e.pointerId);
        this.hideKeyboard();
        this.opts?.hideNativeKeyboard?.();
        return;
      }
      if (type === 'down') {
        try {
          layer.setPointerCapture(e.pointerId);
        } catch {
          // Synthetic pointers cannot be captured.
        }
      }
      if (kind === 'mouse') {
        this.hardwareMouse(e, type, localPoint(e));
        return;
      }
      if (kind === 'pen') {
        // Stylus: a precise absolute pointer in every mode (hover moves, tip = left,
        // barrel = right).
        const b = penButtons(type === 'cancel' || type === 'up' ? 0 : e.buttons);
        if (b.left || b.right) this.flushBeforeClick();
        this.applyPointerOutput(
          this.pointer.handleHardwareMouse({ ...localPoint(e), ...b }, this.viewport),
        );
        return;
      }
      if (this.effectiveMode() === 'touch') {
        const p = localPoint(e);
        this.sendTouches(
          this.touches.handle(
            {
              id: e.pointerId,
              type,
              x: p.x,
              y: p.y,
              width: e.width,
              height: e.height,
              pressure: e.pressure,
            },
            this.viewport,
          ),
        );
        return;
      }
      this.handleGestures(this.recognizer.handle(toPointerInput(e, type, localPoint(e), kind)));
    };
    this.on(layer, 'pointerdown', pointerHandler('down'));
    this.on(layer, 'pointermove', pointerHandler('move'));
    this.on(layer, 'pointerup', pointerHandler('up'));
    this.on(layer, 'pointercancel', pointerHandler('cancel'));
    // Non-passive listeners, so preventDefault works (React's touch/wheel listeners are passive).
    const prevent = (e: Event) => {
      if (e.cancelable) e.preventDefault();
    };
    this.on(layer, 'touchstart', prevent, { passive: false });
    this.on(layer, 'touchmove', prevent, { passive: false });
    this.on(layer, 'mousedown', prevent);
    this.on(layer, 'contextmenu', prevent);
    this.on(layer, 'dblclick', prevent);
    this.on(layer, 'selectstart', prevent);
    // Back / forward mouse buttons must not navigate the WebView.
    this.on(layer, 'auxclick', prevent);
    this.on(layer, 'mouseup', (e) => {
      if (e.button === 3 || e.button === 4) e.preventDefault();
    });
    this.on(
      layer,
      'wheel',
      (e) => {
        if (this.active) this.hardwareWheel(e, localPoint(e));
        else if (e.cancelable) e.preventDefault();
      },
      { passive: false },
    );

    // ---- Pointer lock (hardware mouse, trackpad mode, opt-in)
    const onLockChange = () => {
      const locked = document.pointerLockElement === layer;
      if (locked === this.pointerLocked) return;
      this.pointerLocked = locked;
      this.updateCursor();
      this.publish();
    };
    document.addEventListener('pointerlockchange', onLockChange);
    this.cleanups.push(() => document.removeEventListener('pointerlockchange', onLockChange));

    // ---- Hidden text field
    const field = els.field;
    this.on(field, 'compositionstart', () => {
      this.composing = true;
    });
    this.on(field, 'compositionend', () => {
      this.composing = false;
      this.processField(false);
      // A click or key bar key came during the composition: send and reset what it skipped.
      if (this.flushAfterComposition) {
        this.flushAfterComposition = false;
        this.flushText();
      }
    });
    this.on(field, 'input', (e) => {
      const composing = (e as InputEvent).isComposing || this.composing;
      this.processField(composing);
    });
    this.on(field, 'focus', () => {
      this.resetField();
      this.measure();
      this.publish();
    });
    this.on(field, 'blur', () => {
      this.flushText();
      this.composing = false;
      this.keys.clearOneShot();
      this.measure();
      this.publish();
    });
    // Caret moved without an input (iOS space-bar cursor, selection handles).
    this.on(field, 'select', () => this.scheduleCaretCheck());
    const onSelection = () => {
      if (this.active && document.activeElement === field) this.scheduleCaretCheck();
    };
    document.addEventListener('selectionchange', onSelection);
    this.cleanups.push(() => document.removeEventListener('selectionchange', onSelection));

    // ---- Hardware keyboard (document level, KEY-6)
    const keydown = (e: KeyboardEvent) => {
      // Hidden session (`active` false): the document belongs to the app shell.
      if (this.disposed || !this.active || !this.isConnected()) return;
      const active = document.activeElement;
      const fieldFocused = active === field;
      if (!fieldFocused && active instanceof HTMLElement && els.chromeRoot.contains(active)) {
        return; // typing into or operating the chrome (buttons, text input bar)
      }
      if (!fieldFocused && isEditable(active)) return;
      // A menu (dialog) is open: its own keys (Escape) must not reach the remote.
      if (els.chromeRoot.querySelector('[role="dialog"]')) return;
      if (
        e.keyCode !== 229 &&
        e.key !== 'Unidentified' &&
        e.key !== 'Process' &&
        !this.hardwareKeyboardSeen
      ) {
        this.hardwareKeyboardSeen = true;
        this.publish();
      }
      // Sticky one-shot modifiers from the key bar wrap the next hardware key.
      const hasOneShot = Object.values(this.keys.modifiers()).includes('once');
      if (hasOneShot && !isModifierKey(e.key)) {
        const d = decideHardwareKey(
          { ...pickKey(e), altGraph: e.getModifierState?.('AltGraph') ?? false },
          fieldFocused,
        );
        if (d.action !== 'send') return;
        e.preventDefault();
        if (!e.repeat) {
          this.flushBeforeClick();
          this.pressKey(d.keysym);
        }
        return;
      }
      this.hardwareKey(e, 'down', fieldFocused);
    };
    const keyup = (e: KeyboardEvent) => {
      if (this.disposed || !this.active) return;
      this.hardwareKey(e, 'up', document.activeElement === field);
    };
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('keyup', keyup, true);
    this.cleanups.push(() => {
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('keyup', keyup, true);
    });

    // ---- Focus loss: release everything so nothing stays stuck on the remote
    this.onWindow('blur', () => this.releaseInputs());
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        this.hiddenAt = Date.now();
        this.releaseInputs();
      } else {
        // Visible again: start the quiet window before any queued close event runs.
        this.quietUntil = Date.now() + QUIET_RECONNECT_MS;
      }
      this.syncMicrophone();
      this.syncPip();
    };
    document.addEventListener('visibilitychange', onVisibility);
    this.cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));

    // ---- Network and app lifecycle (DSP-9): reconnect at once when the network returns
    const net = onNetworkChange((online) => this.onNetwork(online));
    const resume = onAppResume(() => this.onResume());
    this.cleanups.push(
      () => net.dispose(),
      () => resume.dispose(),
    );

    // ---- Layout sources: container size, orientation/fold, visual viewport, safe area
    const ro = new ResizeObserver(() => this.measure());
    ro.observe(els.stage);
    this.cleanups.push(() => ro.disconnect());
    this.onWindow('resize', this.measure);
    this.onWindow('orientationchange', () => {
      // Some WebViews report the new size a little after the event.
      this.measure();
      setTimeout(this.measure, 250);
    });
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', this.measure);
      vv.addEventListener('scroll', this.measure);
      this.cleanups.push(() => {
        vv.removeEventListener('resize', this.measure);
        vv.removeEventListener('scroll', this.measure);
      });
    }
  }

  private hardwareKey(e: KeyboardEvent, type: 'down' | 'up', fieldFocused: boolean): void {
    const r = this.hw.handle(
      {
        ...pickKey(e),
        type,
        shiftKey: e.shiftKey,
        repeat: e.repeat,
        altGraph: e.getModifierState?.('AltGraph') ?? false,
      },
      {
        fieldFocused,
        heldElsewhere: this.keys.heldKeysyms(),
        adjust: (ks) => this.keys.applyModifiers(ks),
      },
    );
    if (r.handled) e.preventDefault();
    const m = this.lastMouse;
    if (type === 'down' && this.hw.hasPending() && m && (m.left || m.middle || m.right)) {
      // A modifier pressed mid-drag applies at once (e.g. Ctrl to copy while dragging).
      r.events.push(...this.hw.flush());
    }
    if (r.events.length === 0) return;
    // A modifier alone (Shift for a capital) keeps the sentence the keyboard works with.
    if (type === 'down' && !r.toField) this.flushText(isModifierKey(e.key));
    this.sendKeyEvents(this.hwOut(r.events));
  }

  /** Hardware keyboard output with the Command-key setting applied. */
  private hwOut(events: readonly KeyEvent[]): KeyEvent[] {
    return mapCommandKey(events, this.settings.commandKey);
  }

  /** PTR-5: hardware mouse (absolute, or relative under pointer lock). */
  private hardwareMouse(
    e: PointerEvent,
    type: 'down' | 'move' | 'up' | 'cancel',
    p: { x: number; y: number },
  ): void {
    const buttons = type === 'cancel' ? 0 : e.buttons;
    const b = pointerButtons(buttons);
    const newlyPressed = (buttons & 7 & ~this.lastMouseButtons) !== 0;
    if (newlyPressed) this.flushBeforeClick();
    const extra = extraButtonCombo(this.lastMouseButtons, buttons);
    this.lastMouseButtons = buttons;
    if (extra.length > 0) this.sendKeyEvents(extra);
    const layer = this.els?.gestureLayer;
    if (
      type === 'down' &&
      layer &&
      !this.pointerLocked &&
      this.settings.pointerLock &&
      this.effectiveMode() === 'trackpad' &&
      typeof layer.requestPointerLock === 'function'
    ) {
      try {
        const req = layer.requestPointerLock() as unknown;
        if (req instanceof Promise) req.catch(() => undefined);
      } catch {
        // Not allowed here (e.g. iOS): stay absolute.
      }
    }
    if (this.pointerLocked) {
      this.applyPointerOutput(
        this.pointer.handleRelativeMouse({ dx: e.movementX, dy: e.movementY, ...b }, this.viewport),
      );
      return;
    }
    this.applyPointerOutput(this.pointer.handleHardwareMouse({ ...p, ...b }, this.viewport));
  }

  /** Wheel with pixel / line / page deltas; horizontal deltas become Shift + wheel. */
  private hardwareWheel(e: WheelEvent, p: { x: number; y: number }): void {
    e.preventDefault();
    const dy = wheelDeltaPx(e.deltaY, e.deltaMode, this.viewport.screen.height);
    const dx = wheelDeltaPx(e.deltaX, e.deltaMode, this.viewport.screen.width);
    if (e.ctrlKey) {
      // Desktop trackpad pinch arrives as ctrl+wheel: zoom the view, not the remote.
      this.setViewport(zoomAt(this.viewport, Math.exp(-dy / 200), p));
      return;
    }
    const ny = this.wheel.add(dy);
    const nx = this.settings.horizontalScroll ? this.wheelX.add(dx) : 0;
    if (ny === 0 && nx === 0) return;
    if (!this.pointerLocked) {
      const out = this.pointer.handleHardwareMouse(
        { ...p, ...pointerButtons(e.buttons) },
        this.viewport,
      );
      this.sendMouse(out.mouse);
    }
    const base = this.lastMouse ?? {
      ...this.pointer.getPointer(this.viewport),
      left: false,
      middle: false,
      right: false,
      up: false,
      down: false,
    };
    this.sendMouse([...wheelStates(base, ny), ...wheelStates(base, nx, true)]);
  }

  private exitPointerLock(): void {
    if (this.pointerLocked && typeof document.exitPointerLock === 'function') {
      document.exitPointerLock();
    }
  }

  /**
   * DSP-8 split layout: attach (or detach with null) the trackpad surface below the
   * display. Its gestures always drive the pointer like a trackpad.
   */
  setTrackpadSurface(el: HTMLElement | null): void {
    for (const c of this.surfaceCleanups.splice(0)) c();
    this.handleGestures(this.surfaceRecognizer.reset(performance.now()), true);
    this.surface = el;
    this.updateCursor();
    if (!el) return;
    const handler = (type: 'down' | 'move' | 'up' | 'cancel') => (e: PointerEvent) => {
      if (e.cancelable) e.preventDefault();
      if (!this.active) return;
      if (type === 'down') {
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // ignore
        }
      }
      const r = el.getBoundingClientRect();
      const p = { x: e.clientX - r.left, y: e.clientY - r.top };
      const kind = pointerKind(e.pointerType);
      if (kind === 'mouse') {
        // A hardware mouse on the surface moves relatively, like a real trackpad.
        const b = pointerButtons(type === 'cancel' ? 0 : e.buttons);
        this.applyPointerOutput(
          this.pointer.handleRelativeMouse(
            { dx: e.movementX, dy: e.movementY, ...b },
            this.viewport,
          ),
        );
        return;
      }
      this.handleGestures(this.surfaceRecognizer.handle(toPointerInput(e, type, p, 'touch')), true);
    };
    const add = <K extends keyof HTMLElementEventMap>(
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      o?: AddEventListenerOptions,
    ) => {
      el.addEventListener(type, fn as EventListener, o);
      this.surfaceCleanups.push(() => el.removeEventListener(type, fn as EventListener, o));
    };
    add('pointerdown', handler('down'));
    add('pointermove', handler('move'));
    add('pointerup', handler('up'));
    add('pointercancel', handler('cancel'));
    const prevent = (e: Event) => {
      if (e.cancelable) e.preventDefault();
    };
    add('touchstart', prevent, { passive: false });
    add('touchmove', prevent, { passive: false });
    add('contextmenu', prevent);
    add('mousedown', prevent);
    if (this.effectiveMode() !== 'trackpad') this.bringPointerIntoView();
  }

  /** Native keyboard events (Capacitor Keyboard plugin). */
  setNativeKeyboard(open: boolean, height: number): void {
    this.nativeKeyboardOpen = open;
    this.nativeKeyboardHeight = open ? Math.max(0, height) : 0;
    if (!open) {
      // The user dismissed the keyboard (back key / swipe): drop focus so the keyboard
      // button reflects it and can raise it again.
      const field = this.els?.field;
      if (field && document.activeElement === field) field.blur();
    }
    this.measure();
  }
}

function toPointerInput(
  e: PointerEvent,
  type: PointerInput['type'],
  p: { x: number; y: number },
  kind: PointerInput['pointerType'],
): PointerInput {
  return { id: e.pointerId, type, x: p.x, y: p.y, timeMs: performance.now(), pointerType: kind };
}

function pickKey(e: KeyboardEvent) {
  return {
    key: e.key,
    code: e.code,
    keyCode: e.keyCode,
    ctrlKey: e.ctrlKey,
    altKey: e.altKey,
    metaKey: e.metaKey,
    shiftKey: e.shiftKey,
    isComposing: e.isComposing,
  };
}

function caretToEnd(field: HTMLTextAreaElement): void {
  const end = field.value.length;
  if (field.selectionStart === end && field.selectionEnd === end) return;
  try {
    field.setSelectionRange(end, end);
  } catch {
    // ignore
  }
}

/** Whether every pixel of the cursor image is transparent (remote hid its cursor). */
function isFullyTransparent(canvas: HTMLCanvasElement): boolean {
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx || canvas.width === 0 || canvas.height === 0) return true;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) !== 0) return false;
    return true;
  } catch {
    return false;
  }
}

function isEditable(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return (
    el.isContentEditable || el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
  );
}

interface TrafficStats {
  rxBytes: number;
  rxInstr: number;
  txBytes: number;
  txInstr: number;
  frames: number;
  connectedAt: number;
}

function emptyStats(): TrafficStats {
  return { rxBytes: 0, rxInstr: 0, txBytes: 0, txInstr: 0, frames: 0, connectedAt: 0 };
}

/** Approximate wire length of an instruction ("<len>.<value>," per element). */
function instructionLength(opcode: string, args: readonly string[]): number {
  let n = opcode.length + 3;
  for (const a of args) n += a.length + 3;
  return n;
}

/** Readable tunnel type for the info sheet (active session table). */
function describeTunnel(tunnel: TunnelLike): string {
  const types = sessionStrings.info.tunnelTypes;
  try {
    if (tunnel instanceof Guacamole.ChainedTunnel) return types.chained;
    if (tunnel instanceof Guacamole.WebSocketTunnel) return 'WebSocket';
    if (tunnel instanceof Guacamole.HTTPTunnel) return types.http;
  } catch {
    // ignore
  }
  const name = (tunnel as { constructor?: { name?: string } }).constructor?.name ?? '';
  if (/demo/i.test(name)) return types.demo;
  if (/socket/i.test(name)) return 'WebSocket';
  return name ? types.customNamed(name) : types.custom;
}

function tunnelStateName(state: number): string {
  const names = sessionStrings.info.tunnelStates;
  switch (state) {
    case TunnelState.CONNECTING:
      return names.connecting;
    case TunnelState.OPEN:
      return names.open;
    case TunnelState.UNSTABLE:
      return names.unstable;
    default:
      return names.closed;
  }
}

/** Toast for a user joining or leaving ('' = anonymous). */
function viewerNotice(name: string, joined: boolean): string {
  const t = sessionStrings.viewers;
  if (name === '') return joined ? t.anonymousJoined : t.anonymousLeft;
  return joined ? t.joined(name) : t.left(name);
}

function errorText(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return sessionStrings.status.startFailed;
}
