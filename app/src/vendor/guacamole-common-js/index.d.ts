/*
 * TypeScript declarations for the vendored guacamole-common-js bundle (index.js).
 *
 * Hand-written for OpenMobileGuac from the JSDoc and code in ./modules (apache/guacamole-client
 * tag 1.6.0). They cover the parts of the library this app uses; anything not declared here
 * still exists at runtime. Review against ./modules whenever the vendored tag changes.
 *
 * Note: inside `namespace Guacamole`, the names Event, Object, Touch, Position and Layer refer
 * to the Guacamole classes. DOM/builtin types that would be shadowed use the aliases below.
 */

type DOMEventType = Event;
type DOMTouchEventType = TouchEvent;
type DOMEventOrEvents = DOMEventType | DOMEventType[];

/** Constant map with literal values, as the upstream enum-like objects are. */
type ConstMap<T extends Record<string, number | string>> = { readonly [K in keyof T]: T[K] };

declare namespace Guacamole {
  /** Version of the Guacamole JavaScript API (Version.js). */
  const API_VERSION: string;

  // ---------------------------------------------------------------------------------------
  // Status.js
  // ---------------------------------------------------------------------------------------

  class Status {
    constructor(code: number, message?: string);
    code: number;
    message: string | undefined;
    isError(): boolean;
  }

  namespace Status {
    const Code: ConstMap<{
      SUCCESS: 0x0000;
      UNSUPPORTED: 0x0100;
      SERVER_ERROR: 0x0200;
      SERVER_BUSY: 0x0201;
      UPSTREAM_TIMEOUT: 0x0202;
      UPSTREAM_ERROR: 0x0203;
      RESOURCE_NOT_FOUND: 0x0204;
      RESOURCE_CONFLICT: 0x0205;
      RESOURCE_CLOSED: 0x0206;
      UPSTREAM_NOT_FOUND: 0x0207;
      UPSTREAM_UNAVAILABLE: 0x0208;
      SESSION_CONFLICT: 0x0209;
      SESSION_TIMEOUT: 0x020a;
      SESSION_CLOSED: 0x020b;
      CLIENT_BAD_REQUEST: 0x0300;
      CLIENT_UNAUTHORIZED: 0x0301;
      CLIENT_FORBIDDEN: 0x0303;
      CLIENT_TIMEOUT: 0x0308;
      CLIENT_OVERRUN: 0x030d;
      CLIENT_BAD_TYPE: 0x030f;
      CLIENT_TOO_MANY: 0x031d;
    }> & {
      /** Maps an HTTP status code to a Guacamole status code. */
      fromHTTPCode(status: number): number;
      /** Maps a WebSocket close code to a Guacamole status code. */
      fromWebSocketCode(code: number): number;
    };
  }

  // ---------------------------------------------------------------------------------------
  // Parser.js
  // ---------------------------------------------------------------------------------------

  class Parser {
    constructor();
    /**
     * Appends data to the internal buffer and parses every complete instruction, invoking
     * oninstruction for each. isBuffer=true means `packet` is the internal buffer itself.
     */
    receive(packet: string, isBuffer?: boolean): void;
    oninstruction: ((opcode: string, parameters: string[]) => void) | null;
    /** Number of Unicode code points in str (optionally between start and end). */
    static codePointCount(str: string, start?: number, end?: number): number;
    /** Converts opcode + args to a Guacamole protocol instruction string. */
    static toInstruction(elements: unknown[]): string;
  }

  // ---------------------------------------------------------------------------------------
  // Tunnel.js
  // ---------------------------------------------------------------------------------------

  class Tunnel {
    constructor();
    connect(data?: string): void;
    disconnect(): void;
    /** Sends one instruction; the first element is the opcode. */
    sendMessage(...elements: unknown[]): void;
    /** Changes state, firing onstatechange if it differs. */
    setState(state: number): void;
    /** Changes the UUID, firing onuuid. */
    setUUID(uuid: string): void;
    /** True if state is OPEN or UNSTABLE. */
    isConnected(): boolean;
    /** One of Tunnel.State. */
    state: number;
    /** Milliseconds without data before the tunnel is closed. Default 15000. */
    receiveTimeout: number;
    /** Milliseconds without data before the tunnel is UNSTABLE. Default 1500. */
    unstableThreshold: number;
    uuid: string | null;
    onuuid: ((uuid: string) => void) | null;
    onerror: ((status: Status) => void) | null;
    onstatechange: ((state: number) => void) | null;
    oninstruction: ((opcode: string, parameters: string[]) => void) | null;
  }

  namespace Tunnel {
    /** Opcode of internal tunnel-control instructions (the empty string). */
    const INTERNAL_DATA_OPCODE: string;
    const State: ConstMap<{ CONNECTING: 0; OPEN: 1; CLOSED: 2; UNSTABLE: 3 }>;
  }

  class HTTPTunnel extends Tunnel {
    constructor(
      tunnelURL: string,
      crossDomain?: boolean,
      extraTunnelHeaders?: Record<string, string>,
    );
  }

  class WebSocketTunnel extends Tunnel {
    /** tunnelURL may be relative or absolute; ws:// or wss:// is derived when relative. */
    constructor(tunnelURL: string);
  }

  class ChainedTunnel extends Tunnel {
    /** Tries each tunnel in turn until one connects. */
    constructor(...tunnelChain: Tunnel[]);
  }

  class StaticHTTPTunnel extends Tunnel {
    constructor(url: string, crossDomain?: boolean, extraTunnelHeaders?: Record<string, string>);
    /** Size of the static resource in bytes, if known. */
    size: number | null;
  }

  // ---------------------------------------------------------------------------------------
  // Client.js
  // ---------------------------------------------------------------------------------------

  class Client {
    constructor(tunnel: Tunnel);
    exportState(callback: (state: object) => void): void;
    importState(state: object, callback?: () => void): void;
    getDisplay(): Display;
    sendSize(width: number, height: number): void;
    sendKeyEvent(pressed: boolean | number, keysym: number): void;
    sendMouseState(mouseState: Mouse.State, applyDisplayScale?: boolean): void;
    sendTouchState(touchState: Touch.State, applyDisplayScale?: boolean): void;
    createOutputStream(): OutputStream;
    createAudioStream(mimetype: string): OutputStream;
    createFileStream(mimetype: string, filename: string): OutputStream;
    createPipeStream(mimetype: string, name: string): OutputStream;
    createClipboardStream(mimetype: string): OutputStream;
    createArgumentValueStream(mimetype: string, name: string): OutputStream;
    createObjectOutputStream(index: number, mimetype: string, name: string): OutputStream;
    requestObjectInputStream(index: number, name: string): void;
    sendAck(index: number, message: string, code: number): void;
    sendBlob(index: number, data: string): void;
    endStream(index: number): void;
    disconnect(): void;
    /** Connects the underlying tunnel; data is passed to Tunnel.connect (connect params). */
    connect(data?: string): void;

    /** One of Client.State. */
    onstatechange: ((state: number) => void) | null;
    onname: ((name: string) => void) | null;
    onerror: ((status: Status) => void) | null;
    /** Return false to suppress any default handling. msgcode is one of Client.Message. */
    onmsg: ((msgcode: number, args: string[]) => boolean | void) | null;
    onjoin: ((userID: string, name: string) => void) | null;
    onleave: ((userID: string, name: string) => void) | null;
    /** Return a player to handle the stream, or null to use the default. */
    onaudio: ((stream: InputStream, mimetype: string) => AudioPlayer | null) | null;
    onvideo:
      | ((stream: InputStream, layer: Display.VisibleLayer, mimetype: string) => VideoPlayer | null)
      | null;
    onmultitouch: ((layer: Display.VisibleLayer, touches: number) => void) | null;
    onargv: ((stream: InputStream, mimetype: string, name: string) => void) | null;
    onclipboard: ((stream: InputStream, mimetype: string) => void) | null;
    onfile: ((stream: InputStream, mimetype: string, filename: string) => void) | null;
    onfilesystem: ((object: Object, name: string) => void) | null;
    onpipe: ((stream: InputStream, mimetype: string, name: string) => void) | null;
    onrequired: ((parameters: string[]) => void) | null;
    onsync: ((timestamp: number, frames: number) => void) | null;
  }

  namespace Client {
    const State: ConstMap<{
      IDLE: 0;
      CONNECTING: 1;
      WAITING: 2;
      CONNECTED: 3;
      DISCONNECTING: 4;
      DISCONNECTED: 5;
    }>;
    const Message: ConstMap<{ USER_JOINED: 0x0001; USER_LEFT: 0x0002 }>;
  }

  // ---------------------------------------------------------------------------------------
  // Layer.js, Display.js
  // ---------------------------------------------------------------------------------------

  class Layer {
    constructor(width: number, height: number);
    autosize: boolean;
    width: number;
    height: number;
    getCanvas(): HTMLCanvasElement;
    toCanvas(): HTMLCanvasElement;
    resize(newWidth: number, newHeight: number): void;
    drawImage(x: number, y: number, image: CanvasImageSource): void;
    transfer(
      srcLayer: Layer,
      srcx: number,
      srcy: number,
      srcw: number,
      srch: number,
      x: number,
      y: number,
      transferFunction: (src: Layer.Pixel, dst: Layer.Pixel) => void,
    ): void;
    put(srcLayer: Layer, srcx: number, srcy: number, srcw: number, srch: number, x: number, y: number): void;
    copy(srcLayer: Layer, srcx: number, srcy: number, srcw: number, srch: number, x: number, y: number): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, negative: boolean): void;
    curveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
    close(): void;
    rect(x: number, y: number, w: number, h: number): void;
    clip(): void;
    strokeColor(cap: string, join: string, thickness: number, r: number, g: number, b: number, a: number): void;
    fillColor(r: number, g: number, b: number, a: number): void;
    strokeLayer(cap: string, join: string, thickness: number, srcLayer: Layer): void;
    fillLayer(srcLayer: Layer): void;
    push(): void;
    pop(): void;
    reset(): void;
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
    transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
    setChannelMask(mask: number): void;
    setMiterLimit(limit: number): void;
  }

  namespace Layer {
    /** Channel masks (compositing operations). */
    const ROUT: number;
    const ATOP: number;
    const XOR: number;
    const ROVER: number;
    const OVER: number;
    const PLUS: number;
    const RIN: number;
    const IN: number;
    const OUT: number;
    const RATOP: number;
    const SRC: number;

    class Pixel {
      constructor(r: number, g: number, b: number, a: number);
      red: number;
      green: number;
      blue: number;
      alpha: number;
    }
  }

  class Display {
    constructor();
    cursorHotspotX: number;
    cursorHotspotY: number;
    cursorX: number;
    cursorY: number;
    /** Milliseconds over which onstatistics figures are computed; 0 disables. */
    statisticWindow: number;
    onresize: ((width: number, height: number) => void) | null;
    oncursor: ((canvas: HTMLCanvasElement, x: number, y: number) => void) | null;
    onstatistics: ((stats: Display.Statistics) => void) | null;

    /** The outer element containing the whole display (a div created by the library). */
    getElement(): HTMLDivElement;
    getWidth(): number;
    getHeight(): number;
    getDefaultLayer(): Display.VisibleLayer;
    getCursorLayer(): Display.VisibleLayer;
    createLayer(): Display.VisibleLayer;
    createBuffer(): Layer;
    flush(callback?: () => void, timestamp?: number, logicalFrames?: number): void;
    cancel(): void;
    setCursor(
      hotspotX: number,
      hotspotY: number,
      layer: Layer,
      srcx: number,
      srcy: number,
      srcw: number,
      srch: number,
    ): void;
    showCursor(shown?: boolean): void;
    moveCursor(x: number, y: number): void;
    resize(layer: Layer, width: number, height: number): void;
    drawImage(layer: Layer, x: number, y: number, image: CanvasImageSource): void;
    drawBlob(layer: Layer, x: number, y: number, blob: Blob): void;
    drawStream(layer: Layer, x: number, y: number, stream: InputStream, mimetype: string): void;
    draw(layer: Layer, x: number, y: number, url: string): void;
    play(layer: Layer, mimetype: string, duration: number, url: string): void;
    transfer(
      srcLayer: Layer,
      srcx: number,
      srcy: number,
      srcw: number,
      srch: number,
      dstLayer: Layer,
      x: number,
      y: number,
      transferFunction: (src: Layer.Pixel, dst: Layer.Pixel) => void,
    ): void;
    put(srcLayer: Layer, srcx: number, srcy: number, srcw: number, srch: number, dstLayer: Layer, x: number, y: number): void;
    copy(srcLayer: Layer, srcx: number, srcy: number, srcw: number, srch: number, dstLayer: Layer, x: number, y: number): void;
    moveTo(layer: Layer, x: number, y: number): void;
    lineTo(layer: Layer, x: number, y: number): void;
    arc(layer: Layer, x: number, y: number, radius: number, startAngle: number, endAngle: number, negative: boolean): void;
    curveTo(layer: Layer, cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
    close(layer: Layer): void;
    rect(layer: Layer, x: number, y: number, w: number, h: number): void;
    clip(layer: Layer): void;
    strokeColor(layer: Layer, cap: string, join: string, thickness: number, r: number, g: number, b: number, a: number): void;
    fillColor(layer: Layer, r: number, g: number, b: number, a: number): void;
    strokeLayer(layer: Layer, cap: string, join: string, thickness: number, srcLayer: Layer): void;
    fillLayer(layer: Layer, srcLayer: Layer): void;
    push(layer: Layer): void;
    pop(layer: Layer): void;
    reset(layer: Layer): void;
    setTransform(layer: Layer, a: number, b: number, c: number, d: number, e: number, f: number): void;
    transform(layer: Layer, a: number, b: number, c: number, d: number, e: number, f: number): void;
    setChannelMask(layer: Layer, mask: number): void;
    setMiterLimit(layer: Layer, limit: number): void;
    dispose(layer: Display.VisibleLayer): void;
    distort(layer: Display.VisibleLayer, a: number, b: number, c: number, d: number, e: number, f: number): void;
    move(layer: Display.VisibleLayer, parent: Display.VisibleLayer, x: number, y: number, z: number): void;
    shade(layer: Display.VisibleLayer, alpha: number): void;
    /** Sets the CSS scale of the display (1 = native size). */
    scale(scale: number): void;
    getScale(): number;
    /** Renders all visible layers into a single new canvas. */
    flatten(): HTMLCanvasElement;
  }

  namespace Display {
    class VisibleLayer extends Layer {
      constructor(width: number, height: number);
      /** Opacity, 0-255. */
      alpha: number;
      x: number;
      y: number;
      z: number;
      matrix: number[];
      parent: VisibleLayer | null;
      children: Record<number, VisibleLayer>;
      /** The div containing this layer's canvas. */
      getElement(): HTMLDivElement;
      translate(x: number, y: number): void;
      move(parent: VisibleLayer, x: number, y: number, z: number): void;
      shade(a: number): void;
      dispose(): void;
      distort(a: number, b: number, c: number, d: number, e: number, f: number): void;
    }

    class Statistics {
      constructor(template?: Partial<Statistics>);
      processingLag: number | null | undefined;
      desktopFps: number | null | undefined;
      serverFps: number | null | undefined;
      clientFps: number | null | undefined;
      dropRate: number | null | undefined;
    }
  }

  // ---------------------------------------------------------------------------------------
  // Position.js, Event.js
  // ---------------------------------------------------------------------------------------

  class Position {
    constructor(template?: { x?: number; y?: number });
    x: number;
    y: number;
    /** Updates x/y from client coordinates relative to element. */
    fromClientPosition(element: Element, clientX: number, clientY: number): void;
    static fromClientPosition(element: Element, clientX: number, clientY: number): Position;
  }

  class Event {
    constructor(type: string);
    type: string;
    /** Creation time, ms since epoch. */
    timestamp: number;
    getAge(): number;
    invokeLegacyHandler(eventTarget: Event.Target): void;
  }

  namespace Event {
    type Listener<E extends Guacamole.Event = Guacamole.Event> = (event: E, target: Target) => void;

    class DOMEvent extends Guacamole.Event {
      constructor(type: string, events?: DOMEventOrEvents);
      preventDefault(): void;
      stopPropagation(): void;
      static cancelEvent(event: DOMEventType): void;
    }

    class Target {
      constructor();
      on(type: string, listener: Listener): void;
      onEach(types: string[], listener: Listener): void;
      dispatch(event: Guacamole.Event): void;
      off(type: string, listener: Listener): boolean;
      offEach(types: string[], listener: Listener): boolean;
    }
  }

  // ---------------------------------------------------------------------------------------
  // Mouse.js
  // ---------------------------------------------------------------------------------------

  type MouseEventType = 'mousedown' | 'mouseup' | 'mousemove' | 'mouseout';
  type MouseButton = 'left' | 'middle' | 'right' | 'up' | 'down';

  /** Native mouse input on an element. Dispatches Mouse.Event ("mousedown", ...). */
  class Mouse extends MouseEventTargetBase {
    constructor(element: Element);
    touchMouseThreshold: number;
    scrollThreshold: number;
    PIXELS_PER_LINE: number;
    PIXELS_PER_PAGE: number;
    /** Sets the local CSS cursor to the canvas; returns false if unsupported. */
    setCursor(canvas: HTMLCanvasElement, x: number, y: number): boolean;
  }

  namespace Mouse {
    interface StateTemplate {
      x?: number;
      y?: number;
      left?: boolean;
      middle?: boolean;
      right?: boolean;
      up?: boolean;
      down?: boolean;
    }

    class State extends Position {
      constructor(template?: StateTemplate);
      /** Legacy (1.3.0 and older) form. */
      constructor(
        x: number,
        y: number,
        left: boolean,
        middle: boolean,
        right: boolean,
        up: boolean,
        down: boolean,
      );
      left: boolean;
      middle: boolean;
      right: boolean;
      up: boolean;
      down: boolean;
    }

    namespace State {
      const Buttons: ConstMap<{
        LEFT: 'left';
        MIDDLE: 'middle';
        RIGHT: 'right';
        UP: 'up';
        DOWN: 'down';
      }>;
    }

    class Event extends Guacamole.Event.DOMEvent {
      constructor(type: string, state: State, events?: DOMEventOrEvents);
      state: State;
    }

    namespace Event {
      /** Base of Mouse, Mouse.Touchpad and Mouse.Touchscreen. */
      class Target extends MouseEventTargetBase {
        constructor();
      }
    }

    /** Emulates a mouse with relative (trackpad-style) touch gestures. */
    class Touchpad extends MouseEventTargetBase {
      constructor(element: Element);
      scrollThreshold: number;
      clickTimingThreshold: number;
      clickMoveThreshold: number;
    }

    /** Emulates a mouse with absolute (direct) touch gestures. */
    class Touchscreen extends MouseEventTargetBase {
      constructor(element: Element);
      scrollThreshold: number;
      clickTimingThreshold: number;
      clickMoveThreshold: number;
      longPressThreshold: number;
    }
  }

  // ---------------------------------------------------------------------------------------
  // Touch.js
  // ---------------------------------------------------------------------------------------

  type TouchEventType = 'touchstart' | 'touchmove' | 'touchend';

  /** Raw multi-touch input on an element. Dispatches Touch.Event. */
  class Touch extends Event.Target {
    constructor(element: Element);
    on(type: TouchEventType, listener: Event.Listener<Touch.Event>): void;
    on(type: string, listener: Event.Listener): void;
    onEach(types: TouchEventType[], listener: Event.Listener<Touch.Event>): void;
    onEach(types: string[], listener: Event.Listener): void;
    /** Active touches by identifier. */
    touches: Record<number, Touch.State>;
    activeTouches: number;
  }

  namespace Touch {
    interface StateTemplate {
      x?: number;
      y?: number;
      id?: number;
      radiusX?: number;
      radiusY?: number;
      angle?: number;
      force?: number;
    }

    class State extends Position {
      constructor(template?: StateTemplate);
      id: number;
      radiusX: number;
      radiusY: number;
      angle: number;
      /** 0-1; 0 means the touch has ended. */
      force: number;
    }

    class Event extends Guacamole.Event.DOMEvent {
      constructor(type: string, event: DOMTouchEventType, state: State);
      state: State;
    }
  }

  // ---------------------------------------------------------------------------------------
  // Keyboard.js
  // ---------------------------------------------------------------------------------------

  class Keyboard {
    /** Listens on element (if given); more elements can be added with listenTo(). */
    constructor(element?: Element | Document);
    /** Return false to prevent the default action of the key event. */
    onkeydown: ((keysym: number) => boolean | void) | null;
    onkeyup: ((keysym: number) => void) | null;
    modifiers: Keyboard.ModifierState;
    /** Currently pressed keysyms. */
    pressed: Record<number, boolean>;
    /** Presses keysym (firing onkeydown); returns the onkeydown result. */
    press(keysym: number): boolean;
    release(keysym: number): void;
    /** Presses and releases the keys needed to type str. */
    type(str: string): void;
    /** Releases all pressed keys. */
    reset(): void;
    listenTo(element: Element | Document): void;
  }

  namespace Keyboard {
    class ModifierState {
      constructor();
      shift: boolean;
      ctrl: boolean;
      alt: boolean;
      meta: boolean;
      hyper: boolean;
      static fromKeyboardEvent(e: KeyboardEvent): ModifierState;
    }
  }

  // ---------------------------------------------------------------------------------------
  // Streams: InputStream.js, OutputStream.js and the readers/writers
  // ---------------------------------------------------------------------------------------

  class InputStream {
    constructor(client: Client, index: number);
    index: number;
    /** Base64-encoded data. */
    onblob: ((data: string) => void) | null;
    onend: (() => void) | null;
    sendAck(message: string, code: number): void;
    toReadableStream(): ReadableStream;
  }

  class OutputStream {
    constructor(client: Client, index: number);
    index: number;
    onack: ((status: Status) => void) | null;
    /** Sends base64-encoded data. */
    sendBlob(data: string): void;
    sendEnd(): void;
  }

  class StringReader {
    constructor(stream: InputStream);
    ontext: ((text: string) => void) | null;
    onend: (() => void) | null;
  }

  class StringWriter {
    constructor(stream: OutputStream);
    sendText(text: string): void;
    sendEnd(): void;
    onack: ((status: Status) => void) | null;
  }

  class BlobReader {
    constructor(stream: InputStream, mimetype: string);
    getLength(): number;
    getBlob(): Blob;
    onprogress: ((length: number) => void) | null;
    onend: (() => void) | null;
  }

  class BlobWriter {
    constructor(stream: OutputStream);
    sendBlob(blob: Blob): void;
    sendEnd(): void;
    onack: ((status: Status) => void) | null;
    onerror: ((blob: Blob, offset: number, error: DOMException) => void) | null;
    onprogress: ((blob: Blob, offset: number) => void) | null;
    oncomplete: ((blob: Blob) => void) | null;
  }

  class ArrayBufferReader {
    constructor(stream: InputStream);
    ondata: ((buffer: ArrayBuffer) => void) | null;
    onend: (() => void) | null;
  }

  class ArrayBufferWriter {
    constructor(stream: OutputStream);
    blobLength: number;
    sendData(data: ArrayBuffer | ArrayBufferView): void;
    sendEnd(): void;
    onack: ((status: Status) => void) | null;
  }

  namespace ArrayBufferWriter {
    const DEFAULT_BLOB_LENGTH: number;
  }

  class JSONReader {
    constructor(stream: InputStream);
    getLength(): number;
    getJSON(): unknown;
    onprogress: ((length: number) => void) | null;
    onend: (() => void) | null;
  }

  class DataURIReader {
    constructor(stream: InputStream, mimetype: string);
    getURI(): string;
    onend: (() => void) | null;
  }

  // ---------------------------------------------------------------------------------------
  // AudioPlayer.js, VideoPlayer.js
  // ---------------------------------------------------------------------------------------

  class AudioPlayer {
    constructor();
    /** Re-synchronises playback with the remote stream. */
    sync(): void;
    static isSupportedType(mimetype: string): boolean;
    static getSupportedTypes(): string[];
    static getInstance(stream: InputStream, mimetype: string): AudioPlayer | null;
  }

  class RawAudioPlayer extends AudioPlayer {
    constructor(stream: InputStream, mimetype: string);
  }

  class VideoPlayer {
    constructor();
    sync(): void;
    static isSupportedType(mimetype: string): boolean;
    static getSupportedTypes(): string[];
    static getInstance(
      stream: InputStream,
      layer: Display.VisibleLayer,
      mimetype: string,
    ): VideoPlayer | null;
  }

  // ---------------------------------------------------------------------------------------
  // Object.js
  // ---------------------------------------------------------------------------------------

  /** A server-side object (e.g. a filesystem) exposing named streams. */
  class Object {
    constructor(client: Client, index: number);
    index: number;
    /** Default implementation dispatches to callbacks queued by requestInputStream(). */
    onbody: ((inputStream: InputStream, mimetype: string, name: string) => void) | null;
    onundefine: (() => void) | null;
    requestInputStream(
      name: string,
      bodyCallback?: (inputStream: InputStream, mimetype: string) => void,
    ): void;
    createOutputStream(mimetype: string, name: string): OutputStream;
  }

  namespace Object {
    const ROOT_STREAM: string;
    const STREAM_INDEX_MIMETYPE: string;
  }

  // ---------------------------------------------------------------------------------------
  // SessionRecording.js, KeyEventInterpreter.js
  // ---------------------------------------------------------------------------------------

  class SessionRecording {
    constructor(source: Blob | Tunnel, refreshInterval?: number);
    onload: (() => void) | null;
    onerror: ((message: string) => void) | null;
    onabort: (() => void) | null;
    onprogress: ((duration: number, parsedSize: number) => void) | null;
    onplay: (() => void) | null;
    onpause: (() => void) | null;
    onkeyevents: ((batch: KeyEventInterpreter.KeyEvent[]) => void) | null;
    onseek: ((position: number, current: number, total: number) => void) | null;
    connect(data?: string): void;
    disconnect(): void;
    abort(): void;
    getDisplay(): Display;
    isPlaying(): boolean;
    getPosition(): number;
    getDuration(): number;
    play(): void;
    seek(position: number, callback?: () => void): void;
    cancel(): void;
    pause(): void;
  }

  /** Rarely used here; only the KeyEvent shape is declared. */
  class KeyEventInterpreter {
    constructor(startTimestamp?: number);
    [member: string]: unknown;
  }

  namespace KeyEventInterpreter {
    class KeyEvent {
      constructor(template?: Partial<KeyEvent>);
      keysym: number;
      name: string;
      value: string;
      definition: unknown;
      pressed: boolean;
      timestamp: number;
    }
  }
}

/**
 * Guacamole.Mouse.Event.Target. Declared outside the namespace (and not exported) only because
 * TypeScript rejects `class Mouse extends Mouse.Event.Target` as self-referential; at runtime
 * it is Guacamole.Mouse.Event.Target.
 */
declare class MouseEventTargetBase extends Guacamole.Event.Target {
  on(
    type: Guacamole.MouseEventType,
    listener: Guacamole.Event.Listener<Guacamole.Mouse.Event>,
  ): void;
  on(type: string, listener: Guacamole.Event.Listener): void;
  onEach(
    types: Guacamole.MouseEventType[],
    listener: Guacamole.Event.Listener<Guacamole.Mouse.Event>,
  ): void;
  onEach(types: string[], listener: Guacamole.Event.Listener): void;
  currentState: Guacamole.Mouse.State;
  press(button: Guacamole.MouseButton, events?: DOMEventOrEvents): void;
  release(button: Guacamole.MouseButton, events?: DOMEventOrEvents): void;
  click(button: Guacamole.MouseButton, events?: DOMEventOrEvents): void;
  move(position: Guacamole.Position | { x: number; y: number }, events?: DOMEventOrEvents): void;
  out(events?: DOMEventOrEvents): void;
  reset(events?: DOMEventOrEvents): void;
  /** Legacy handlers, invoked by Mouse.Event before registered listeners. */
  onmousedown?: ((state: Guacamole.Mouse.State) => void) | null;
  onmouseup?: ((state: Guacamole.Mouse.State) => void) | null;
  onmousemove?: ((state: Guacamole.Mouse.State) => void) | null;
  onmouseout?: ((state: Guacamole.Mouse.State) => void) | null;
}

export default Guacamole;
