import { useId, useState } from 'react';
import { ChromeButton } from './ChromeButton.tsx';
import { IconClose } from './icons.tsx';

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
        Text to type on the remote
      </label>
      <input
        id={id}
        className="omg-input omg-textbar__input"
        value={text}
        placeholder="Type, dictate or paste, then Send"
        autoComplete="off"
        enterKeyHint="send"
        onChange={(e) => setText(e.target.value)}
      />
      <ChromeButton className="omg-btn--primary" disabled={text === ''} onClick={() => send(false)}>
        Send
      </ChromeButton>
      <ChromeButton
        className="omg-btn--ghost"
        aria-label="Send and press Enter"
        onClick={() => send(true)}
      >
        ⏎
      </ChromeButton>
      <ChromeButton
        className="omg-btn--icon"
        aria-label="Close the text input bar"
        onClick={onClose}
      >
        <IconClose />
      </ChromeButton>
    </form>
  );
}
