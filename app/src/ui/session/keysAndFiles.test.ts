import { describe, expect, it, vi } from 'vitest';
import { decideIncoming } from './incomingFiles.ts';
import { keyCapLabel, tokenLabel, tokenSpokenLabel } from './keyBarLayout.ts';
import { comboPreview, keySetName, keysFileName } from './keySetNames.ts';
import { parseToken, textToken, savedToken } from '../../session/keys/KeyLayout.ts';
import { LEGACY_SET_ID } from '../../session/keys/KeySets.ts';
import { normalizeSessionSettings } from './settings.ts';
import { onTapRecognised, onTouchDown } from './tapDismiss.ts';
import { DECLINED, TransferManager } from './transfers.ts';
import type { RemoteFilesPolicy } from './settings.ts';

describe('key tokens', () => {
  it.each([
    ['Esc', { kind: 'key', name: 'Esc' }],
    ['Ctrl', { kind: 'modifier', mod: 'Ctrl' }],
    ['Fn', { kind: 'fn' }],
    ['combo:ctrl+c', { kind: 'combo', text: 'Ctrl+C' }],
    ['text:| grep ', { kind: 'text', text: '| grep ' }],
    ['saved:c1', { kind: 'saved', id: 'c1' }],
    ['text:', null],
    ['saved:../x', null],
    ['esc', null],
    ['combo:Ctrl+', null],
  ])('%s', (token, parsed) => {
    expect(parseToken(token)).toEqual(parsed);
  });

  it('builders and labels', () => {
    expect(textToken('~/')).toBe('text:~/');
    expect(textToken('')).toBeNull();
    expect(savedToken('c 1')).toBeNull();
    expect(tokenLabel('text:a very long command here')).toBe('a very long…');
    expect(
      tokenLabel('saved:c1', [{ id: 'c1', name: 'Lock', steps: [{ keys: ['Super', 'L'] }] }]),
    ).toBe('Lock');
    expect(tokenLabel('saved:gone')).toBe('?');
    expect(tokenSpokenLabel('text:ls')).toBe('Type ls');
    expect(keyCapLabel('Super')).toBe('Win');
  });

  it('set names and previews', () => {
    expect(keySetName(undefined, 'builtin:terminal')).toBe('Terminal / Linux');
    expect(keySetName(undefined, LEGACY_SET_ID)).toBe('Custom layout (this connection)');
    expect(keySetName({ id: 'user-x', name: 'Mine', rows: [] })).toBe('Mine');
    expect(
      comboPreview([
        { keys: ['Ctrl', 'K'], delayMs: 200 },
        { keys: ['Ctrl', 'C'], delayMs: 50 },
      ]),
    ).toBe('Ctrl+K, wait 200 ms, Ctrl+C');
    expect(keysFileName(new Date(2026, 10, 20).getTime())).toBe(
      'openmobileguac-keys-2026-11-20.json',
    );
  });
});

describe('tap the desktop to hide the keyboard (three-way)', () => {
  it.each([
    ['off', true, 'pass', 'pass'],
    ['hide-click', true, 'pass', 'hide-and-pass'],
    ['hide-only', true, 'hide-and-swallow', 'pass'],
    ['hide-only', false, 'pass', 'pass'],
    ['hide-click', false, 'pass', 'pass'],
  ] as const)('%s, keyboard up %s', (mode, up, down, tap) => {
    expect(onTouchDown(mode, up)).toBe(down);
    expect(onTapRecognised(mode, up)).toBe(tap);
  });

  it('old boolean settings migrate', () => {
    expect(normalizeSessionSettings({ tapDismissKeyboard: true as never }).tapDismissKeyboard).toBe(
      'hide-click',
    );
    expect(normalizeSessionSettings({}).tapDismissKeyboard).toBe('off');
    expect(normalizeSessionSettings({ remoteFiles: 'bogus' as never }).remoteFiles).toBe('ask');
  });
});

describe('files from the remote: consent', () => {
  it.each([
    ['ask', 'ask'],
    ['accept', 'accept'],
    ['decline', 'decline'],
  ] as const)('%s', (policy, decision) => {
    expect(decideIncoming(policy)).toBe(decision);
  });

  function fakeStream() {
    return {
      index: 3,
      onblob: null as unknown,
      onend: null as unknown,
      sendAck: vi.fn(),
    };
  }

  function setup(policy: RemoteFilesPolicy) {
    // The library's BlobReader expects a browser global.
    vi.stubGlobal('window', globalThis);
    const notify = vi.fn();
    const deliver = vi.fn(async () => ({ ok: true as const, outcome: 'shared' as const }));
    const m = new TransferManager({
      deliver,
      log: () => undefined,
      notify,
      incomingPolicy: () => policy,
    });
    const client = { onfile: null, onfilesystem: null } as unknown as Parameters<
      TransferManager['install']
    >[0];
    m.install(client);
    const push = (mimetype: string, name: string) => {
      const stream = fakeStream();
      (client as unknown as { onfile: (s: unknown, m: string, n: string) => void }).onfile(
        stream,
        mimetype,
        name,
      );
      return stream;
    };
    return { m, push, notify };
  }

  it('ask: nothing is acked until the user answers; Decline sends an error ack', () => {
    const { m, push } = setup('ask');
    const s = push('text/plain', 'report.txt');
    expect(s.sendAck).not.toHaveBeenCalled();
    const prompts = m.getSnapshot().prompts;
    expect(prompts).toEqual([
      { id: 1, filename: 'report.txt', mimetype: 'text/plain', print: false },
    ]);
    m.answerIncoming(1, false);
    expect(s.sendAck).toHaveBeenCalledWith('Declined', DECLINED);
    expect(DECLINED).toBe(0x0303);
    expect(m.getSnapshot().prompts).toEqual([]);
    expect(m.getSnapshot().transfers).toEqual([]);
  });

  it('ask: Accept starts the download (first ack OK)', () => {
    const { m, push } = setup('ask');
    const s = push('application/pdf', 'guacamole-print.pdf');
    expect(m.getSnapshot().prompts[0]?.print).toBe(true);
    m.answerIncoming(1, true);
    expect(s.sendAck).toHaveBeenCalledWith('OK', 0);
    expect(m.getSnapshot().transfers[0]?.kind).toBe('print');
  });

  it('always decline: refused at once, with a toast', () => {
    const { m, push, notify } = setup('decline');
    const s = push('text/plain', 'x.txt');
    expect(s.sendAck).toHaveBeenCalledWith('Declined', DECLINED);
    expect(m.getSnapshot().prompts).toEqual([]);
    expect(notify).toHaveBeenCalled();
  });

  it('always accept: downloads without a prompt', () => {
    const { m, push } = setup('accept');
    const s = push('text/plain', 'x.txt');
    expect(s.sendAck).toHaveBeenCalledWith('OK', 0);
    expect(m.getSnapshot().prompts).toEqual([]);
  });

  it('prompts queue and are dropped when the connection ends', () => {
    const { m, push } = setup('ask');
    push('text/plain', 'a.txt');
    push('text/plain', 'b.txt');
    expect(m.getSnapshot().prompts.map((p) => p.filename)).toEqual(['a.txt', 'b.txt']);
    m.detachClient();
    expect(m.getSnapshot().prompts).toEqual([]);
  });
});
