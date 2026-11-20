import { useEffect, useState } from 'react';
import { ChromeButton } from './ChromeButton.tsx';
import { sessionStrings } from './sessionStrings.ts';
import { Sheet } from './Sheet.tsx';

/** What the host offers for "Share this session" (Guacamole sharing profiles, 1.6.0). */
export interface SessionSharing {
  /** Sharing profiles of the connection behind this tunnel. */
  readonly listProfiles: (tunnelUuid: string) => Promise<{ identifier: string; name: string }[]>;
  /** A share link (`<base>/#/?key=…`) for one profile. */
  readonly createLink: (tunnelUuid: string, profileId: string) => Promise<string>;
  /** Hand the link to the share sheet (or copy it). */
  readonly share: (link: string) => Promise<'shared' | 'copied' | 'failed'>;
  readonly copy: (link: string) => Promise<boolean>;
  /** The server uses plain http: the link and the shared session are not encrypted. */
  readonly insecure: boolean;
}

type State =
  | { readonly kind: 'loading' }
  | { readonly kind: 'none' }
  | { readonly kind: 'error' }
  | { readonly kind: 'profiles'; readonly list: { identifier: string; name: string }[] };

/**
 * "Share this session": lists the connection's sharing profiles the user may use, creates a
 * share key for one and shows the link to copy or share. Anyone with the link joins this
 * session with that profile's permissions until the session ends.
 */
export function ShareSheet({
  sharing,
  tunnelUuid,
  onClose,
}: {
  sharing: SessionSharing;
  tunnelUuid: string | null;
  onClose: () => void;
}) {
  const t = sessionStrings.share;
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!tunnelUuid) return;
    let live = true;
    sharing.listProfiles(tunnelUuid).then(
      (list) => {
        if (live) setState(list.length > 0 ? { kind: 'profiles', list } : { kind: 'none' });
      },
      () => {
        if (live) setState({ kind: 'error' });
      },
    );
    return () => {
      live = false;
    };
  }, [sharing, tunnelUuid]);

  const create = async (profileId: string) => {
    if (!tunnelUuid) return;
    setBusy(true);
    setNote(null);
    try {
      setLink(await sharing.createLink(tunnelUuid, profileId));
    } catch {
      setNote(t.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={t.title} onClose={onClose}>
      <p className="omg-muted">{t.intro}</p>
      {sharing.insecure && <p className="omg-muted">{t.insecure}</p>}
      {!tunnelUuid ? (
        <p>{t.notConnected}</p>
      ) : state.kind === 'loading' ? (
        <p>{t.loading}</p>
      ) : state.kind === 'none' ? (
        <p>{t.none}</p>
      ) : state.kind === 'error' ? (
        <p>{t.failed}</p>
      ) : link ? (
        <div className="omg-field">
          <label className="omg-label" htmlFor="omg-share-link">
            {t.link}
          </label>
          <input id="omg-share-link" className="omg-input" readOnly value={link} />
          <div className="omg-combo-form__row">
            <ChromeButton
              className="omg-btn--primary"
              onClick={() =>
                void sharing.share(link).then((r) => {
                  if (r === 'copied') setNote(t.copied);
                  else if (r === 'failed') setNote(t.failed);
                })
              }
            >
              {t.shareLink}
            </ChromeButton>
            <ChromeButton
              className="omg-btn--ghost"
              onClick={() =>
                void sharing.copy(link).then((ok) => setNote(ok ? t.copied : t.failed))
              }
            >
              {t.copy}
            </ChromeButton>
          </div>
        </div>
      ) : (
        <div className="omg-group__rows" role="list">
          {state.list.map((p) => (
            <ChromeButton
              key={p.identifier}
              className="omg-row"
              role="listitem"
              disabled={busy}
              onClick={() => void create(p.identifier)}
            >
              <span className="omg-row__text">
                <span className="omg-row__label">{p.name}</span>
                <span className="omg-row__hint">{t.createFor}</span>
              </span>
            </ChromeButton>
          ))}
        </div>
      )}
      {note && (
        <p className="omg-muted" role="status">
          {note}
        </p>
      )}
    </Sheet>
  );
}
