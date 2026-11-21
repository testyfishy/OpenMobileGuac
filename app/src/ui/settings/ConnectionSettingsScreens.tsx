import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConnectionRef } from '../../core/storage/ProfileStore.ts';
import { Dialog } from '../components/Dialog.tsx';
import { EmptyState } from '../components/Feedback.tsx';
import { Icon } from '../components/Icon.tsx';
import { Screen } from '../components/Screen.tsx';
import { protocolIcon, protocolLabel } from '../connections/treeView.ts';
import { DEMO_PROFILE_ID } from '../integration/demoProfile.ts';
import { useBackInterceptor, useNav } from '../nav/NavContext.ts';
import { topRoute, type LayerTarget } from '../nav/navigation.ts';
import { useAppSettings, useServices } from '../services/context.ts';
import { saveTextFile } from '../services/native.ts';
import { useSessions } from '../sessions/SessionsContext.ts';
import { keySetNameIn } from '../session/keySetNames.ts';
import type { ListEditor, SettingKey } from '../session/settingsSchema.ts';
import { strings } from '../strings.ts';
import {
  LAYER_PAGES,
  allEntries,
  displayName,
  effectiveValues,
  entriesOverridingPage,
  inheritedValues,
  ownKeys,
  ownPatch,
  summaryLine,
  type ConnectionEntry,
  type ServerGroup,
} from './connectionLayers.ts';
import {
  affectsConnection,
  newOrigin,
  publishSettingsChange,
  subscribeSettingsChanges,
} from './connectionSettingsBus.ts';
import { SessionListEditor } from './SessionListEditors.tsx';
import { SettingsPageBody } from './SettingsPageBody.tsx';
import {
  SETTINGS_PAGES,
  categoryOf,
  sessionKeysOf,
  type SettingsPageId,
} from './settingsCatalog.ts';
import {
  applyConnectionPatch,
  parseServerOptions,
  removeConnectionKeys,
  serverOptionsToJson,
  type SessionSettingsPatch,
} from './settingsModel.ts';
import { useConnectionInventory } from './useConnectionInventory.ts';
import './settingsPages.css';

function asPage(page: string | undefined): SettingsPageId | undefined {
  return (SETTINGS_PAGES as readonly string[]).includes(page ?? '')
    ? (page as SettingsPageId)
    : undefined;
}

function connectionTarget(e: ConnectionEntry): LayerTarget {
  return {
    kind: 'connection',
    serverId: e.serverId,
    ref: e.ref,
    ...(e.name !== undefined ? { name: e.name } : {}),
    ...(e.protocol !== undefined ? { protocol: e.protocol } : {}),
  };
}

/**
 * Settings › Connections: every connection known on this device, grouped by server, each
 * with a one-line summary of what it changes; tapping one opens its own settings. With
 * `page`, only the connections with their own values on that Settings page.
 */
export function ConnectionSettingsListScreen({ page: rawPage }: { page?: string }) {
  const nav = useNav();
  const { settings } = useAppSettings();
  const groups = useConnectionInventory();
  const t = strings.settings.perConnection;
  const page = asPage(rawPage);
  const ctx = { keySetName: (id: string) => keySetNameIn(settings.keys, id) };
  const shown: ServerGroup[] = (groups ?? [])
    .map((g) => (page ? { ...g, entries: entriesOverridingPage(g.entries, page) } : g))
    .filter((g) => g.entries.length > 0 || (!page && g.hasServerDefaults));
  const total = allEntries(groups ?? []).length;
  return (
    <Screen title={t.title} onBack={nav.back}>
      <div className="form settings settings-page" data-page="connections">
        <p className="muted">{t.intro}</p>
        {page ? (
          <p className="per-connection-filter">
            <span>{t.filtered(categoryOf(page).title())}</span>
            <button
              type="button"
              className="btn btn-small btn-ghost"
              data-action="show-all"
              onClick={() => nav.replace({ name: 'connection-settings' })}
            >
              {t.showAll}
            </button>
          </p>
        ) : null}
        {groups !== undefined && shown.length === 0 ? (
          <EmptyState icon="server" title={page && total > 0 ? t.emptyFiltered : t.empty} />
        ) : null}
        {shown.map((g) => (
          <section
            key={g.serverId}
            className="settings-group per-connection-server"
            aria-labelledby={`pc-${g.serverId}`}
            data-server={g.serverId}
          >
            <h2 id={`pc-${g.serverId}`} className="section-title">
              {g.serverName}
              {g.serverDetail ? (
                <span className="per-connection-host"> · {g.serverDetail}</span>
              ) : null}
            </h2>
            <ul className="settings-cats">
              {!page && g.hasServerDefaults ? (
                <li>
                  <button
                    type="button"
                    className="row-main settings-cat"
                    data-server-defaults={g.serverId}
                    onClick={() =>
                      nav.push({
                        name: 'layer-settings',
                        target: { kind: 'server', serverId: g.serverId, name: g.serverName },
                      })
                    }
                  >
                    <span className="row-icon">
                      <Icon name="server" />
                    </span>
                    <span className="row-text">
                      <span className="row-title">{t.serverDefaults}</span>
                      <span className="row-subtitle">
                        {summaryLine(g.serverOwn, g.appInherited, ctx)}
                      </span>
                    </span>
                    <Icon name="chevron-right" className="row-chevron" />
                  </button>
                </li>
              ) : null}
              {g.entries.map((e) => (
                <li key={`${e.ref.type}/${e.ref.dataSource}/${e.ref.identifier}`}>
                  <button
                    type="button"
                    className="row-main settings-cat"
                    data-connection={e.ref.identifier}
                    data-own={ownKeys(e.own).length}
                    onClick={() =>
                      nav.push({ name: 'layer-settings', target: connectionTarget(e) })
                    }
                  >
                    <span className="row-icon">
                      <Icon name={protocolIcon(e.protocol ?? '')} />
                    </span>
                    <span className="row-text">
                      <span className="row-title">
                        {displayName(e)}
                        {e.favourite ? <Icon name="star-filled" className="row-fav" /> : null}
                      </span>
                      <span className="row-subtitle">
                        {[
                          e.protocol ? protocolLabel(e.protocol) : '',
                          summaryLine(e.own, e.inherited, ctx),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <Icon name="chevron-right" className="row-chevron" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Screen>
  );
}

function refOfTarget(t: LayerTarget): ConnectionRef | undefined {
  return t.kind === 'connection'
    ? { dataSource: t.ref.dataSource, identifier: t.ref.identifier, type: t.ref.type }
    : undefined;
}

/**
 * One connection's own session settings (or, for `kind: 'server'`, one server's defaults):
 * the same pages as the app defaults, each control showing the effective value, marked as
 * its own or inherited ("Default: Direct touch"), with "Use default" and "Reset all".
 * Writes go to the per-connection storage (the server's options) and reach an open session
 * of that connection at once (`connectionSettingsBus`).
 */
export function LayerSettingsScreen({ target }: { target: LayerTarget }) {
  const nav = useNav();
  const services = useServices();
  const sessions = useSessions();
  const { settings: app, update: updateApp } = useAppSettings();
  const appRef = useRef(app);
  useEffect(() => {
    appRef.current = app;
  });
  const t = strings.settings.perConnection;
  const origin = useMemo(() => newOrigin('layer-editor'), []);
  const { serverId } = target;
  const ref = useMemo(
    () => refOfTarget(target),
    // The route object is stable for one stack entry; its fields identify the target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [target.kind, serverId, target.kind === 'connection' ? target.ref.identifier : ''],
  );
  const [own, setOwn] = useState<SessionSettingsPatch | undefined>(undefined);
  const [serverLayer, setServerLayer] = useState<SessionSettingsPatch>({});
  const [name, setName] = useState<string | undefined>(target.name);
  const [protocol, setProtocol] = useState<string | undefined>(
    target.kind === 'connection' ? target.protocol : undefined,
  );
  const [page, setPage] = useState<SettingsPageId | null>(null);
  const [listEditor, setListEditor] = useState<ListEditor | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [reloads, setReloads] = useState(0);

  // Load (and re-load when a session or another screen changes these settings).
  useEffect(() => {
    let live = true;
    const p = services.profiles;
    void Promise.all([
      ref
        ? p.getConnectionSettings(serverId, ref).catch(() => undefined)
        : Promise.resolve(undefined),
      p.getOptions(serverId).catch(() => undefined),
    ]).then(([stored, options]) => {
      if (!live) return;
      const server = parseServerOptions(options).sessionDefaults;
      if (ref) {
        setOwn(applyConnectionPatch(stored, {}));
        setServerLayer(server);
      } else {
        setOwn(server);
      }
    });
    return () => {
      live = false;
    };
  }, [services.profiles, serverId, ref, reloads]);

  useEffect(
    () =>
      subscribeSettingsChanges(origin, (c) => {
        const mine = ref
          ? affectsConnection(c, serverId, ref)
          : c.serverId === serverId && c.refKey === undefined;
        if (mine) setReloads((n) => n + 1);
      }),
    [origin, ref, serverId],
  );

  // A name the route did not carry: from the recents (or the server list).
  useEffect(() => {
    if (name !== undefined) return undefined;
    let live = true;
    void (async () => {
      if (ref) {
        const r = (await services.profiles.listRecents(serverId).catch(() => [])).find(
          (x) =>
            x.ref.type === ref.type &&
            x.ref.dataSource === ref.dataSource &&
            x.ref.identifier === ref.identifier,
        );
        if (live && r) {
          if (r.name !== undefined) setName(r.name);
          if (r.protocol !== undefined) setProtocol(r.protocol);
        }
      } else {
        const profile = await services.profiles.get(serverId).catch(() => undefined);
        const n =
          profile?.name ??
          (serverId === DEMO_PROFILE_ID
            ? strings.servers.demoName
            : services.devServer?.profile.id === serverId
              ? services.devServer.profile.name
              : undefined);
        if (live && n !== undefined) setName(n);
      }
    })();
    return () => {
      live = false;
    };
  }, [name, ref, serverId, services.profiles, services.devServer]);

  // Writes in order, each on top of what is stored now (an open session may have written).
  const queue = useRef<Promise<void>>(Promise.resolve());
  const mutate = useCallback(
    (fn: (cur: SessionSettingsPatch) => SessionSettingsPatch) => {
      setOwn((prev) => fn(prev ?? {}));
      const p = services.profiles;
      queue.current = queue.current.then(async () => {
        try {
          if (ref) {
            const next = fn(applyConnectionPatch(await p.getConnectionSettings(serverId, ref), {}));
            await p.setConnectionSettings(
              serverId,
              ref,
              Object.keys(next).length > 0 ? (next as Record<string, never>) : undefined,
            );
          } else {
            const o = parseServerOptions(await p.getOptions(serverId));
            await p.setOptions(
              serverId,
              serverOptionsToJson({ ...o, sessionDefaults: fn(o.sessionDefaults) }),
            );
          }
          publishSettingsChange(serverId, ref, origin);
        } catch {
          setReloads((n) => n + 1);
        }
      });
    },
    [services.profiles, serverId, ref, origin],
  );

  const onChange = useCallback(
    (patch: SessionSettingsPatch) => mutate((cur) => applyConnectionPatch(cur, patch)),
    [mutate],
  );
  const onUseDefault = useCallback(
    (keys: readonly SettingKey[]) => mutate((cur) => removeConnectionKeys(cur, keys)),
    [mutate],
  );

  const inherited = useMemo(
    () => inheritedValues(app.sessionDefaults, ref ? serverLayer : undefined),
    [app.sessionDefaults, serverLayer, ref],
  );
  const mineOnly = useMemo(() => ownPatch(own ?? {}), [own]);
  const values = useMemo(() => effectiveValues(inherited, mineOnly), [inherited, mineOnly]);
  const ownSet = useMemo(() => new Set<string>(ownKeys(mineOnly)), [mineOnly]);
  const keySetName = (id: string) => keySetNameIn(app.keys, id);

  // Back: a page returns to this editor's list; the editor (opened from a session) to it.
  const isTop = topRoute(nav.state).name === 'layer-settings';
  const sessionId = target.kind === 'connection' ? target.sessionId : undefined;
  const sessionOpen =
    sessionId !== undefined && sessions.state.sessions.some((s) => s.id === sessionId);
  const closePage = () => setPage(null);
  useBackInterceptor(page !== null && isTop, closePage);
  const backToSession = () => {
    if (sessionId === undefined) return;
    nav.pop();
    sessions.show(sessionId);
  };
  useBackInterceptor(page === null && isTop && sessionOpen, backToSession);

  const kindServer = target.kind === 'server';
  const title =
    name && name.trim() !== ''
      ? name
      : ref
        ? displayName({ name: undefined, ref })
        : t.serverDefaults;
  const layer = { kind: target.kind, own: ownSet, inherited, onUseDefault };

  const dialogs = (
    <>
      {listEditor ? (
        <SessionListEditor
          editor={listEditor}
          values={values}
          onChange={onChange}
          keys={{
            library: app.keys,
            onLibrary: (keys) => {
              const next = { ...appRef.current, keys };
              appRef.current = next;
              updateApp(next);
            },
            saveFile: saveTextFile,
          }}
          onClose={() => setListEditor(null)}
        />
      ) : null}
      {confirmReset ? (
        <Dialog
          title={t.resetConfirmTitle(title)}
          tone="danger"
          onCancel={() => setConfirmReset(false)}
          actions={
            <>
              <button type="button" className="btn" onClick={() => setConfirmReset(false)}>
                {strings.common.cancel}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                data-action="confirm-reset-layer"
                onClick={() => {
                  setConfirmReset(false);
                  mutate(() => ({}));
                }}
              >
                {t.reset}
              </button>
            </>
          }
        >
          <p>{t.resetConfirmBody}</p>
        </Dialog>
      ) : null}
    </>
  );

  if (page) {
    const c = categoryOf(page);
    return (
      <Screen key={`layer-page-${page}`} title={`${title} › ${c.title()}`} onBack={closePage}>
        <SettingsPageBody
          page={page}
          values={values}
          changed={ownSet}
          onChange={onChange}
          onEditList={setListEditor}
          summaryContext={{ keySetName }}
          renderApp={() => null}
          onResetKeys={onUseDefault}
          layer={layer}
          intro={<p className="muted">{kindServer ? t.serverEditorIntro : t.editorIntro}</p>}
        />
        {dialogs}
      </Screen>
    );
  }

  return (
    <Screen key="layer-top" title={title} onBack={nav.back} className="layer-settings">
      <div className="form settings settings-page" data-layer-kind={target.kind}>
        {protocol ? <p className="row-subtitle">{protocolLabel(protocol)}</p> : null}
        <p className="muted">{kindServer ? t.serverEditorIntro : t.editorIntro}</p>
        {sessionOpen ? (
          <button
            type="button"
            className="btn btn-block"
            data-action="back-to-session"
            onClick={backToSession}
          >
            <Icon name="play" /> {t.backToSession}
          </button>
        ) : null}
        {own === undefined ? null : (
          <>
            <ul className="settings-cats">
              {LAYER_PAGES.map((id) => {
                const c = categoryOf(id);
                const n = sessionKeysOf(id).filter((k) => ownSet.has(k)).length;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      className="row-main settings-cat"
                      data-category={id}
                      data-own={n}
                      onClick={() => setPage(id)}
                    >
                      <span className="row-icon">
                        <Icon name={c.icon} />
                      </span>
                      <span className="row-text">
                        <span className="row-title">{c.title()}</span>
                        <span className="row-subtitle">{t.ownCount(n)}</span>
                      </span>
                      <Icon name="chevron-right" className="row-chevron" />
                    </button>
                  </li>
                );
              })}
            </ul>
            <section className="settings-group settings-danger" data-group="danger">
              <h2 className="section-title">{strings.settings.pages.danger}</h2>
              <div className="list-setting" data-action="reset-layer">
                <span className="toggle-label">
                  <span>{kindServer ? t.resetAllServer : t.resetAll}</span>
                  <span className="toggle-hint">
                    {ownSet.size > 0 ? t.ownCount(ownSet.size) : t.resetAllHint}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn btn-small btn-danger-ghost"
                  disabled={ownSet.size === 0}
                  onClick={() => setConfirmReset(true)}
                >
                  {t.reset}
                </button>
              </div>
            </section>
          </>
        )}
      </div>
      {dialogs}
    </Screen>
  );
}
