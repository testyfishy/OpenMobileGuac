import { useEffect, useMemo, useState } from 'react';
import type { DataSourceSchema } from '../../core/api/GuacAdminApi.ts';
import { isGuacApiError } from '../../core/api/errors.ts';
import { EMPTY_PERMISSIONS, type ManagedGroup } from '../../core/models/Admin.ts';
import { ROOT_GROUP_IDENTIFIER } from '../../core/models/Connection.ts';
import { Dialog } from '../components/Dialog.tsx';
import { ErrorBanner, Spinner } from '../components/Feedback.tsx';
import { Segmented, TextField } from '../components/Form.tsx';
import { Icon } from '../components/Icon.tsx';
import { Screen } from '../components/Screen.tsx';
import { useToast } from '../components/toastContext.ts';
import { describeError, type UiError } from '../errors/errorMessages.ts';
import { useBackInterceptor } from '../nav/NavContext.ts';
import { haptic } from '../services/native.ts';
import { useAdmin } from './AdminContext.ts';
import { adminStrings } from './adminStrings.ts';
import { DeleteConfirm } from './DeleteConfirm.tsx';
import { FolderPickerSheet } from './FolderPicker.tsx';
import { folderOptions, folderPath } from './folderTree.ts';
import { buildSections, compact, valuesDiffer, withValue } from './formModel.ts';
import { GROUP_ATTRIBUTES_NS, type TranslationTable } from './labels.ts';
import { canDeleteGroup } from './permissions.ts';
import { SchemaSections } from './SchemaSections.tsx';
import { loadTranslations } from './translations.ts';
import { validateGroup } from './validation.ts';

type GroupType = 'ORGANIZATIONAL' | 'BALANCING';

interface Draft {
  readonly name: string;
  readonly parent: string;
  readonly type: GroupType;
  readonly attributes: Readonly<Record<string, string>>;
}

/** Create or edit a folder (connection group): name, parent, type and attribute forms. */
export function GroupEditor({
  mode,
  dataSource: initialDataSource,
  id,
  parent,
  onClose,
}: {
  mode: 'create' | 'edit';
  dataSource: string | undefined;
  id?: string | undefined;
  parent?: string | undefined;
  onClose: () => void;
}) {
  const admin = useAdmin();
  const toast = useToast();
  const a = adminStrings;
  const f = a.folder;
  const sources = admin?.canCreateIn.group ?? [];
  const [ds, setDs] = useState<string | undefined>(initialDataSource ?? sources[0]);
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; error: UiError }
    | { status: 'ready'; schema: DataSourceSchema; table: TranslationTable | null }
  >({ status: 'loading' });
  const [draft, setDraft] = useState<Draft>({
    name: '',
    parent: parent ?? ROOT_GROUP_IDENTIFIER,
    type: 'ORGANIZATIONAL',
    attributes: {},
  });
  const [original, setOriginal] = useState<Draft | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<UiError | undefined>(undefined);
  const [picking, setPicking] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const session = admin?.session;
  const api = admin?.api;
  useEffect(() => {
    if (!api || !session || !ds) return undefined;
    let live = true;
    void Promise.all([
      api.getSchema(session, ds),
      mode === 'edit' && id ? api.getGroup(session, ds, id) : Promise.resolve(undefined),
      loadTranslations(api, session.baseUrl),
    ]).then(
      ([schema, group, table]) => {
        if (!live) return;
        if (group) {
          const d: Draft = {
            name: group.name,
            parent: group.parentIdentifier,
            type: group.type === 'BALANCING' ? 'BALANCING' : 'ORGANIZATIONAL',
            attributes: group.attributes,
          };
          setDraft(d);
          setOriginal(d);
        }
        setState({ status: 'ready', schema, table });
      },
      (err: unknown) => {
        if (!live) return;
        if (isGuacApiError(err, 'permission-denied')) admin.markDenied(ds);
        setState({ status: 'error', error: describeError(err) });
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, session, ds, mode, id]);

  const attrForms = useMemo(
    () => (state.status === 'ready' ? state.schema.groupAttributes : []),
    [state],
  );
  const sections = useMemo(
    () =>
      buildSections(
        attrForms,
        GROUP_ATTRIBUTES_NS,
        a.serverDefault,
        state.status === 'ready' ? state.table : null,
      ),
    [attrForms, a.serverDefault, state],
  );
  const validation = validateGroup(draft, attrForms);
  const errors = showErrors ? validation.errors : {};
  const dirty =
    original === null
      ? draft.name.trim() !== '' || Object.keys(draft.attributes).length > 0
      : draft.name !== original.name ||
        draft.parent !== original.parent ||
        draft.type !== original.type ||
        valuesDiffer(draft.attributes, original.attributes);

  const requestClose = () => {
    if (saving) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };
  useBackInterceptor(true, requestClose);

  if (!admin || !session || !api) return null;
  const perms = (ds && admin.permissions.get(ds)) || EMPTY_PERMISSIONS;

  const save = async () => {
    if (!ds) return;
    setShowErrors(true);
    setSaveError(undefined);
    if (!validation.ok) {
      haptic('error');
      return;
    }
    const body: ManagedGroup = {
      parentIdentifier: draft.parent,
      name: draft.name.trim(),
      type: draft.type,
      attributes: compact(draft.attributes),
    };
    setSaving(true);
    try {
      if (mode === 'edit' && id) {
        await api.updateGroup(session, ds, id, body);
        toast.show(a.saved(body.name));
      } else {
        await api.createGroup(session, ds, body);
        toast.show(a.created(body.name));
      }
      haptic('success');
      admin.changed();
      onClose();
    } catch (err) {
      haptic('error');
      if (isGuacApiError(err, 'permission-denied')) admin.markDenied(ds);
      setSaveError(describeError(err));
      setSaving(false);
    }
  };

  const path = ds ? folderPath(admin.tree, ds, draft.parent) : [];
  const title = mode === 'edit' ? f.titleEdit(original?.name ?? draft.name) : f.titleNew;

  return (
    <div className="adm-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <Screen
        title={title}
        onBack={requestClose}
        actions={
          state.status === 'ready' ? (
            <button
              type="button"
              className="btn btn-primary adm-header-btn"
              onClick={() => void save()}
              disabled={saving}
            >
              {saving ? a.editor.saving : mode === 'edit' ? a.editor.save : a.editor.create}
            </button>
          ) : null
        }
      >
        {state.status === 'loading' ? <Spinner label={a.loading} /> : null}
        {state.status === 'error' ? <ErrorBanner error={state.error} /> : null}
        {state.status === 'ready' ? (
          <form
            className="form adm-form"
            noValidate
            onSubmit={(ev) => {
              ev.preventDefault();
              void save();
            }}
          >
            {saveError ? <ErrorBanner error={saveError} /> : null}
            <TextField
              label={a.editor.name}
              value={draft.name}
              onChange={(name) => setDraft((d) => ({ ...d, name }))}
              placeholder={f.namePlaceholder}
              autoCapitalize="off"
              autoCorrect="off"
              error={errors['name'] ? a.editor.required : undefined}
            />
            {mode === 'create' && sources.length > 1 ? (
              <div className="field">
                <label className="field-label" htmlFor="adm-gds">
                  {a.editor.dataSource}
                </label>
                <select
                  id="adm-gds"
                  className="field-input"
                  value={ds}
                  onChange={(ev) => {
                    setDs(ev.target.value);
                    setDraft((d) => ({ ...d, parent: ROOT_GROUP_IDENTIFIER }));
                  }}
                >
                  {sources.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="field">
              <span className="field-label" id="adm-gloc-label">
                {a.editor.location}
              </span>
              <button
                type="button"
                className="btn adm-location"
                aria-labelledby="adm-gloc-label adm-gloc-value"
                onClick={() => setPicking(true)}
              >
                <Icon name="folder" />
                <span id="adm-gloc-value">{path.length ? path.join(' › ') : a.topLevel}</span>
                <Icon name="chevron-right" className="adm-location-chevron" />
              </button>
            </div>
            <Segmented<GroupType>
              label={f.type}
              value={draft.type}
              options={[
                { value: 'ORGANIZATIONAL', label: f.organizational },
                { value: 'BALANCING', label: f.balancing },
              ]}
              onChange={(type) => setDraft((d) => ({ ...d, type }))}
            />
            {draft.type === 'BALANCING' ? <p className="field-hint">{f.balancingHint}</p> : null}
            {sections.length > 0 ? (
              <div className="adm-group">
                <h2 className="subsection-title">{a.editor.attributes}</h2>
                <SchemaSections
                  sections={sections}
                  values={draft.attributes}
                  onChange={(n, v) =>
                    setDraft((d) => ({ ...d, attributes: withValue(d.attributes, n, v) }))
                  }
                  errors={errors}
                  errorPrefix="attr:"
                  open={open}
                  onToggle={(key) =>
                    setOpen((s) => {
                      const next = new Set(s);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    })
                  }
                  forceOpen={false}
                  idPrefix="g:"
                />
              </div>
            ) : null}
            <div className="form-actions">
              <button type="submit" className="btn btn-primary btn-block" disabled={saving}>
                {saving ? a.editor.saving : mode === 'edit' ? a.editor.save : a.editor.create}
              </button>
              {mode === 'edit' && id && ds && canDeleteGroup(perms, id) ? (
                <button
                  type="button"
                  className="btn btn-danger-ghost btn-block"
                  onClick={() => setConfirmDelete(true)}
                  disabled={saving}
                >
                  <Icon name="trash" /> {f.deleteFolder}
                </button>
              ) : null}
            </div>
          </form>
        ) : null}
      </Screen>
      {picking && ds ? (
        <FolderPickerSheet
          options={folderOptions(admin.tree, ds, perms, mode === 'edit' ? id : undefined)}
          selected={draft.parent}
          onPick={(p) => setDraft((d) => ({ ...d, parent: p }))}
          onClose={() => setPicking(false)}
        />
      ) : null}
      {confirmDiscard ? (
        <Dialog
          title={a.unsaved.title}
          tone="warning"
          onCancel={() => setConfirmDiscard(false)}
          actions={
            <>
              <button type="button" className="btn" onClick={() => setConfirmDiscard(false)}>
                {a.unsaved.keep}
              </button>
              <button type="button" className="btn btn-warning" onClick={onClose}>
                {a.unsaved.discard}
              </button>
            </>
          }
        >
          <p>{a.unsaved.body}</p>
        </Dialog>
      ) : null}
      {confirmDelete && id && ds ? (
        <DeleteConfirm
          kind="group"
          dataSource={ds}
          id={id}
          name={original?.name ?? draft.name}
          onCancel={() => setConfirmDelete(false)}
          onDeleted={onClose}
        />
      ) : null}
    </div>
  );
}
