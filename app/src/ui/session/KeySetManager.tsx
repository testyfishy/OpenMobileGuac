import { useEffect, useId, useRef, useState } from 'react';
import {
  BUILTIN_KEY_SETS,
  LEGACY_SET_ID,
  MAX_KEY_SETS,
  TERMINAL_PROTOCOLS,
  exportKeys,
  findSet,
  isBuiltInSet,
  mergeImportedKeys,
  parseKeysFile,
  reduceKeyLibrary,
  switchableSets,
  type KeyLibrary,
  type KeyLibraryAction,
  type KeySet,
} from '../../session/keys/KeySets.ts';
import { ChromeButton } from './ChromeButton.tsx';
import { IconArrow, IconTrash } from './icons.tsx';
import { KeyBarEditor } from './KeyBarEditor.tsx';
import { keySetName, keySetNameIn, keysFileName } from './keySetNames.ts';
import { sessionStrings } from './sessionStrings.ts';
import { Sheet } from './Sheet.tsx';
import { SheetBackContext } from './sheetBack.ts';

function keyCount(set: KeySet): number {
  return set.rows.reduce((n, r) => n + r.length, 0);
}

/** Saves a text file (share sheet / download); the host provides it, else a browser download. */
export type SaveTextFile = (fileName: string, text: string) => Promise<boolean>;

function browserDownload(fileName: string, text: string): Promise<boolean> {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return Promise.resolve(true);
  } catch {
    return Promise.resolve(false);
  }
}

export interface KeySetManagerProps {
  readonly library: KeyLibrary;
  readonly onLibrary: (next: KeyLibrary) => void;
  /** The set in use (in a session: this connection's; in Settings: the app default). */
  readonly activeId: string;
  readonly onUse: (id: string) => void;
  /** This connection's pre-key-sets layout, shown as a set that can be duplicated. */
  readonly legacy?: KeySet | undefined;
  /** Open the saved combos editor. */
  readonly onCombos?: () => void;
  readonly saveFile?: SaveTextFile;
  /** Show the per-protocol defaults (Settings). */
  readonly showProtocolDefaults?: boolean;
  readonly onClose: () => void;
}

type View =
  | { kind: 'list' }
  | { kind: 'edit'; id: string }
  | { kind: 'create'; from: string }
  | { kind: 'rename'; id: string }
  | { kind: 'delete'; id: string };

/**
 * KEY-9: the user's key sets (use, edit, rename, duplicate, reorder, delete), the built-in
 * templates (use, duplicate, show or hide in the switcher), per-protocol defaults, and
 * import / export as JSON.
 */
export function KeySetManager(p: KeySetManagerProps) {
  const k = sessionStrings.keySets;
  const [view, setView] = useState<View>({ kind: 'list' });
  const [name, setName] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const nameId = useId();
  const fromId = useId();
  const lib = p.library;
  const formRef = useRef<HTMLDivElement>(null);
  // The create / rename / delete form is at the top of the sheet: bring it into view.
  useEffect(() => {
    if (view.kind === 'create' || view.kind === 'rename' || view.kind === 'delete') {
      formRef.current?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [view.kind]);

  const act = (a: KeyLibraryAction) => {
    const r = reduceKeyLibrary(lib, a);
    if (r.refused === 'limit') setMessage({ ok: false, text: k.limit(MAX_KEY_SETS) });
    else if (r.refused === 'read-only') setMessage({ ok: false, text: k.readOnly });
    else p.onLibrary(r.library);
    return r;
  };

  const templates: KeySet[] = [...(p.legacy ? [p.legacy] : []), ...BUILTIN_KEY_SETS, ...lib.sets];
  const setById = (id: string) => (id === LEGACY_SET_ID ? p.legacy : findSet(lib, id));

  if (view.kind === 'edit') {
    const set = lib.sets.find((s) => s.id === view.id);
    if (set) {
      const toList = () => setView({ kind: 'list' });
      // Back returns one level, to the key set list (edits are already saved).
      return (
        <SheetBackContext.Provider value={toList}>
          <KeyBarEditor
            title={k.editTitle(set.name)}
            rows={set.rows}
            combos={lib.combos}
            onChange={(rows) => act({ type: 'set-rows', id: set.id, rows })}
            onClose={toList}
          />
        </SheetBackContext.Provider>
      );
    }
  }

  const startCreate = (from: string) => {
    const src = setById(from);
    setName(src ? k.copyName(keySetName(src)) : '');
    setView({ kind: 'create', from });
  };

  const exportAll = async () => {
    const file = exportKeys(lib);
    const nameOut = keysFileName(Date.now());
    const ok = await (p.saveFile ?? browserDownload)(nameOut, JSON.stringify(file, null, 2));
    setMessage(ok ? { ok: true, text: k.exported(nameOut) } : { ok: false, text: k.exportFailed });
  };

  const importFile = async (f: File | undefined) => {
    if (!f) return;
    let text: string;
    try {
      text = await f.text();
    } catch {
      setMessage({ ok: false, text: k.importErrors['read'] ?? '' });
      return;
    }
    const r = parseKeysFile(text);
    if (!r.ok) {
      setMessage({ ok: false, text: k.importErrors[r.error] ?? '' });
      return;
    }
    const m = mergeImportedKeys(lib, r);
    p.onLibrary(m.library);
    setMessage({ ok: true, text: k.imported(m.addedSets, m.addedCombos) });
    if (fileRef.current) fileRef.current.value = '';
  };

  const row = (set: KeySet, user: boolean, index: number) => {
    const active = set.id === p.activeId;
    const label = keySetName(set);
    const hidden = lib.hiddenBuiltIns.includes(set.id);
    return (
      <li key={set.id} className="omg-combo-list__item omg-kset" data-set-id={set.id}>
        <ChromeButton
          className={
            active
              ? 'omg-btn--ghost omg-kset__use omg-kset__use--on'
              : 'omg-btn--ghost omg-kset__use'
          }
          aria-pressed={active}
          aria-label={k.use(label)}
          onClick={() => p.onUse(set.id)}
        >
          <span>{label}</span>
          <span className="omg-muted">
            {' '}
            {active ? `${k.inUse} · ` : ''}
            {k.keyCount(keyCount(set))}
            {hidden ? ` · ${k.hidden}` : ''}
          </span>
        </ChromeButton>
        <span className="omg-kset__actions">
          {user && (
            <>
              <ChromeButton
                className="omg-btn--ghost omg-btn--small"
                aria-label={k.edit(label)}
                onClick={() => setView({ kind: 'edit', id: set.id })}
              >
                {sessionStrings.options.edit}
              </ChromeButton>
              <ChromeButton
                className="omg-btn--ghost omg-btn--small"
                aria-label={k.rename(label)}
                onClick={() => {
                  setName(set.name);
                  setView({ kind: 'rename', id: set.id });
                }}
              >
                {k.renameButton}
              </ChromeButton>
            </>
          )}
          <ChromeButton
            className="omg-btn--ghost omg-btn--small"
            aria-label={k.duplicate(label)}
            onClick={() => startCreate(set.id)}
          >
            {k.duplicateButton}
          </ChromeButton>
          {user ? (
            <>
              <ChromeButton
                className="omg-btn--icon"
                aria-label={k.moveUp(label)}
                disabled={index === 0}
                onClick={() => act({ type: 'move', id: set.id, delta: -1 })}
              >
                <IconArrow dir="up" />
              </ChromeButton>
              <ChromeButton
                className="omg-btn--icon"
                aria-label={k.moveDown(label)}
                disabled={index === lib.sets.length - 1}
                onClick={() => act({ type: 'move', id: set.id, delta: 1 })}
              >
                <IconArrow dir="down" />
              </ChromeButton>
              <ChromeButton
                className="omg-btn--icon omg-btn--danger"
                aria-label={k.remove(label)}
                onClick={() => setView({ kind: 'delete', id: set.id })}
              >
                <IconTrash />
              </ChromeButton>
            </>
          ) : isBuiltInSet(set.id) ? (
            <label className="omg-label omg-label--row omg-kset__show">
              <input
                type="checkbox"
                checked={!hidden}
                aria-label={k.showInSwitcher(label)}
                onChange={(e) =>
                  act({ type: 'hide-builtin', id: set.id, hidden: !e.target.checked })
                }
              />
            </label>
          ) : null}
        </span>
      </li>
    );
  };

  return (
    <Sheet title={k.title} onClose={p.onClose} className="omg-sheet--tall">
      <p className="omg-muted">{k.intro}</p>
      {message && (
        <p className={message.ok ? 'omg-muted' : 'omg-error'} role="status">
          {message.text}
        </p>
      )}

      <div ref={formRef} />
      {view.kind === 'create' && (
        <form
          className="omg-combo-form omg-kset-form"
          onSubmit={(e) => {
            e.preventDefault();
            const from = view.from === '' ? undefined : setById(view.from);
            const r = act({ type: 'create', name, ...(from ? { from } : {}) });
            if (r.createdId) setView({ kind: 'edit', id: r.createdId });
          }}
        >
          <label htmlFor={fromId} className="omg-label">
            {k.startFrom}
          </label>
          <select
            id={fromId}
            className="omg-input"
            value={view.from}
            onChange={(e) => startCreate(e.target.value)}
          >
            <option value="">{k.emptySet}</option>
            {templates.map((s) => (
              <option key={s.id} value={s.id}>
                {keySetName(s)}
              </option>
            ))}
          </select>
          <label htmlFor={nameId} className="omg-label">
            {k.nameLabel}
          </label>
          <div className="omg-combo-form__row">
            <input
              id={nameId}
              className="omg-input"
              value={name}
              autoComplete="off"
              onChange={(e) => setName(e.target.value)}
            />
            <button type="submit" className="omg-btn omg-btn--primary">
              {k.create}
            </button>
          </div>
          <ChromeButton className="omg-btn--ghost" onClick={() => setView({ kind: 'list' })}>
            {sessionStrings.common.cancel}
          </ChromeButton>
        </form>
      )}

      {view.kind === 'rename' && (
        <form
          className="omg-combo-form omg-kset-form"
          onSubmit={(e) => {
            e.preventDefault();
            act({ type: 'rename', id: view.id, name });
            setView({ kind: 'list' });
          }}
        >
          <label htmlFor={nameId} className="omg-label">
            {k.renameTitle}
          </label>
          <div className="omg-combo-form__row">
            <input
              id={nameId}
              className="omg-input"
              value={name}
              autoComplete="off"
              onChange={(e) => setName(e.target.value)}
            />
            <button type="submit" className="omg-btn omg-btn--primary">
              {k.save}
            </button>
          </div>
        </form>
      )}

      {view.kind === 'delete' && (
        <div className="omg-kset-form" role="alertdialog" aria-label={k.deleteTitle}>
          <p>
            <strong>{k.deleteTitle}</strong>
          </p>
          <p className="omg-muted">{k.deleteBody(keySetNameIn(lib, view.id))}</p>
          <div className="omg-sheet__actions">
            <ChromeButton className="omg-btn--ghost" onClick={() => setView({ kind: 'list' })}>
              {sessionStrings.common.cancel}
            </ChromeButton>
            <ChromeButton
              className="omg-btn--danger"
              onClick={() => {
                act({ type: 'delete', id: view.id });
                if (p.activeId === view.id) p.onUse(BUILTIN_KEY_SETS[0]?.id ?? '');
                setView({ kind: 'list' });
              }}
            >
              {k.deleteButton}
            </ChromeButton>
          </div>
        </div>
      )}

      <h3 className="omg-label">{k.yours}</h3>
      {lib.sets.length === 0 && <p className="omg-muted">{k.noneYet}</p>}
      <ol className="omg-combo-list">{lib.sets.map((s, i) => row(s, true, i))}</ol>
      {p.legacy && <ul className="omg-combo-list">{row(p.legacy, false, 0)}</ul>}
      <div className="omg-sheet__actions">
        <ChromeButton className="omg-btn--primary" onClick={() => startCreate('')}>
          {k.newSet}
        </ChromeButton>
        {p.onCombos && (
          <ChromeButton className="omg-btn--ghost" onClick={p.onCombos}>
            {k.combos}
          </ChromeButton>
        )}
      </div>

      <h3 className="omg-label">{k.builtIns}</h3>
      <ul className="omg-combo-list">{BUILTIN_KEY_SETS.map((s, i) => row(s, false, i))}</ul>

      {p.showProtocolDefaults && (
        <>
          <h3 className="omg-label">{k.protocolTitle}</h3>
          <p className="omg-muted">{k.protocolHint}</p>
          {['rdp', 'vnc', ...TERMINAL_PROTOCOLS].map((proto) => (
            <div key={proto} className="omg-combo-form__row omg-kset-proto">
              <label className="omg-label" htmlFor={`${nameId}-${proto}`}>
                {proto.toUpperCase()}
              </label>
              <select
                id={`${nameId}-${proto}`}
                className="omg-input"
                value={lib.protocolDefaults[proto] ?? ''}
                onChange={(e) =>
                  act({ type: 'protocol-default', protocol: proto, id: e.target.value || null })
                }
              >
                <option value="">{k.protocolNone}</option>
                {switchableSets({ ...lib, hiddenBuiltIns: [] }).map((s) => (
                  <option key={s.id} value={s.id}>
                    {keySetName(s)}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </>
      )}

      <h3 className="omg-label">{k.shareTitle}</h3>
      <div className="omg-sheet__actions">
        <ChromeButton
          className="omg-btn--ghost"
          disabled={lib.sets.length === 0 && lib.combos.length === 0}
          onClick={() => void exportAll()}
        >
          {k.export}
        </ChromeButton>
        <label className="omg-btn omg-btn--ghost omg-file-btn">
          {k.import}
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="omg-visually-hidden"
            onChange={(e) => void importFile(e.target.files?.[0])}
          />
        </label>
      </div>
      <div className="omg-sheet__actions">
        <ChromeButton className="omg-btn--primary" onClick={p.onClose}>
          {sessionStrings.common.done}
        </ChromeButton>
      </div>
    </Sheet>
  );
}

/** In-session quick switcher: tap a set to use it; "Manage" opens the full manager. */
export function KeySetPicker({
  sets,
  activeId,
  onUse,
  onManage,
  onClose,
}: {
  sets: readonly KeySet[];
  activeId: string;
  onUse: (id: string) => void;
  onManage: () => void;
  onClose: () => void;
}) {
  const k = sessionStrings.keySets;
  return (
    <Sheet title={k.pickerTitle} onClose={onClose}>
      <div className="omg-combo-grid">
        {sets.map((s) => (
          <ChromeButton
            key={s.id}
            className={s.id === activeId ? 'omg-combo omg-combo--on' : 'omg-combo'}
            aria-pressed={s.id === activeId}
            onClick={() => {
              onUse(s.id);
              onClose();
            }}
          >
            {keySetName(s)}
          </ChromeButton>
        ))}
      </div>
      <div className="omg-sheet__actions">
        <ChromeButton className="omg-btn--ghost" onClick={onManage}>
          {k.title}…
        </ChromeButton>
      </div>
    </Sheet>
  );
}
