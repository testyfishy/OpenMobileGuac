import { useState } from 'react';
import { previewText, type ClipboardHistory } from '../../session/clipboard/ClipboardHistory.ts';
import { ChromeButton } from './ChromeButton.tsx';
import { Sheet } from './Sheet.tsx';

export interface ClipboardSheetProps {
  readonly history: ClipboardHistory;
  /** Terminal protocols: the user pastes with Ctrl+Shift+V or a right-click. */
  readonly terminal: boolean;
  /** Send to the remote clipboard; false when not connected. */
  readonly onSend: (text: string) => boolean;
  readonly onType: (text: string) => void;
  readonly onCopyToDevice: (text: string) => void;
  readonly onReadDevice: () => Promise<string | null>;
  readonly onClear: () => void;
  readonly onClose: () => void;
}

/**
 * CLP-5: the text last received from the remote, an editable box to send to the remote,
 * and this session's recent clipboard texts (memory only).
 */
export function ClipboardSheet(props: ClipboardSheetProps) {
  const { history } = props;
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const chars = [...draft].length;

  return (
    <Sheet title="Clipboard" onClose={props.onClose}>
      <section className="omg-section" aria-labelledby="omg-clip-remote">
        <h3 id="omg-clip-remote" className="omg-section__title">
          From the remote
        </h3>
        {history.lastRemote !== null ? (
          <>
            <pre className="omg-clip-preview" tabIndex={0} aria-label="Text copied on the remote">
              {history.lastRemote}
            </pre>
            <div className="omg-sheet__actions">
              <ChromeButton
                className="omg-btn--ghost"
                onClick={() => props.onCopyToDevice(history.lastRemote ?? '')}
              >
                Copy to device
              </ChromeButton>
              <ChromeButton
                className="omg-btn--ghost"
                onClick={() => setDraft(history.lastRemote ?? '')}
              >
                Edit below
              </ChromeButton>
            </div>
          </>
        ) : (
          <p className="omg-muted">
            Nothing copied on the remote yet in this session. If copying there never shows up here,
            the connection may have copying disabled.
          </p>
        )}
      </section>

      <section className="omg-section" aria-labelledby="omg-clip-send">
        <h3 id="omg-clip-send" className="omg-section__title">
          Send to the remote
        </h3>
        <label className="omg-visually-hidden" htmlFor="omg-clip-draft">
          Text to send to the remote
        </label>
        <textarea
          id="omg-clip-draft"
          className="omg-input omg-textarea"
          rows={4}
          value={draft}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Type or paste text here"
          onChange={(e) => {
            setDraft(e.target.value);
            setNote(null);
          }}
        />
        <p className="omg-muted" aria-live="polite">
          {note ?? `${chars} character${chars === 1 ? '' : 's'}`}
        </p>
        <div className="omg-sheet__actions">
          <ChromeButton
            className="omg-btn--primary"
            disabled={draft === ''}
            onClick={() => {
              const ok = props.onSend(draft);
              setNote(
                !ok
                  ? 'Not connected.'
                  : props.terminal
                    ? 'Sent. Paste in the terminal with Ctrl+Shift+V or a right-click.'
                    : 'Sent. Paste on the remote (Ctrl+V). If nothing arrives, the server may block pasting: use Type instead.',
              );
            }}
          >
            Send
          </ChromeButton>
          <ChromeButton
            className="omg-btn--ghost"
            disabled={draft === ''}
            onClick={() => {
              props.onType(draft);
              setNote('Typed as keystrokes.');
            }}
          >
            Type as keystrokes
          </ChromeButton>
          <ChromeButton
            className="omg-btn--ghost"
            onClick={() => {
              void props.onReadDevice().then((t) => {
                if (t !== null) setDraft(t);
              });
            }}
          >
            From device
          </ChromeButton>
          <ChromeButton
            className="omg-btn--ghost"
            disabled={draft === ''}
            onClick={() => setDraft('')}
          >
            Clear
          </ChromeButton>
        </div>
      </section>

      <section className="omg-section" aria-labelledby="omg-clip-history">
        <h3 id="omg-clip-history" className="omg-section__title">
          This session
        </h3>
        {history.items.length === 0 ? (
          <p className="omg-muted">No clipboard text yet. Kept in memory only, never saved.</p>
        ) : (
          <>
            <ul className="omg-list">
              {history.items.map((item) => (
                <li key={item.id}>
                  <ChromeButton
                    className="omg-list__item"
                    onClick={() => setDraft(item.text)}
                    aria-label={`${item.direction === 'from-remote' ? 'From remote' : 'Sent'}: ${previewText(item.text, 60)}. Put in the box`}
                  >
                    <span className="omg-list__tag">
                      {item.direction === 'from-remote' ? 'Remote' : 'Sent'}
                    </span>
                    <span className="omg-list__text">{previewText(item.text)}</span>
                  </ChromeButton>
                </li>
              ))}
            </ul>
            <div className="omg-sheet__actions">
              <ChromeButton className="omg-btn--ghost" onClick={props.onClear}>
                Clear history
              </ChromeButton>
            </div>
          </>
        )}
      </section>
    </Sheet>
  );
}
