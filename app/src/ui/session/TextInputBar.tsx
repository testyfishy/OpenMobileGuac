import { useId, useState } from 'react';
import { ChromeButton } from './ChromeButton.tsx';
import { IconClose } from './icons.tsx';
import { sessionStrings } from './sessionStrings.ts';

export interface TextInputBarProps {
  /** Type the text on the remote. */
  readonly onSend: (text: string, enter: boolean) => void;
  readonly onClose: () => void;
}

/**
 * KEY-2 fallback, like the web client's text-input mode: a normal visible field. Whatever
 * the keyboard app does inside it (autocorrect, dictation, paste, IME) stays local; only
 * the final text is typed on the remote when the user presses Send (or ⏎ = Send + Enter).
 */
export function TextInputBar({ onSend, onClose }: TextInputBarProps) {
  const [text, setText] = useState('');
  const id = useId();
  const t = sessionStrings.textBar;
  const send = (enter: boolean) => {
    if (text === '' && !enter) return;
    onSend(text, enter);
    setText('');
  };
  return (
    <form
      className="omg-textbar"
      onSubmit={(e) => {
        e.preventDefault();
        send(true);
      }}
    >
      <label htmlFor={id} className="omg-visually-hidden">
        {t.label}
      </label>
      <input
        id={id}
        className="omg-input omg-textbar__input"
        value={text}
        placeholder={t.placeholder}
        autoComplete="off"
        enterKeyHint="send"
        onChange={(e) => setText(e.target.value)}
      />
      <ChromeButton className="omg-btn--primary" disabled={text === ''} onClick={() => send(false)}>
        {sessionStrings.common.send}
      </ChromeButton>
      <ChromeButton className="omg-btn--ghost" aria-label={t.sendEnter} onClick={() => send(true)}>
        ⏎
      </ChromeButton>
      <ChromeButton className="omg-btn--icon" aria-label={t.close} onClick={onClose}>
        <IconClose />
      </ChromeButton>
    </form>
  );
}
