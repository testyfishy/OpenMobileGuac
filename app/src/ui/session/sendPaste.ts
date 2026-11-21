/**
 * Send (the toolbar / More action that puts this device's clipboard on the remote) and,
 * with the `sendPastes` setting (default on), the remote's paste shortcut right after it, so
 * one tap does both.
 *
 * Pure decisions plus one ordering helper; the session screen supplies the effects.
 */

/**
 * Wait between writing the clipboard stream (its blob(s) and `end`, in tunnel order) and
 * pressing the paste shortcut: the remote side (guacd, then the desktop's clipboard owner)
 * needs a moment to apply the new clipboard before an application asks for it.
 */
export const PASTE_KEY_DELAY_MS = 150;

/** What sent the clipboard. Only the explicit Send action may paste. */
export type ClipboardSendTrigger =
  /** The Send action (toolbar button, More sheet, any gesture bound to it). */
  | 'send-action'
  /** "Send the device clipboard when the session connects". */
  | 'on-connect'
  /** "Send the device clipboard when returning to the session". */
  | 'on-focus'
  /** The clipboard sheet's own Send button (the user picks what to send). */
  | 'clipboard-sheet';

/**
 * The paste shortcut on the remote: Ctrl+V, or Ctrl+Shift+V in guacd's terminal emulator
 * (SSH, telnet, Kubernetes), whose Ctrl+V is a literal control character. A Mac remote
 * would need ⌘V; the app cannot tell, so it is not covered.
 */
export function pasteShortcut(terminal: boolean): string {
  return terminal ? 'Ctrl+Shift+V' : 'Ctrl+V';
}

export interface PasteDecision {
  readonly trigger: ClipboardSendTrigger;
  /** The `sendPastes` setting. */
  readonly sendPastes: boolean;
  /** View only: nothing may reach the remote. */
  readonly viewOnly: boolean;
  readonly connected: boolean;
}

/** Whether the paste shortcut follows this clipboard send. */
export function shouldPasteAfterSend(d: PasteDecision): boolean {
  return d.trigger === 'send-action' && d.sendPastes && !d.viewOnly && d.connected;
}

export interface SendAndPasteDeps {
  /** Writes the whole clipboard stream (blobs, then `end`); false when nothing was sent. */
  readonly sendClipboard: (text: string) => boolean;
  /** Presses and releases the shortcut (the key bar / combo path). */
  readonly pressShortcut: (combo: string) => void;
  /** Checked again when the delay is over (view only, still connected). */
  readonly stillAllowed: () => boolean;
  readonly schedule: (fn: () => void, ms: number) => void;
}

export type SendAndPasteResult = 'not-sent' | 'sent' | 'sent-and-pasting';

/**
 * Sends `text` to the remote clipboard, then, when `paste` is set, presses the paste
 * shortcut `PASTE_KEY_DELAY_MS` after the stream's end has been written (never before, and
 * not at all if the session became view-only or disconnected in between).
 */
export function sendAndPaste(
  text: string,
  paste: boolean,
  terminal: boolean,
  deps: SendAndPasteDeps,
): SendAndPasteResult {
  if (!deps.sendClipboard(text)) return 'not-sent';
  if (!paste) return 'sent';
  const combo = pasteShortcut(terminal);
  deps.schedule(() => {
    if (deps.stillAllowed()) deps.pressShortcut(combo);
  }, PASTE_KEY_DELAY_MS);
  return 'sent-and-pasting';
}
