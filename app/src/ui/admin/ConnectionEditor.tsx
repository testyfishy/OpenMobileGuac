import { useEffect, useMemo, useState } from 'react';
import type { DataSourceSchema } from '../../core/api/GuacAdminApi.ts';
import { isGuacApiError } from '../../core/api/errors.ts';
import { EMPTY_PERMISSIONS, type ManagedConnection } from '../../core/models/Admin.ts';
import { ROOT_GROUP_IDENTIFIER } from '../../core/models/Connection.ts';
import { Dialog } from '../components/Dialog.tsx';
import { ErrorBanner, InfoBanner, Spinner } from '../components/Feedback.tsx';
import { TextField } from '../components/Form.tsx';
import { Icon } from '../components/Icon.tsx';
import { Screen } from '../components/Screen.tsx';
import { useToast } from '../components/toastContext.ts';
import { describeError, type UiError } from '../errors/errorMessages.ts';
import { useBackInterceptor } from '../nav/NavContext.ts';
import { haptic } from '../services/native.ts';
import { useAdmin } from './AdminContext.ts';
import { adminStrings } from './adminStrings.ts';
import { AdvancedParameters } from './AdvancedParameters.tsx';
import { DeleteConfirm } from './DeleteConfirm.tsx';
import { FolderPickerSheet } from './FolderPicker.tsx';
import { folderOptions, folderPath, findGroup } from './folderTree.ts';
import {
  buildSections,
  compact,
  filterSections,
  isSet,
  schemaFieldNames,
  unknownParameters,
  valuesDiffer,
  withValue,
} from './formModel.ts';
import {
  CONNECTION_ATTRIBUTES_NS,
  protocolName,
  protocolNamespace,
  type TranslationTable,
} from './labels.ts';
import { canDeleteConnection } from './permissions.ts';
import { PerformanceSection } from './PerformanceSection.tsx';
import { applyChanges, hasPresets } from './presets.ts';
import { SchemaSections } from './SchemaSections.tsx';
import { SettingsSearch } from './SettingsSearch.tsx';
import { loadTranslations } from './translations.ts';
import { cloneName, validateConnection } from './validation.ts';

interface Draft {
  readonly name: string;
  readonly parent: string;
  readonly protocol: string;
  /** Secret-bearing: kept in component state only, never logged or stored. */
  readonly parameters: Readonly<Record<string, string>>;
  readonly attributes: Readonly<Record<string, string>>;
}

const EMPTY_DRAFT: Draft = {
  name: '',
  parent: ROOT_GROUP_IDENTIFIER,
  protocol: '',
  parameters: {},
  attributes: {},
};

type Loaded =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: UiError }
  | {
      readonly status: 'ready';
      readonly schema: DataSourceSchema;
      readonly table: TranslationTable | null;
    };

/**
 * Create, edit or clone a connection. The forms are rendered from the server's schema for
 * the chosen protocol (docs/protocol-notes.md §8.4), with the performance presets on top for
 * RDP and VNC, a search box, the attribute forms, and free-form "Advanced" parameters.
 */
export function ConnectionEditor({
  mode,
  dataSource: initialDataSource,
  id,
  parent,
  onClose,
}: {
  mode: 'create' | 'edit' | 'clone';
  dataSource: string | undefined;
  id?: string | undefined;
  parent?: string | undefined;
  onClose: () => void;
}) {
  const admin = useAdmin();
  const toast = useToast();
  const a = adminStrings;
  const e = a.editor;
  const sources = admin?.canCreateIn.connection ?? [];
  const [ds, setDs] = useState<string | undefined>(initialDataSource ?? sources[0]);
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [draft, setDraft] = useState<Draft>({
    ...EMPTY_DRAFT,
    parent: parent ?? ROOT_GROUP_IDENTIFIER,
  });
  const [original, setOriginal] = useState<Draft | null>(null);
  const [copiedSecrets, setCopiedSecrets] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set(['p:network', 'p:authentication']),
  );
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<UiError | undefined>(undefined);
  const [picking, setPicking] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** Bumped on a failed save: focus moves to the first invalid field once it is rendered. */
  const [focusError, setFocusError] = useState(0);
  useEffect(() => {
    if (focusError > 0)
      document.querySelector<HTMLElement>('.adm-overlay [aria-invalid="true"]')?.focus();
  }, [focusError]);

  const session = admin?.session;
  const api = admin?.api;
  useEffect(() => {
    if (!api || !session || !ds) return undefined;
    let live = true;
    void Promise.all([
      api.getSchema(session, ds),
      mode !== 'create' && id ? api.getConnection(session, ds, id) : Promise.resolve(undefined),
      loadTranslations(api, session.baseUrl),
    ]).then(
      ([schema, conn, table]) => {
        if (!live) return;
        if (conn) {
          const loadedDraft: Draft = {
            name: conn.name,
            parent: conn.parentIdentifier,
            protocol: conn.protocol,
            parameters: conn.parameters,
            attributes: conn.attributes,
          };
          if (mode === 'clone') {
            const siblings = findGroup(admin.tree, ds, conn.parentIdentifier);
            setDraft({
              ...loadedDraft,
              name: cloneName(
                conn.name,
                e.copyOf,
                siblings?.childConnections.map((c) => c.name) ?? [],
              ),
            });
            const forms = schema.protocols[conn.protocol]?.connectionForms ?? [];
            const secretNames = forms
              .flatMap((f) => f.fields)
              .filter((f) => f.type === 'PASSWORD' && isSet(conn.parameters[f.name]))
              .map((f) => f.name);
            setCopiedSecrets(secretNames);
          } else {
            setDraft(loadedDraft);
            setOriginal(loadedDraft);
          }
        }
        setLoaded({ status: 'ready', schema, table });
      },
      (err: unknown) => {
        if (!live) return;
        if (isGuacApiError(err, 'permission-denied')) admin.markDenied(ds);
        setLoaded({ status: 'error', error: describeError(err) });
      },
    );
    return () => {
      live = false;
    };
    // Load once per data source; `admin` changes identity on every tree refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, session, ds, mode, id]);

  const schema = loaded.status === 'ready' ? loaded.schema : undefined;
  const table = loaded.status === 'ready' ? loaded.table : null;
  const protocolSchema = schema?.protocols[draft.protocol];
  const paramForms = useMemo(() => protocolSchema?.connectionForms ?? [], [protocolSchema]);
  const attrForms = useMemo(() => schema?.connectionAttributes ?? [], [schema]);
  const sections = useMemo(
    () => buildSections(paramForms, protocolNamespace(draft.protocol), a.serverDefault, table),
    [paramForms, draft.protocol, a.serverDefault, table],
  );
  const attrSections = useMemo(
    () => buildSections(attrForms, CONNECTION_ATTRIBUTES_NS, a.serverDefault, table),
    [attrForms, a.serverDefault, table],
  );
  const known = useMemo(() => schemaFieldNames(paramForms), [paramForms]);
  const shownSections = filterSections(sections, query);
  const shownAttrSections = filterSections(attrSections, query);
  const searching = query.trim().length > 0;
  const validation = validateConnection(draft, paramForms, attrForms);
  const errors = showErrors ? validation.errors : {};
  const extra = unknownParameters(paramForms, draft.parameters);

  const dirty =
    mode === 'clone' ||
    (original === null
      ? draft.name.trim() !== '' ||
        draft.protocol !== '' ||
        Object.keys(draft.parameters).length > 0
      : draft.name !== original.name ||
        draft.parent !== original.parent ||
        draft.protocol !== original.protocol ||
        valuesDiffer(draft.parameters, original.parameters) ||
        valuesDiffer(draft.attributes, original.attributes));

  const requestClose = () => {
    if (saving) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };
  useBackInterceptor(true, requestClose);

  if (!admin || !session || !api) return null;
  const perms = (ds && admin.permissions.get(ds)) || EMPTY_PERMISSIONS;
  const protocols = schema
    ? Object.keys(schema.protocols).sort((x, y) =>
        protocolName(x, table).localeCompare(protocolName(y, table)),
      )
    : [];

  const setParam = (name: string, value: string) =>
    setDraft((d) => ({ ...d, parameters: withValue(d.parameters, name, value) }));
  const setAttr = (name: string, value: string) =>
    setDraft((d) => ({ ...d, attributes: withValue(d.attributes, name, value) }));
  const toggle = (key: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const title =
    mode === 'edit'
      ? e.titleEdit(original?.name ?? draft.name)
      : mode === 'clone'
        ? e.titleClone
        : e.titleNew;

  const save = async () => {
    if (!ds) return;
    setShowErrors(true);
    setSaveError(undefined);
    if (!validation.ok) {
      // Open every section with a problem, then move focus to the first one.
      setOpen((s) => {
        const next = new Set(s);
        for (const sec of sections)
          if (sec.fields.some((f) => validation.errors[`param:${f.name}`])) next.add(`p:${sec.id}`);
        for (const sec of attrSections)
          if (sec.fields.some((f) => validation.errors[`attr:${f.name}`])) next.add(`a:${sec.id}`);
        return next;
      });
      haptic('error');
      setFocusError((n) => n + 1);
      return;
    }
    const body: ManagedConnection = {
      parentIdentifier: draft.parent,
      name: draft.name.trim(),
      protocol: draft.protocol,
      parameters: compact(draft.parameters),
      attributes: compact(draft.attributes),
    };
    setSaving(true);
    try {
      if (mode === 'edit' && id) {
        await api.updateConnection(session, ds, id, body);
        toast.show(a.saved(body.name));
      } else {
        await api.createConnection(session, ds, body);
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
      document.querySelector('.adm-overlay .screen-body')?.scrollTo({ top: 0 });
    }
  };

  const parentLabel = (() => {
    if (!ds) return a.topLevel;
    const path = folderPath(admin.tree, ds, draft.parent);
    return path.length ? path.join(' › ') : a.topLevel;
  })();

  return (
    <div className="adm-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <Screen
        title={title}
        onBack={requestClose}
        actions={
          loaded.status === 'ready' ? (
            <button
              type="button"
              className="btn btn-primary adm-header-btn"
              onClick={() => void save()}
              disabled={saving}
            >
              {saving ? e.saving : mode === 'edit' ? e.save : e.create}
            </button>
          ) : null
        }
      >
        {loaded.status === 'loading' ? <Spinner label={a.loading} /> : null}
        {loaded.status === 'error' ? (
          <ErrorBanner
            error={{ ...loaded.error, title: `${e.loadFailed}: ${loaded.error.title}` }}
          />
        ) : null}
        {loaded.status === 'ready' ? (
          <form
            className="form adm-form"
            noValidate
            onSubmit={(ev) => {
              ev.preventDefault();
              void save();
            }}
          >
            {saveError ? <ErrorBanner error={saveError} /> : null}
            {showErrors && !validation.ok ? (
              <p className="field-error" role="alert">
                {e.fixErrors}
              </p>
            ) : null}
            {mode === 'clone' ? (
              <InfoBanner>
                <p>{e.cloneNotice}</p>
                <p>
                  {copiedSecrets.length > 0
                    ? e.clonePasswords(
                        copiedSecrets
                          .map(
                            (n) =>
                              sections.flatMap((sec) => sec.fields).find((f) => f.name === n)
                                ?.label ?? n,
                          )
                          .join(', '),
                      )
                    : e.cloneNoPasswords}
                </p>
              </InfoBanner>
            ) : null}

            <fieldset className="adm-basics">
              <legend className="subsection-title">{e.basics}</legend>
              <TextField
                label={e.name}
                value={draft.name}
                onChange={(name) => setDraft((d) => ({ ...d, name }))}
                placeholder={e.namePlaceholder}
                autoCapitalize="off"
                autoCorrect="off"
                error={errors['name'] ? e.required : undefined}
              />
              {mode === 'create' && sources.length > 1 ? (
                <div className="field">
                  <label className="field-label" htmlFor="adm-ds">
                    {e.dataSource}
                  </label>
                  <select
                    id="adm-ds"
                    className="field-input"
                    value={ds}
                    onChange={(ev) => {
                      setLoaded({ status: 'loading' });
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
                <span className="field-label" id="adm-loc-label">
                  {e.location}
                </span>
                <button
                  type="button"
                  className="btn adm-location"
                  aria-labelledby="adm-loc-label adm-loc-value"
                  onClick={() => setPicking(true)}
                >
                  <Icon name="folder" />
                  <span id="adm-loc-value">{parentLabel}</span>
                  <Icon name="chevron-right" className="adm-location-chevron" />
                </button>
              </div>
              <div className={errors['protocol'] ? 'field field-invalid' : 'field'}>
                <label className="field-label" htmlFor="adm-protocol">
                  {e.protocol}
                </label>
                <select
                  id="adm-protocol"
                  className="field-input"
                  value={draft.protocol}
                  aria-invalid={errors['protocol'] ? true : undefined}
                  onChange={(ev) => setDraft((d) => ({ ...d, protocol: ev.target.value }))}
                >
                  <option value="">{e.protocolPick}</option>
                  {protocols.map((p) => (
                    <option key={p} value={p}>
                      {protocolName(p, table)}
                    </option>
                  ))}
                  {draft.protocol && !protocols.includes(draft.protocol) ? (
                    <option value={draft.protocol}>{draft.protocol}</option>
                  ) : null}
                </select>
                {errors['protocol'] ? (
                  <p className="field-error" role="alert">
                    {e.required}
                  </p>
                ) : null}
              </div>
            </fieldset>

            {!draft.protocol ? <p className="muted">{e.pickProtocolFirst}</p> : null}
            {draft.protocol && !protocolSchema ? (
              <InfoBanner tone="warning">{e.unknownProtocol(draft.protocol)}</InfoBanner>
            ) : null}

            {hasPresets(draft.protocol) && protocolSchema && !searching ? (
              <PerformanceSection
                protocol={draft.protocol}
                sections={sections}
                values={draft.parameters}
                known={known}
                onChange={setParam}
                onApply={(changes, preset) => {
                  setDraft((d) => ({ ...d, parameters: applyChanges(d.parameters, changes) }));
                  toast.show(a.perf.applied(a.perf.presets[preset]));
                }}
              />
            ) : null}

            {draft.protocol ? (
              <div className="adm-search">
                <SettingsSearch value={query} onChange={setQuery} />
              </div>
            ) : null}
            {searching && shownSections.length === 0 && shownAttrSections.length === 0 ? (
              <p className="muted">{e.noMatches(query.trim())}</p>
            ) : null}

            {shownSections.length > 0 ? (
              <div className="adm-group">
                <h2 className="subsection-title">{e.parameters}</h2>
                <SchemaSections
                  sections={shownSections}
                  values={draft.parameters}
                  onChange={setParam}
                  errors={errors}
                  errorPrefix="param:"
                  open={open}
                  onToggle={toggle}
                  forceOpen={searching}
                  idPrefix="p:"
                />
              </div>
            ) : null}

            {shownAttrSections.length > 0 ? (
              <div className="adm-group">
                <h2 className="subsection-title">{e.attributes}</h2>
                <SchemaSections
                  sections={shownAttrSections}
                  values={draft.attributes}
                  onChange={setAttr}
                  errors={errors}
                  errorPrefix="attr:"
                  open={open}
                  onToggle={toggle}
                  forceOpen={searching}
                  idPrefix="a:"
                />
              </div>
            ) : null}

            {draft.protocol && !searching ? (
              <AdvancedParameters
                names={extra}
                values={draft.parameters}
                known={known}
                onChange={setParam}
              />
            ) : null}

            <p className="muted adm-privacy">{a.noPasswordStorage}</p>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary btn-block" disabled={saving}>
                {saving ? e.saving : mode === 'edit' ? e.save : e.create}
              </button>
              {mode === 'edit' && id && ds && canDeleteConnection(perms, id) ? (
                <button
                  type="button"
                  className="btn btn-danger-ghost btn-block"
                  onClick={() => setConfirmDelete(true)}
                  disabled={saving}
                >
                  <Icon name="trash" /> {e.deleteConnection}
                </button>
              ) : null}
            </div>
          </form>
        ) : null}
      </Screen>
      {picking && ds ? (
        <FolderPickerSheet
          options={folderOptions(admin.tree, ds, perms)}
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
          kind="connection"
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
