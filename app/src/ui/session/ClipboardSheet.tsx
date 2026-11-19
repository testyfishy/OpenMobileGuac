import { useState } from 'react';
import { previewText, type ClipboardHistory } from '../../session/clipboard/ClipboardHistory.ts';
import { ChromeButton } from './ChromeButton.tsx';
import { sessionStrings } from './sessionStrings.ts';
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
  const t = sessionStrings.clipboard;

  return (
    <Sheet title={t.title} onClose={props.onClose}>
      <section className="omg-section" aria-labelledby="omg-clip-remote">
        <h3 id="omg-clip-remote" className="omg-section__title">
          {t.fromRemote}
        </h3>
        {history.lastRemote !== null ? (
          <>
            <pre className="omg-clip-preview" tabIndex={0} aria-label={t.remoteText}>
              {history.lastRemote}
            </pre>
            <div className="omg-sheet__actions">
              <ChromeButton
                className="omg-btn--ghost"
                onClick={() => props.onCopyToDevice(history.lastRemote ?? '')}
              >
                {t.copyToDevice}
              </ChromeButton>
              <ChromeButton
                className="omg-btn--ghost"
                onClick={() => setDraft(history.lastRemote ?? '')}
              >
                {t.editBelow}
              </ChromeButton>
            </div>
          </>
        ) : (
          <p className="omg-muted">{t.nothingYet}</p>
        )}
      </section>

      <section className="omg-section" aria-labelledby="omg-clip-send">
        <h3 id="omg-clip-send" className="omg-section__title">
          {t.sendTitle}
        </h3>
        <label className="omg-visually-hidden" htmlFor="omg-clip-draft">
          {t.draftLabel}
        </label>
        <textarea
          id="omg-clip-draft"
          className="omg-input omg-textarea"
          rows={4}
          value={draft}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={t.placeholder}
          onChange={(e) => {
            setDraft(e.target.value);
            setNote(null);
          }}
        />
        <p className="omg-muted" aria-live="polite">
          {note ?? t.characters(chars)}
        </p>
        <div className="omg-sheet__actions">
          <ChromeButton
            className="omg-btn--primary"
            disabled={draft === ''}
            onClick={() => {
              const ok = props.onSend(draft);
              setNote(
                !ok
                  ? sessionStrings.common.notConnectedSentence
                  : props.terminal
                    ? t.sentTerminal
                    : t.sent,
              );
            }}
          >
            {sessionStrings.common.send}
          </ChromeButton>
          <ChromeButton
            className="omg-btn--ghost"
            disabled={draft === ''}
            onClick={() => {
              props.onType(draft);
              setNote(t.typed);
            }}
          >
            {t.typeAsKeystrokes}
          </ChromeButton>
          <ChromeButton
            className="omg-btn--ghost"
            onClick={() => {
              void props.onReadDevice().then((t) => {
                if (t !== null) setDraft(t);
              });
            }}
          >
            {t.fromDevice}
          </ChromeButton>
          <ChromeButton
            className="omg-btn--ghost"
            disabled={draft === ''}
            onClick={() => setDraft('')}
          >
            {sessionStrings.common.clear}
          </ChromeButton>
        </div>
      </section>

      <section className="omg-section" aria-labelledby="omg-clip-history">
        <h3 id="omg-clip-history" className="omg-section__title">
          {t.historyTitle}
        </h3>
        {history.items.length === 0 ? (
          <p className="omg-muted">{t.historyEmpty}</p>
        ) : (
          <>
            <ul className="omg-list">
              {history.items.map((item) => (
                <li key={item.id}>
                  <ChromeButton
                    className="omg-list__item"
                    onClick={() => setDraft(item.text)}
                    aria-label={
                      item.direction === 'from-remote'
                        ? t.itemFromRemote(previewText(item.text, 60))
                        : t.itemSent(previewText(item.text, 60))
                    }
                  >
                    <span className="omg-list__tag">
                      {item.direction === 'from-remote' ? t.tagRemote : t.tagSent}
                    </span>
                    <span className="omg-list__text">{previewText(item.text)}</span>
                  </ChromeButton>
                </li>
              ))}
            </ul>
            <div className="omg-sheet__actions">
              <ChromeButton className="omg-btn--ghost" onClick={props.onClear}>
                {t.clearHistory}
              </ChromeButton>
            </div>
          </>
        )}
      </section>
    </Sheet>
  );
}
