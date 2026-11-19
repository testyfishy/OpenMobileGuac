import { useState } from 'react';
import type { ServerProfile } from '../../core/models/ServerProfile.ts';
import { EmptyState } from '../components/Feedback.tsx';
import { Icon } from '../components/Icon.tsx';
import { IconButton, Screen } from '../components/Screen.tsx';
import { useNav } from '../nav/NavContext.ts';
import { selectedServerId } from '../nav/navigation.ts';
import { useServices } from '../services/context.ts';
import { strings } from '../strings.ts';
import { useSessions } from '../sessions/SessionsContext.ts';
import { QuickConnect } from './QuickConnect.tsx';
import { hostOf, isInsecureUrl } from './serverForm.ts';
import { ShareLinkDialog } from './ShareLinkDialog.tsx';
import { DEMO_SERVER_ID, useSavedProfiles, useShareProfiles } from './useServers.ts';

/**
 * Server list (SRV-1): Demo, the dev server (dev builds), share-link sessions opened in this
 * run (CON-6, memory only), then saved servers in user order.
 */
export function ServersScreen() {
  const nav = useNav();
  const services = useServices();
  const { profiles, reload } = useSavedProfiles();
  const shares = useShareProfiles();
  const sessions = useSessions();
  const [reordering, setReordering] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const selected = selectedServerId(nav.state);
  const s = strings.servers;

  const move = async (p: ServerProfile, delta: number) => {
    if (!profiles) return;
    const index = profiles.findIndex((x) => x.id === p.id);
    await services.profiles.move(p.id, index + delta);
    reload();
  };

  const openServer = (id: string) => nav.open({ name: 'connections', serverId: id });
  const canReorder = (profiles?.length ?? 0) >= 2;

  return (
    <Screen
      title={s.title}
      focusTitle={false}
      className="servers-screen"
      actions={
        <>
          {canReorder ? (
            <IconButton
              icon={reordering ? 'close' : 'up'}
              label={reordering ? strings.common.done : s.reorder}
              pressed={reordering}
              onClick={() => setReordering((r) => !r)}
            />
          ) : null}
          <IconButton icon="link" label={s.openShareLink} onClick={() => setShareOpen(true)} />
          <IconButton
            icon="gear"
            label={strings.common.settings}
            onClick={() => nav.open({ name: 'settings' })}
          />
          <IconButton icon="plus" label={s.add} onClick={() => nav.open({ name: 'server-edit' })} />
        </>
      }
    >
      <QuickConnect />
      <h2 className="section-title">
        <Icon name="server" size="1rem" /> {s.title}
      </h2>
      <ul className="list" aria-label={s.title}>
        <li>
          <ServerRow
            id={DEMO_SERVER_ID}
            name={s.demoName}
            subtitle={s.demoSubtitle}
            badge={s.demoBadge}
            badgeKind="demo"
            icon="play"
            selected={selected === DEMO_SERVER_ID}
            onOpen={() => openServer(DEMO_SERVER_ID)}
          />
        </li>
        {services.devServer ? (
          <li>
            <ServerRow
              id={services.devServer.profile.id}
              name={s.devName}
              subtitle={s.devSubtitle}
              badge={s.devBadge}
              badgeKind="dev"
              icon="beaker"
              selected={selected === services.devServer.profile.id}
              onOpen={() => openServer(services.devServer?.profile.id ?? '')}
            />
          </li>
        ) : null}
        {shares.map((p) => (
          <li key={p.id}>
            <ServerRow
              id={p.id}
              name={p.name}
              subtitle={strings.shareLink.subtitle(hostOf(p.baseUrl))}
              badge={strings.shareLink.badge}
              badgeKind="shared"
              icon="link"
              selected={selected === p.id}
              onOpen={() => openServer(p.id)}
              trailing={
                <IconButton
                  icon="close"
                  label={strings.shareLink.end(p.name)}
                  onClick={() => {
                    // Ends the share session: its tunnels, its key session, its entry.
                    sessions.closeServer(p.id);
                    void services.auth.logout(p.id);
                    services.shares.remove(p.id);
                    if (selected === p.id) nav.back();
                  }}
                />
              }
            />
          </li>
        ))}
        {(profiles ?? []).map((p, i, all) => (
          <li key={p.id}>
            <ServerRow
              id={p.id}
              name={p.name || hostOf(p.baseUrl)}
              subtitle={[p.username, hostOf(p.baseUrl)].filter(Boolean).join(' · ')}
              badge={isInsecureUrl(p.baseUrl) ? s.insecureBadge : undefined}
              badgeLabel={isInsecureUrl(p.baseUrl) ? s.insecureBadgeLabel : undefined}
              badgeKind="insecure"
              icon="server"
              selected={selected === p.id}
              onOpen={() => openServer(p.id)}
              trailing={
                reordering ? (
                  <>
                    <IconButton
                      icon="up"
                      label={strings.common.moveUp(p.name)}
                      disabled={i === 0}
                      onClick={() => void move(p, -1)}
                    />
                    <IconButton
                      icon="down"
                      label={strings.common.moveDown(p.name)}
                      disabled={i === all.length - 1}
                      onClick={() => void move(p, 1)}
                    />
                  </>
                ) : (
                  <IconButton
                    icon="edit"
                    label={s.editServer(p.name)}
                    onClick={() => nav.open({ name: 'server-edit', serverId: p.id })}
                  />
                )
              }
            />
          </li>
        ))}
      </ul>
      {profiles && profiles.length === 0 ? (
        <EmptyState icon="server" title={s.empty}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => nav.open({ name: 'server-edit' })}
          >
            <Icon name="plus" /> {s.add}
          </button>
        </EmptyState>
      ) : null}
      {shareOpen ? <ShareLinkDialog onClose={() => setShareOpen(false)} /> : null}
    </Screen>
  );
}

function ServerRow({
  id,
  name,
  subtitle,
  badge,
  badgeLabel,
  badgeKind,
  icon,
  selected,
  onOpen,
  trailing,
}: {
  id: string;
  name: string;
  subtitle: string;
  badge?: string;
  badgeLabel?: string;
  badgeKind: 'demo' | 'dev' | 'shared' | 'insecure';
  icon: 'play' | 'beaker' | 'server' | 'link';
  selected: boolean;
  onOpen: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <div className={selected ? 'row row-selected' : 'row'} data-server-id={id}>
      <button
        type="button"
        className="row-main"
        onClick={onOpen}
        aria-current={selected ? 'true' : undefined}
      >
        <span className={`row-icon row-icon-${badgeKind}`}>
          <Icon name={icon} />
        </span>
        <span className="row-text">
          <span className="row-title">
            {name}
            {badge ? (
              <span
                className={`badge badge-${badgeKind}`}
                title={badgeLabel}
                aria-label={badgeLabel}
              >
                {badge}
              </span>
            ) : null}
          </span>
          {subtitle ? <span className="row-subtitle">{subtitle}</span> : null}
        </span>
        <Icon name="chevron-right" className="row-chevron" />
      </button>
      {trailing ? <div className="row-trailing">{trailing}</div> : null}
    </div>
  );
}
