import { describe, expect, it } from 'vitest';
import { parseCombo } from '../../session/keys/KeyModel.ts';
import { searchSettings } from '../settings/settingsCatalog.ts';
import { setActiveLocale } from '../strings.ts';
import { DEFAULT_SESSION_SETTINGS, normalizeSessionSettings } from './settings.ts';
import {
  PASTE_KEY_DELAY_MS,
  pasteShortcut,
  sendAndPaste,
  shouldPasteAfterSend,
  type ClipboardSendTrigger,
} from './sendPaste.ts';

const ok = { sendPastes: true, viewOnly: false, connected: true };

describe('Send also pastes: the decision', () => {
  it('is on by default and only for the explicit Send action', () => {
    expect(DEFAULT_SESSION_SETTINGS.sendPastes).toBe(true);
    expect(normalizeSessionSettings({ sendPastes: false }).sendPastes).toBe(false);
    expect(shouldPasteAfterSend({ trigger: 'send-action', ...ok })).toBe(true);
    const others: ClipboardSendTrigger[] = ['on-connect', 'on-focus', 'clipboard-sheet'];
    for (const trigger of others)
      expect(shouldPasteAfterSend({ trigger, ...ok }), trigger).toBe(false);
  });

  it('never pastes when off, view-only or not connected', () => {
    expect(shouldPasteAfterSend({ trigger: 'send-action', ...ok, sendPastes: false })).toBe(false);
    expect(shouldPasteAfterSend({ trigger: 'send-action', ...ok, viewOnly: true })).toBe(false);
    expect(shouldPasteAfterSend({ trigger: 'send-action', ...ok, connected: false })).toBe(false);
  });

  it('uses Ctrl+V on desktops and Ctrl+Shift+V in terminals, as real key combos', () => {
    expect(pasteShortcut(false)).toBe('Ctrl+V');
    expect(pasteShortcut(true)).toBe('Ctrl+Shift+V');
    expect(parseCombo(pasteShortcut(false)).ok).toBe(true);
    expect(parseCombo(pasteShortcut(true)).ok).toBe(true);
  });
});

describe('Send also pastes: ordering', () => {
  function harness(sent = true) {
    const log: string[] = [];
    const timers: { fn: () => void; ms: number }[] = [];
    let allowed = true;
    const deps = {
      sendClipboard: (text: string) => {
        // The stream is written in full (blobs, then end) inside this call.
        log.push(`blob:${text}`, 'end');
        return sent;
      },
      pressShortcut: (combo: string) => log.push(`keys:${combo}`),
      stillAllowed: () => allowed,
      schedule: (fn: () => void, ms: number) => timers.push({ fn, ms }),
    };
    return {
      log,
      timers,
      deps,
      block: () => {
        allowed = false;
      },
    };
  }

  it('presses the shortcut only after the stream has ended, after the delay', () => {
    const h = harness();
    expect(sendAndPaste('hello', true, false, h.deps)).toBe('sent-and-pasting');
    expect(h.log).toEqual(['blob:hello', 'end']);
    expect(h.timers.map((t) => t.ms)).toEqual([PASTE_KEY_DELAY_MS]);
    expect(PASTE_KEY_DELAY_MS).toBeGreaterThanOrEqual(100);
    h.timers[0]?.fn();
    expect(h.log).toEqual(['blob:hello', 'end', 'keys:Ctrl+V']);
  });

  it('terminal: Ctrl+Shift+V', () => {
    const h = harness();
    sendAndPaste('ls', true, true, h.deps);
    h.timers[0]?.fn();
    expect(h.log.at(-1)).toBe('keys:Ctrl+Shift+V');
  });

  it('sends only, with the setting off', () => {
    const h = harness();
    expect(sendAndPaste('x', false, false, h.deps)).toBe('sent');
    expect(h.timers).toEqual([]);
    expect(h.log).toEqual(['blob:x', 'end']);
  });

  it('no keys when nothing was sent, or when the session changed during the delay', () => {
    const notSent = harness(false);
    expect(sendAndPaste('x', true, false, notSent.deps)).toBe('not-sent');
    expect(notSent.timers).toEqual([]);
    const changed = harness();
    sendAndPaste('x', true, false, changed.deps);
    changed.block();
    changed.timers[0]?.fn();
    expect(changed.log).toEqual(['blob:x', 'end']);
  });
});

describe('Send also pastes: in Settings', () => {
  const ctx = { values: DEFAULT_SESSION_SETTINGS, biometryLabel: 'Face ID' };
  it.each([
    ['en', 'paste', 'send'],
    ['es', 'pegar', 'enviar'],
  ] as const)('is found by "%s" words and sits in Sessions › Clipboard', (locale, a, b) => {
    try {
      setActiveLocale(locale);
      for (const q of [a, b]) {
        expect(
          searchSettings(q, ctx).map((r) => r.ref),
          q,
        ).toContain('sendPastes');
      }
      expect(searchSettings(a, ctx).find((r) => r.ref === 'sendPastes')?.page).toBe('sessions');
    } finally {
      setActiveLocale('en');
    }
  });
});
