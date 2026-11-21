/**
 * Microphone input (AUD-2): the device microphone sent to the remote as an `audio` stream,
 * as the Guacamole web client does for RDP `enable-audio-input`.
 *
 * Upstream (guacamole-client 1.6.0 `ManagedClient.js`, `requestAudioStream`): on CONNECTED it
 * calls `client.createAudioStream('audio/L16;rate=44100,channels=2')`, hands the stream to
 * `Guacamole.AudioRecorder.getInstance`, and opens a new stream whenever the recorder's
 * `onclose` fires. The web client does this on every connect; here it happens only while the
 * user has "Send microphone" on.
 *
 * Library and server facts (vendored `AudioRecorder.js`, guacamole-server 1.6.0):
 * - The recorder asks for the microphone (`getUserMedia`) only after the server acks the
 *   stream with SUCCESS. guacd installs an audio handler only for the connection owner and
 *   only with `enable-audio-input` (`rdp/user.c`); otherwise it acks "Audio input
 *   unsupported" / UNSUPPORTED (`libguac/user-handlers.c`), and the recorder calls `onerror`
 *   without ever touching the microphone. So the OS prompt appears only when the server
 *   really takes the audio.
 * - A refused `getUserMedia` ends the stream and calls `onerror` as well. The two are told
 *   apart by whether the SUCCESS ack was seen.
 * - The recorder has no public stop. Its tracks are stopped (and the stream ended) only from
 *   its own ack handler on a non-success status, so `stop()` feeds the stream's `onack` a
 *   CLIENT_ABORT status. That releases the microphone (the OS indicator turns off).
 * - That handler cannot stop a capture that has not started yet: between the server's
 *   SUCCESS ack and `getUserMedia` resolving (the OS prompt is up), an abort finds no media
 *   stream, and `streamReceived` then wires the microphone up anyway with nothing left to
 *   stop it. So a stop in that window is held until the capture starts (the first audio
 *   blob, which is dropped) or fails, and the tracks of any stream `getUserMedia` returns
 *   for a stopped recorder are stopped directly (a thin wrapper records them).
 * - The constructor shims `navigator.mediaDevices.getUserMedia` with `.bind` on the legacy
 *   functions and throws when none exists, so availability is checked first.
 * - Capacitor's WebViews forward the page's capture request: iOS grants the WKWebView
 *   request (`WebViewDelegationHandler.swift`), so only the system prompt
 *   (`NSMicrophoneUsageDescription`) is shown; Android asks for `RECORD_AUDIO` and
 *   `MODIFY_AUDIO_SETTINGS` (`BridgeWebChromeClient.onPermissionRequest`).
 */

import Guacamole from '../../vendor/guacamole-common-js';

/** `ManagedClient.AUDIO_INPUT_MIMETYPE`. */
export const AUDIO_INPUT_MIMETYPE = 'audio/L16;rate=44100,channels=2';

const CLIENT_ABORT = 0x0308;

export type MicState = 'off' | 'starting' | 'live';

/** Why the microphone stopped on its own. */
export type MicProblem = 'not-accepted' | 'denied' | 'unavailable';

type GuacClient = InstanceType<typeof Guacamole.Client>;
type OutputStream = InstanceType<typeof Guacamole.OutputStream>;

interface RecorderLike {
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

export interface RecorderStatics {
  isSupportedType(mimetype: string): boolean;
  getInstance(stream: OutputStream, mimetype: string): RecorderLike | null;
}

function recorderApi(): RecorderStatics | null {
  const r = (Guacamole as unknown as { AudioRecorder?: RecorderStatics }).AudioRecorder;
  return r ?? null;
}

function audioContext(): AudioContext | null {
  try {
    const f = (
      Guacamole as unknown as { AudioContextFactory?: { getAudioContext(): AudioContext | null } }
    ).AudioContextFactory;
    return f?.getAudioContext() ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether this WebView can capture audio at all: `getUserMedia` (or a legacy form the
 * library shims) and Web Audio support for `audio/L16`.
 */
export function microphoneAvailable(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & {
    getUserMedia?: unknown;
    webkitGetUserMedia?: unknown;
    mozGetUserMedia?: unknown;
    msGetUserMedia?: unknown;
  };
  const modern = typeof nav.mediaDevices?.getUserMedia === 'function';
  const legacy =
    typeof nav.getUserMedia === 'function' ||
    typeof nav.webkitGetUserMedia === 'function' ||
    typeof nav.mozGetUserMedia === 'function' ||
    typeof nav.msGetUserMedia === 'function';
  if (!modern && !legacy) return false;
  try {
    return recorderApi()?.isSupportedType(AUDIO_INPUT_MIMETYPE) === true;
  } catch {
    return false;
  }
}

/** Resume the shared AudioContext. Call from the user's tap (mobile WebViews need a gesture). */
export function primeAudioInput(): void {
  const ctx = audioContext();
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => undefined);
}

interface Current {
  readonly stream: OutputStream;
  /** Set before a deliberate stop, so the recorder's error callback is ignored. */
  stopping: boolean;
  /** The server acked the stream with SUCCESS (the recorder then asks for the microphone). */
  accepted: boolean;
  /** Audio has been sent: the capture is running. */
  live: boolean;
  /** The CLIENT_ABORT was fed to the recorder. */
  aborted: boolean;
  /** Media streams `getUserMedia` returned for this recorder. */
  readonly captured: MediaStream[];
}

function stopTracks(s: MediaStream): void {
  try {
    for (const t of s.getTracks()) t.stop();
  } catch {
    // already stopped
  }
}

/** Recorders waiting for `getUserMedia`, in the order they asked (FIFO). */
const awaitingCapture: Current[] = [];
let captureHookInstalled = false;

/**
 * Record the stream each `getUserMedia` call returns, so a recorder stopped while the OS
 * prompt was up can have its tracks stopped. Calls are made in ack order, one per recorder.
 */
function installCaptureHook(): void {
  if (captureHookInstalled || typeof navigator === 'undefined') return;
  const md = navigator.mediaDevices as MediaDevices | undefined;
  if (!md || typeof md.getUserMedia !== 'function') return;
  captureHookInstalled = true;
  const original = md.getUserMedia.bind(md);
  md.getUserMedia = (constraints?: MediaStreamConstraints) =>
    original(constraints).then(
      (stream) => {
        const cur = awaitingCapture.shift();
        if (cur) {
          cur.captured.push(stream);
          // Stopped while the prompt was up: release the microphone at once. The recorder
          // still wires this (now silent) stream up; its first blob triggers the abort,
          // which disconnects its audio nodes.
          if (cur.stopping) stopTracks(stream);
        }
        return stream;
      },
      (err: unknown) => {
        awaitingCapture.shift();
        throw err;
      },
    );
}

/** Feed the recorder its stop signal (once): it stops its tracks and ends the stream. */
function abortRecorder(cur: Current): void {
  if (cur.aborted) return;
  cur.aborted = true;
  try {
    cur.stream.onack?.(new Guacamole.Status(CLIENT_ABORT, 'Stopped'));
  } catch {
    // already closed
  }
}

export class SessionMicrophone {
  private state: MicState = 'off';
  private current: Current | null = null;
  private readonly changed: () => void;
  private readonly problem: (p: MicProblem) => void;
  private readonly log: (message: string) => void;
  private readonly recorder: () => RecorderStatics | null;
  private readonly available: () => boolean;

  constructor(opts: {
    readonly changed: () => void;
    readonly problem: (p: MicProblem) => void;
    readonly log: (message: string) => void;
    /** Tests: a stand-in for `Guacamole.AudioRecorder` and the capability check. */
    readonly recorder?: RecorderStatics;
    readonly available?: () => boolean;
  }) {
    this.changed = opts.changed;
    this.problem = opts.problem;
    this.log = opts.log;
    const injected = opts.recorder;
    this.recorder = injected ? () => injected : recorderApi;
    this.available = opts.available ?? microphoneAvailable;
  }

  getState(): MicState {
    return this.state;
  }

  private setState(s: MicState): void {
    if (s === this.state) return;
    this.state = s;
    this.changed();
  }

  /** Open an audio input stream on `client` (no-op while one is open). */
  start(client: GuacClient): void {
    if (this.current) return;
    const api = this.recorder();
    if (!api || !this.available()) {
      this.problem('unavailable');
      return;
    }
    let stream: OutputStream;
    let recorder: RecorderLike | null;
    try {
      stream = client.createAudioStream(AUDIO_INPUT_MIMETYPE);
      recorder = api.getInstance(stream, AUDIO_INPUT_MIMETYPE);
    } catch {
      this.problem('unavailable');
      return;
    }
    if (!recorder) {
      try {
        stream.sendEnd();
      } catch {
        // client gone
      }
      this.problem('unavailable');
      return;
    }
    installCaptureHook();
    const cur: Current = {
      stream,
      stopping: false,
      accepted: false,
      live: false,
      aborted: false,
      captured: [],
    };
    this.current = cur;
    // Observe the server's answer and the first audio blob without replacing the
    // recorder's own handlers (it reads acks through the stream's `onack`).
    const innerAck = stream.onack;
    stream.onack = (status) => {
      if (status.code === 0 && !cur.accepted && !cur.aborted) {
        cur.accepted = true;
        // The recorder calls getUserMedia from this very ack.
        if (captureHookInstalled) awaitingCapture.push(cur);
      }
      innerAck?.(status);
    };
    const innerSend = stream.sendBlob.bind(stream);
    stream.sendBlob = (data: string) => {
      if (cur.stopping) {
        // Stopped while the capture was starting: stop it now and send nothing.
        abortRecorder(cur);
        return;
      }
      if (!cur.live) {
        cur.live = true;
        this.log('Microphone live');
        if (this.current === cur) this.setState('live');
      }
      innerSend(data);
    };
    recorder.onerror = () => {
      const wanted = this.current === cur;
      if (wanted) {
        this.current = null;
        this.setState('off');
      }
      if (cur.stopping || !wanted) return;
      this.log(cur.accepted ? 'Microphone access refused' : 'Server refused audio input');
      this.problem(cur.accepted ? 'denied' : 'not-accepted');
    };
    // RESOURCE_CLOSED from the server: open a new stream, as upstream does.
    recorder.onclose = () => {
      if (this.current !== cur) return;
      this.current = null;
      this.setState('off');
      if (!cur.stopping) this.start(client);
    };
    this.log('Microphone stream requested');
    this.setState('starting');
  }

  /** Stop capturing (releases the microphone) and end the stream. Idempotent. */
  stop(): void {
    const cur = this.current;
    if (!cur) return;
    cur.stopping = true;
    this.current = null;
    for (const s of cur.captured) stopTracks(s);
    // Accepted but not capturing yet (the OS prompt may be up): an abort now would be lost,
    // so it happens when the capture starts (first blob, or the getUserMedia result).
    const capturePending = cur.accepted && !cur.live && cur.captured.length === 0;
    if (!capturePending) abortRecorder(cur);
    this.log('Microphone stopped');
    this.setState('off');
  }
}
