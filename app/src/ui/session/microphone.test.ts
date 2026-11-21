import { describe, expect, it, vi } from 'vitest';
import { AUDIO_INPUT_MIMETYPE, SessionMicrophone, type RecorderStatics } from './microphone.ts';

/** AUD-2: the recorder's lifecycle as the vendored AudioRecorder.js drives it. */

interface FakeStream {
  onack: ((s: { code: number }) => void) | null;
  sendBlob: (data: string) => void;
  sendEnd: () => void;
  blobs: string[];
}

function setup() {
  const streams: FakeStream[] = [];
  const recorders: {
    onclose: (() => void) | null;
    onerror: (() => void) | null;
    /** getUserMedia resolved and the processor is wired (the microphone is in use). */
    capturing: boolean;
    /** stopAudioCapture ran while capturing (tracks stopped). */
    stopped: boolean;
    /** The recorder stopped listening to acks (`writer.onack = null`). */
    deaf: boolean;
  }[] = [];
  const client = {
    createAudioStream: vi.fn((mimetype: string) => {
      expect(mimetype).toBe(AUDIO_INPUT_MIMETYPE);
      const s: FakeStream = {
        onack: null,
        blobs: [],
        sendBlob(data) {
          this.blobs.push(data);
        },
        sendEnd: vi.fn(),
      };
      streams.push(s);
      return s;
    }),
  };
  // Like RawAudioRecorder: listens to the stream's acks; error ack → onerror.
  const recorder: RecorderStatics = {
    isSupportedType: () => true,
    getInstance: (stream) => {
      const r = {
        onclose: null as (() => void) | null,
        onerror: null as (() => void) | null,
        capturing: false,
        stopped: false,
        deaf: false,
      };
      (stream as unknown as FakeStream).onack = (status) => {
        if (r.deaf) return;
        if (status.code === 0) return; // calls getUserMedia (resolved later: beginCapture)
        // stopAudioCapture: stops tracks only if the capture is already running.
        if (r.capturing) r.stopped = true;
        r.deaf = true;
        if (status.code === 0x0206 /* RESOURCE_CLOSED */) r.onclose?.();
        else r.onerror?.();
      };
      recorders.push(r);
      return r;
    },
  };
  const problem = vi.fn();
  const changed = vi.fn();
  const mic = new SessionMicrophone({
    changed,
    problem,
    log: () => undefined,
    recorder,
    available: () => true,
  });
  /** getUserMedia resolves: streamReceived wires the microphone whatever happened since. */
  const beginCapture = (i: number) => {
    const r = recorders[i];
    if (r) r.capturing = true;
  };
  /** onaudioprocess: a buffer of audio goes to the stream while capturing. */
  const emitAudio = (i: number) => {
    const r = recorders[i];
    if (r?.capturing && !r.stopped) streams[i]?.sendBlob('PCM');
  };
  return { mic, client: client as never, streams, recorders, problem, beginCapture, emitAudio };
}

describe('microphone (AudioRecorder, audio/L16 input stream)', () => {
  it('starting → live on the first audio blob → off on stop, without a problem', () => {
    const { mic, client, streams, problem } = setup();
    mic.start(client);
    expect(mic.getState()).toBe('starting');
    const s = streams[0];
    s?.onack?.({ code: 0 });
    s?.sendBlob('AAAA');
    expect(mic.getState()).toBe('live');
    expect(s?.blobs).toEqual(['AAAA']);
    mic.stop();
    expect(mic.getState()).toBe('off');
    expect(problem).not.toHaveBeenCalled();
  });

  it('a stop while the OS prompt is up still releases the microphone once capture starts', () => {
    const { mic, client, streams, recorders, problem, beginCapture, emitAudio } = setup();
    mic.start(client);
    streams[0]?.onack?.({ code: 0 }); // accepted: getUserMedia pending
    mic.stop();
    expect(mic.getState()).toBe('off');
    beginCapture(0); // the user answers the prompt afterwards
    emitAudio(0);
    expect(recorders[0]?.stopped).toBe(true);
    expect(streams[0]?.blobs).toEqual([]);
    emitAudio(0);
    expect(streams[0]?.blobs).toEqual([]);
    expect(problem).not.toHaveBeenCalled();
  });

  it('a stop before the server answered aborts at once', () => {
    const { mic, client, recorders } = setup();
    mic.start(client);
    mic.stop();
    expect(recorders[0]?.deaf).toBe(true);
  });

  it('the server refusing the stream (no enable-audio-input) is "not accepted"', () => {
    const { mic, client, streams, problem } = setup();
    mic.start(client);
    streams[0]?.onack?.({ code: 0x0100 });
    expect(problem).toHaveBeenCalledWith('not-accepted');
    expect(mic.getState()).toBe('off');
  });

  it('an error after the server accepted it is a refused microphone permission', () => {
    const { mic, client, recorders, streams, problem } = setup();
    mic.start(client);
    streams[0]?.onack?.({ code: 0 });
    recorders[0]?.onerror?.();
    expect(problem).toHaveBeenCalledWith('denied');
  });

  it('a closed stream is reopened, as upstream does', () => {
    const { mic, client, streams } = setup();
    mic.start(client);
    streams[0]?.onack?.({ code: 0x0206 });
    expect(streams).toHaveLength(2);
    expect(mic.getState()).toBe('starting');
  });

  it('starting twice opens one stream; unavailable capture reports it', () => {
    const { mic, client, streams } = setup();
    mic.start(client);
    mic.start(client);
    expect(streams).toHaveLength(1);
    const problem = vi.fn();
    const none = new SessionMicrophone({
      changed: () => undefined,
      problem,
      log: () => undefined,
      available: () => false,
    });
    none.start(client);
    expect(problem).toHaveBeenCalledWith('unavailable');
  });
});
