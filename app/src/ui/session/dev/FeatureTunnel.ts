/**
 * FeatureTunnel: the ScribbleTunnel desktop plus fakes of the stream features the demo
 * server does not implement, for browser checks of the session screen (dev only):
 *
 * - `required username password` before the first frame; the desktop is drawn only after
 *   both values arrive on `argv` streams (acked "Ready for updated parameter." like libguac
 *   `argv.c`). Values are checked against the harness's test credentials and only the
 *   result is logged.
 * - `filesystem 0 "Shared Drive"` with a small fake tree. `get` of a folder answers with a
 *   stream-index `body` and sends the JSON in two parts, one per client ack (like guacd
 *   `rdp/ls.c`); `get` of a file sends 4 KB blobs one per ack (`rdp/download.c`). A file
 *   named "blocked.bin" gets no body at all (downloads disabled). `put` / `file` uploads
 *   are acked "OK (STREAM BEGIN)", every blob "OK (DATA RECEIVED)"; a folder named
 *   "Read-only" refuses with CLIENT_FORBIDDEN "FAIL (UPLOAD DISABLED)" (`rdp/upload.c`).
 * - `pushDownload()` / `pushPrint()`: a server-initiated `file` stream that only starts
 *   after the client's first ack.
 * - `playTone()`: an `audio` stream with a generated 440 Hz tone, audio/L16 mono 22050 Hz.
 * - `userJoined()` / `userLeft()`: `msg` USER_JOINED (0x0001) / USER_LEFT (0x0002) with a
 *   user id and name, as guacd sends the connection owner (`libguac/client.c`).
 * - Client `audio` streams (microphone): acked SUCCESS while `audioInput` is true (RDP
 *   `enable-audio-input`), else "Audio input unsupported" / UNSUPPORTED
 *   (`libguac/user-handlers.c`); received bytes are counted and logged.
 */

import { ScribbleTunnel } from './ScribbleTunnel.ts';

const INDEX = 'application/vnd.glyptodon.guacamole.stream-index+json';
const BLOB = 4096;

/** Test-only credentials for the fake prompt (not secrets: the fake accepts only these). */
export const FEATURE_TEST_CREDENTIALS = { username: 'test-user', password: 'test-pass' };

function b64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function unb64(data: string): Uint8Array {
  const bin = atob(data);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const enc = (s: string) => new TextEncoder().encode(s);

interface Outgoing {
  /** Remaining chunks, sent one per success ack. */
  chunks: Uint8Array[];
  what: string;
  /** Delay (ms) before each chunk, to make a transfer slow enough to cancel. */
  delayMs?: number;
}

interface Upload {
  name: string;
  dir: string;
  bytes: number;
}

export class FeatureTunnel extends ScribbleTunnel {
  private readonly requireCredentials: boolean;
  private readonly withFilesystem: boolean;
  private pendingDraw: (() => void) | null = null;
  private readonly argv = new Map<string, { name: string; data: Uint8Array[] }>();
  private readonly argvValues = new Map<string, string>();
  private readonly outgoing = new Map<string, Outgoing>();
  private readonly uploads = new Map<string, Upload>();
  private nextIndex = 300;
  /** Folder → entries (name → file bytes, or null for a sub-folder). */
  private readonly tree = new Map<string, Map<string, Uint8Array | null>>();
  /** Instructions the client sent that the checks look at. */
  readonly seen: string[] = [];
  /** RDP `enable-audio-input`: accept the client's microphone stream. */
  audioInput = true;
  private readonly micStreams = new Map<string, number>();
  private nextUser = 1;
  private readonly users: string[] = [];

  constructor(options: { requireCredentials?: boolean; filesystem?: boolean } = {}) {
    super({ connectDelayMs: 300 });
    this.requireCredentials = options.requireCredentials ?? true;
    this.withFilesystem = options.filesystem ?? true;
    const big = new Uint8Array(150 * 1024);
    for (let i = 0; i < big.length; i++) big[i] = (i * 31) & 0xff;
    this.tree.set(
      '/',
      new Map<string, Uint8Array | null>([
        ['Download', null],
        ['Projects', null],
        ['Read-only', null],
        ['readme.txt', enc('Hello from the fake shared drive.\n')],
        ['big file.bin', big],
        ['blocked.bin', enc('never sent')],
      ]),
    );
    this.tree.set('/Download', new Map([['report ü 😀.txt', enc('Quarterly report\n')]]));
    this.tree.set('/Projects', new Map<string, Uint8Array | null>([['Plan', null]]));
    this.tree.set('/Projects/Plan', new Map([['todo.md', enc('- [ ] ship\n')]]));
    this.tree.set('/Read-only', new Map());
  }

  // ---- Credential prompt

  protected override beforeDesktop(draw: () => void): void {
    if (!this.requireCredentials) {
      draw();
      return;
    }
    this.pendingDraw = draw;
    this.record('argv', 'server: required username password');
    this.send(['required', 'username', 'password']);
  }

  protected override afterDesktop(): void {
    if (this.withFilesystem) this.send(['filesystem', '0', 'Shared Drive']);
    // Current values of changeable parameters, as SSH sends them (`ssh/argv.c`).
    for (const [name, value] of [
      ['font-size', '12'],
      ['color-scheme', 'gray-black'],
    ] as const) {
      const idx = String(this.nextIndex++);
      this.send(['argv', idx, 'text/plain', name]);
      this.send(['blob', idx, b64(enc(value))]);
      this.send(['end', idx]);
    }
    this.sync();
  }

  private argvComplete(): void {
    for (const [name, value] of this.argvValues) {
      if (name === 'username' || name === 'password') continue;
      this.record('argv', `parameter update: ${name} = ${JSON.stringify(value)}`);
      this.argvValues.delete(name);
    }
    if (!this.pendingDraw) return;
    if (!this.argvValues.has('username') || !this.argvValues.has('password')) return;
    const ok =
      this.argvValues.get('username') === FEATURE_TEST_CREDENTIALS.username &&
      this.argvValues.get('password') === FEATURE_TEST_CREDENTIALS.password;
    this.record(
      'argv',
      `argv received: username (${this.argvValues.get('username')?.length ?? 0} chars), password (${this.argvValues.get('password')?.length ?? 0} chars) → ${ok ? 'accepted' : 'rejected'}`,
    );
    if (!ok) {
      // Like an RDP server refusing the sign-in.
      this.send(['error', 'Authentication failure', '769']);
      return;
    }
    const draw = this.pendingDraw;
    this.pendingDraw = null;
    draw();
  }

  // ---- Server pushes

  pushDownload(): void {
    const text = Array.from({ length: 4000 }, (_, i) => `line ${i + 1} of the pushed file`).join(
      '\n',
    );
    // About 30 chunks, 40 ms apart: slow enough to cancel from the transfers list.
    this.startOutgoing(
      ['file', '', 'text/plain', 'pushed report.txt'],
      enc(text),
      'push download',
      40,
    );
  }

  pushPrint(): void {
    const pdf =
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n';
    this.startOutgoing(['file', '', 'application/pdf', 'Test page.pdf'], enc(pdf), 'print job');
  }

  /** One second of a 440 Hz tone, sent in 50 ms packets. */
  playTone(): void {
    if (!this.isConnected()) return;
    const idx = String(this.nextIndex++);
    const rate = 22050;
    this.send(['audio', idx, `audio/L16;rate=${rate},channels=1`]);
    this.record('other', `server: audio stream ${idx}`);
    const per = rate / 20;
    let sent = 0;
    const tick = () => {
      if (!this.isConnected() || sent >= 20) {
        if (this.isConnected()) this.send(['end', idx]);
        return;
      }
      const pcm = new Int16Array(per);
      for (let i = 0; i < per; i++) {
        const t = (sent * per + i) / rate;
        pcm[i] = Math.round(Math.sin(2 * Math.PI * 440 * t) * 6000);
      }
      this.send(['blob', idx, b64(new Uint8Array(pcm.buffer))]);
      this.sync();
      sent++;
      setTimeout(tick, 50);
    };
    tick();
  }

  /** Another user joins (names cycle; every third is anonymous, as a share link). */
  userJoined(): void {
    if (!this.isConnected()) return;
    const n = this.nextUser++;
    const id = `@user-${n}`;
    const name = n % 3 === 0 ? '' : `viewer${n}`;
    this.users.push(id);
    this.send(['msg', '1', id, name]);
    this.record('other', `server: user ${id} joined`);
  }

  userLeft(): void {
    const id = this.users.shift();
    if (!id || !this.isConnected()) return;
    this.send(['msg', '2', id, '']);
    this.record('other', `server: user ${id} left`);
  }

  /** Server-to-client stream that starts on the first ack, then one chunk per ack. */
  private startOutgoing(head: string[], data: Uint8Array, what: string, delayMs = 0): void {
    if (!this.isConnected()) return;
    const idx = String(this.nextIndex++);
    const chunks: Uint8Array[] = [];
    for (let o = 0; o < data.length; o += BLOB) chunks.push(data.subarray(o, o + BLOB));
    this.outgoing.set(idx, { chunks, what, delayMs });
    const instr = head.slice();
    if (instr[0] === 'file') instr[1] = idx;
    this.send(instr);
    this.record('file', `server: ${what} on stream ${idx} (${data.length} bytes), waiting for ack`);
  }

  // ---- Client instructions

  protected override handleExtra(opcode: string, a: readonly string[]): boolean {
    switch (opcode) {
      case 'argv': {
        const [idx = '', mimetype = '', name = ''] = a;
        this.seen.push(`argv ${mimetype} ${name}`);
        this.argv.set(idx, { name, data: [] });
        this.send(['ack', idx, 'Ready for updated parameter.', '0']);
        return true;
      }
      case 'get':
        this.onGet(a[0] ?? '', a[1] ?? '');
        return true;
      case 'put':
        this.onUpload(a[1] ?? '', a[3] ?? '', a[2] ?? '');
        return true;
      case 'file':
        this.onUpload(a[0] ?? '', a[2] ?? '', a[1] ?? '', true);
        return true;
      case 'audio': {
        const [idx = '', mimetype = ''] = a;
        this.seen.push(`audio ${mimetype}`);
        if (this.audioInput) {
          this.micStreams.set(idx, 0);
          this.send(['ack', idx, 'OK', '0']);
          this.record('other', `client: microphone stream ${idx} (${mimetype}) accepted`);
        } else {
          this.send(['ack', idx, 'Audio input unsupported', '256']);
          this.record('other', `client: microphone stream ${idx} refused`);
        }
        return true;
      }
      case 'blob': {
        const idx = a[0] ?? '';
        const mic = this.micStreams.get(idx);
        if (mic !== undefined) {
          const n = mic + unb64(a[1] ?? '').length;
          this.micStreams.set(idx, n);
          if (Math.floor(n / 100_000) > Math.floor(mic / 100_000)) {
            this.record('other', `microphone: ${n} bytes received`);
          }
          return true;
        }
        const arg = this.argv.get(idx);
        if (arg) {
          arg.data.push(unb64(a[1] ?? ''));
          this.send(['ack', idx, 'OK', '0']);
          return true;
        }
        const up = this.uploads.get(idx);
        if (up) {
          up.bytes += unb64(a[1] ?? '').length;
          this.send(['ack', idx, 'OK (DATA RECEIVED)', '0']);
          return true;
        }
        return false;
      }
      case 'end': {
        const idx = a[0] ?? '';
        if (this.micStreams.has(idx)) {
          this.record(
            'other',
            `microphone stream ${idx} ended (${this.micStreams.get(idx)} bytes)`,
          );
          this.micStreams.delete(idx);
          return true;
        }
        const arg = this.argv.get(idx);
        if (arg) {
          this.argv.delete(idx);
          const all = new Uint8Array(arg.data.reduce((n, d) => n + d.length, 0));
          let o = 0;
          for (const d of arg.data) {
            all.set(d, o);
            o += d.length;
          }
          this.argvValues.set(arg.name, new TextDecoder().decode(all));
          this.argvComplete();
          return true;
        }
        const up = this.uploads.get(idx);
        if (up) {
          this.uploads.delete(idx);
          this.tree.get(up.dir)?.set(up.name, new Uint8Array(up.bytes));
          this.record('file', `upload "${up.name}" to ${up.dir} ended: ${up.bytes} bytes`);
          return true;
        }
        return false;
      }
      case 'ack': {
        const [idx = '', message = '', code = '0'] = a;
        const out = this.outgoing.get(idx);
        if (!out) return false;
        if (Number(code) !== 0) {
          this.outgoing.delete(idx);
          this.record('file', `${out.what}: client aborted (${message}, ${code})`);
          return true;
        }
        const next = out.chunks.shift();
        if (next) {
          if (out.delayMs) {
            setTimeout(() => {
              if (this.outgoing.get(idx) === out) this.send(['blob', idx, b64(next)]);
            }, out.delayMs);
          } else {
            this.send(['blob', idx, b64(next)]);
          }
        } else {
          this.outgoing.delete(idx);
          this.send(['end', idx]);
          this.record('file', `${out.what}: sent completely`);
        }
        return true;
      }
      default:
        return false;
    }
  }

  private onGet(objIdx: string, name: string): void {
    this.seen.push(`get ${objIdx} ${name}`);
    const norm = name === '/' ? '/' : name.replace(/\/+$/, '');
    const dir = this.tree.get(norm);
    const idx = String(this.nextIndex++);
    if (dir) {
      const prefix = norm === '/' ? '/' : norm + '/';
      const listing: Record<string, string> = {};
      for (const [n, v] of dir) {
        listing[prefix + n] = v === null ? INDEX : 'application/octet-stream';
      }
      const json = enc(JSON.stringify(listing));
      const half = Math.ceil(json.length / 2);
      this.outgoing.set(idx, {
        chunks: [json.subarray(0, half), json.subarray(half)],
        what: `listing of ${norm}`,
      });
      this.send(['body', objIdx, idx, INDEX, name]);
      this.record('file', `listing ${norm} on stream ${idx}`);
      return;
    }
    const slash = norm.lastIndexOf('/');
    const parent = slash <= 0 ? '/' : norm.slice(0, slash);
    const file = this.tree.get(parent)?.get(norm.slice(slash + 1));
    if (!file) {
      this.record('file', `get ${name}: not found (no body)`);
      return;
    }
    if (norm.endsWith('blocked.bin')) {
      this.record('file', `get ${name}: downloads disabled (no body sent)`);
      return;
    }
    const chunks: Uint8Array[] = [];
    for (let o = 0; o < file.length; o += BLOB) chunks.push(file.subarray(o, o + BLOB));
    this.outgoing.set(idx, { chunks, what: `download of ${norm}` });
    this.send(['body', objIdx, idx, 'application/octet-stream', name]);
    this.record('file', `download ${norm} on stream ${idx}, waiting for ack`);
  }

  private onUpload(idx: string, name: string, mimetype: string, plain = false): void {
    this.seen.push(`${plain ? 'file' : 'put'} ${idx} ${mimetype} ${name}`);
    const norm = name.replace(/\/{2,}/g, '/');
    const slash = norm.lastIndexOf('/');
    const dir = plain ? '/Download' : slash <= 0 ? '/' : norm.slice(0, slash);
    const file = plain ? name : norm.slice(slash + 1);
    if (dir === '/Read-only' || !this.tree.has(dir)) {
      this.send(['ack', idx, 'FAIL (UPLOAD DISABLED)', '771']);
      this.record('file', `upload "${file}" to ${dir}: refused (0x0303)`);
      return;
    }
    this.uploads.set(idx, { name: file, dir, bytes: 0 });
    this.send(['ack', idx, 'OK (STREAM BEGIN)', '0']);
    this.record('file', `upload "${file}" to ${dir} begins`);
  }
}
