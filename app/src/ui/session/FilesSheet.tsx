import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  breadcrumbs,
  parentStreamName,
  ROOT_STREAM,
} from '../../session/transfer/directoryIndex.ts';
import {
  formatBytes,
  isFinished,
  progressFraction,
  type Transfer,
} from '../../session/transfer/TransferModel.ts';
import { ChromeButton } from './ChromeButton.tsx';
import { IconBack, IconDownload, IconFile, IconFolder, IconPrint, IconUpload } from './icons.tsx';
import { Sheet } from './Sheet.tsx';
import type { TransferManager } from './transfers.ts';

export interface FilesSheetProps {
  readonly transfers: TransferManager;
  readonly connected: boolean;
  /** Start on the transfers list (e.g. from a toast). */
  readonly initialTab?: 'files' | 'transfers';
  readonly onClose: () => void;
}

/** FIL-1: browse a filesystem the session exposes, upload and download, and see transfers. */
export function FilesSheet({ transfers, connected, initialTab, onClose }: FilesSheetProps) {
  const snap = useSyncExternalStore(transfers.subscribe, transfers.getSnapshot);
  const [tab, setTab] = useState<'files' | 'transfers'>(initialTab ?? 'files');
  const [fsId, setFsId] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const fs = snap.filesystems.find((f) => f.id === fsId) ?? snap.filesystems[0] ?? null;
  const running = snap.transfers.filter((t) => !isFinished(t)).length;

  // List the folder the first time a filesystem is shown.
  const listed = useRef(new Set<number>());
  useEffect(() => {
    if (!fs || tab !== 'files' || listed.current.has(fs.id)) return;
    listed.current.add(fs.id);
    transfers.list(fs.id, fs.cwd);
  }, [fs, tab, transfers]);

  const pick = () => fileInput.current?.click();

  return (
    <Sheet title="Files" onClose={onClose} className="omg-sheet--tall">
      <div className="omg-segmented" role="tablist" aria-label="Files view">
        <ChromeButton
          role="tab"
          aria-selected={tab === 'files'}
          className={tab === 'files' ? 'omg-seg omg-seg--on' : 'omg-seg'}
          onClick={() => setTab('files')}
        >
          Remote files
        </ChromeButton>
        <ChromeButton
          role="tab"
          aria-selected={tab === 'transfers'}
          className={tab === 'transfers' ? 'omg-seg omg-seg--on' : 'omg-seg'}
          onClick={() => setTab('transfers')}
        >
          Transfers{running > 0 ? ` (${running})` : ''}
        </ChromeButton>
      </div>

      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const files = e.target.files ? [...e.target.files] : [];
          e.target.value = '';
          if (files.length === 0) return;
          transfers.upload(files, fs ? fs.id : null, fs?.cwd);
          setTab('transfers');
        }}
      />

      {tab === 'files' && (
        <div role="tabpanel" aria-label="Remote files" className="omg-section">
          {!connected && <p className="omg-muted">Not connected.</p>}
          {connected && !fs && (
            <>
              <p className="omg-muted">
                This connection does not expose a file browser. You can still send files: the server
                puts them where the connection is configured to (for RDP, usually the shared drive).
                If file transfer is disabled, the server refuses them.
              </p>
              <div className="omg-sheet__actions">
                <ChromeButton className="omg-btn--primary" onClick={pick}>
                  <IconUpload />
                  Send file to remote
                </ChromeButton>
              </div>
            </>
          )}
          {connected && fs && (
            <>
              {snap.filesystems.length > 1 && (
                <div className="omg-segmented" aria-label="Filesystem">
                  {snap.filesystems.map((f) => (
                    <ChromeButton
                      key={f.id}
                      className={f.id === fs.id ? 'omg-seg omg-seg--on' : 'omg-seg'}
                      aria-pressed={f.id === fs.id}
                      onClick={() => setFsId(f.id)}
                    >
                      {f.name}
                    </ChromeButton>
                  ))}
                </div>
              )}
              <nav className="omg-crumbs" aria-label="Folder path">
                {fs.cwd !== ROOT_STREAM && (
                  <ChromeButton
                    className="omg-btn--icon"
                    aria-label="Up one folder"
                    onClick={() => transfers.list(fs.id, parentStreamName(fs.cwd))}
                  >
                    <IconBack />
                  </ChromeButton>
                )}
                {breadcrumbs(fs.cwd, fs.name).map((c, i, all) => (
                  <ChromeButton
                    key={c.streamName}
                    className="omg-crumb"
                    aria-current={i === all.length - 1 ? 'location' : undefined}
                    onClick={() => transfers.list(fs.id, c.streamName)}
                  >
                    {c.label}
                  </ChromeButton>
                ))}
              </nav>
              <div className="omg-sheet__actions">
                <ChromeButton className="omg-btn--primary" onClick={pick}>
                  <IconUpload />
                  Upload here
                </ChromeButton>
                <ChromeButton className="omg-btn--ghost" onClick={() => transfers.list(fs.id)}>
                  Refresh
                </ChromeButton>
              </div>
              {fs.error && (
                <p className="omg-error" role="alert">
                  {fs.error}
                </p>
              )}
              {fs.loading ? (
                <p className="omg-muted" aria-live="polite">
                  Loading…
                </p>
              ) : fs.entries.length === 0 && !fs.error ? (
                <p className="omg-muted">This folder is empty.</p>
              ) : (
                <ul className="omg-list" aria-label={`Contents of ${fs.cwd}`}>
                  {fs.entries.map((e) => (
                    <li key={e.streamName}>
                      <ChromeButton
                        className="omg-list__item"
                        aria-label={e.isDirectory ? `Open folder ${e.name}` : `Download ${e.name}`}
                        onClick={() => {
                          if (e.isDirectory) transfers.list(fs.id, e.streamName);
                          else {
                            transfers.downloadFromFilesystem(fs.id, e);
                            setTab('transfers');
                          }
                        }}
                      >
                        <span className="omg-list__icon">
                          {e.isDirectory ? <IconFolder /> : <IconFile />}
                        </span>
                        <span className="omg-list__text">{e.name}</span>
                        {!e.isDirectory && (
                          <span className="omg-list__icon" aria-hidden="true">
                            <IconDownload />
                          </span>
                        )}
                      </ChromeButton>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'transfers' && (
        <div role="tabpanel" aria-label="Transfers" className="omg-section">
          {snap.transfers.length === 0 ? (
            <p className="omg-muted">
              No transfers yet. Files the remote sends (including RDP print jobs) appear here.
            </p>
          ) : (
            <ul className="omg-list">
              {[...snap.transfers].reverse().map((t) => (
                <TransferRow key={t.id} t={t} onCancel={() => transfers.cancel(t.id)} />
              ))}
            </ul>
          )}
          <div className="omg-sheet__actions">
            {connected && !fs && (
              <ChromeButton className="omg-btn--ghost" onClick={pick}>
                Send file to remote
              </ChromeButton>
            )}
            {snap.transfers.some(isFinished) && (
              <ChromeButton className="omg-btn--ghost" onClick={() => transfers.clearFinished()}>
                Clear finished
              </ChromeButton>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}

function TransferRow({ t, onCancel }: { t: Transfer; onCancel: () => void }) {
  const frac = progressFraction(t);
  const label = t.kind === 'print' ? 'Print job' : t.direction === 'upload' ? 'Upload' : 'Download';
  let status: string;
  switch (t.state) {
    case 'waiting':
      status = 'Waiting for the server…';
      break;
    case 'active':
      status =
        t.size !== null
          ? `${formatBytes(t.bytes)} of ${formatBytes(t.size)}`
          : `${formatBytes(t.bytes)} received`;
      break;
    case 'done':
      status = `Done · ${formatBytes(t.bytes)}${t.outcome ? ` · ${t.outcome}` : ''}`;
      break;
    case 'cancelled':
      status = 'Cancelled';
      break;
    case 'error':
      status = t.error ?? 'Failed';
      break;
  }
  return (
    <li className="omg-transfer" data-state={t.state}>
      <span className="omg-list__icon" aria-hidden="true">
        {t.kind === 'print' ? (
          <IconPrint />
        ) : t.direction === 'upload' ? (
          <IconUpload />
        ) : (
          <IconDownload />
        )}
      </span>
      <span className="omg-transfer__body">
        <span className="omg-transfer__name">
          {label}: {t.name}
        </span>
        {t.destination && t.direction === 'upload' && (
          <span className="omg-choice__hint">To {t.destination}</span>
        )}
        <span
          className={
            t.state === 'error' ? 'omg-transfer__status omg-error' : 'omg-transfer__status'
          }
          role={t.state === 'error' ? 'alert' : undefined}
        >
          {status}
        </span>
        {(t.state === 'active' || t.state === 'waiting') && (
          <span
            className="omg-progress"
            role="progressbar"
            aria-label={`${label} progress`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={frac === null ? undefined : Math.round(frac * 100)}
            data-indeterminate={frac === null ? 'true' : undefined}
          >
            <span style={{ width: frac === null ? '30%' : `${Math.round(frac * 100)}%` }} />
          </span>
        )}
      </span>
      {!isFinished(t) && (
        <ChromeButton className="omg-btn--ghost omg-btn--small" onClick={onCancel}>
          Cancel
        </ChromeButton>
      )}
    </li>
  );
}
