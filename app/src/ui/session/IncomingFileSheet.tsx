import { ChromeButton } from './ChromeButton.tsx';
import { IconFile, IconPrint } from './icons.tsx';
import { sessionStrings } from './sessionStrings.ts';
import { Sheet } from './Sheet.tsx';
import type { IncomingPrompt } from './transfers.ts';

/**
 * FIL-1 consent: the remote pushed a file (or an RDP print job). Shows only what the server
 * told us, the file name and type, with Accept / Decline. Must be answered (no backdrop
 * dismiss); Escape and the close button decline.
 */
export function IncomingFileSheet({
  prompt,
  waiting,
  onAnswer,
}: {
  prompt: IncomingPrompt;
  /** Further prompts queued behind this one. */
  waiting: number;
  onAnswer: (accept: boolean) => void;
}) {
  const f = sessionStrings.files;
  return (
    <Sheet
      title={prompt.print ? f.incomingPrintTitle : f.incomingTitle}
      onClose={() => onAnswer(false)}
      dismissible={false}
      closeLabel={f.decline}
      className="omg-sheet--prompt"
    >
      <div className="omg-incoming" data-incoming-id={prompt.id}>
        <span className="omg-incoming__icon" aria-hidden="true">
          {prompt.print ? <IconPrint /> : <IconFile />}
        </span>
        <div>
          <p>
            {prompt.print ? f.incomingPrintBody(prompt.filename) : f.incomingBody(prompt.filename)}
          </p>
          <p className="omg-muted">
            {prompt.mimetype ? f.incomingType(prompt.mimetype) : f.unknownType}
          </p>
          {waiting > 0 && <p className="omg-muted">{f.moreWaiting(waiting)}</p>}
        </div>
      </div>
      <div className="omg-sheet__actions">
        <ChromeButton className="omg-btn--ghost" onClick={() => onAnswer(false)}>
          {f.decline}
        </ChromeButton>
        <ChromeButton className="omg-btn--primary" onClick={() => onAnswer(true)}>
          {f.accept}
        </ChromeButton>
      </div>
    </Sheet>
  );
}
