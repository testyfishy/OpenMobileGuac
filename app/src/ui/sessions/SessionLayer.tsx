import { Suspense, lazy, useEffect, useRef, type RefCallback } from 'react';
import { Dialog } from '../components/Dialog.tsx';
import { Spinner } from '../components/Feedback.tsx';
import { Icon } from '../components/Icon.tsx';
import { useBackInterceptor, useNav } from '../nav/NavContext.ts';
import { protocolIcon } from '../connections/treeView.ts';
import { strings } from '../strings.ts';
import type { OpenSession } from './sessionModel.ts';
import { useSessions } from './SessionsContext.ts';

// The session screen, the vendored Guacamole client and the demo desktop load on first use,
// keeping them out of the main chunk.
const SessionHost = lazy(() => import('../launch/SessionHost.tsx'));

/**
 * Renders every open session (MUL-1). All stay mounted; only the active one is visible.
 *
 * Hidden sessions are `visibility: hidden` (not `display: none`, so their size, and the
 * remote resolution, do not change), `inert` and `aria-hidden`. `SessionScreen` listens for
 * hardware keys on `document`, so `inert` alone does not stop them: until it accepts an
 * `active` prop, `useInactiveKeyGuard` parks a hidden `role="dialog"` marker in each
 * hidden session's chrome, which its key handler already treats as "do not forward".
 */
export function SessionLayer({
  registerSlot,
}: {
  registerSlot: (id: string, el: HTMLElement | null) => void;
}) {
  const sessions = useSessions();
  const { sessions: list, activeId } = sessions.state;
  const limit = sessions.limit;
  const limitDialog = limit ? (
    <Dialog
      title={strings.session.limitTitle}
      onCancel={limit.cancel}
      actions={
        <>
          <button type="button" className="btn" onClick={limit.cancel}>
            {strings.common.cancel}
          </button>
          <button type="button" className="btn btn-primary" onClick={limit.confirm}>
            {strings.session.closeOldest(limit.closeName)}
          </button>
        </>
      }
    >
      <p>{strings.session.limitBody(limit.max)}</p>
    </Dialog>
  ) : null;
  if (list.length === 0) return limitDialog;
  const active = list.find((s) => s.id === activeId);
  return (
    <>
      {limitDialog}
      <div className="session-layer" data-active={active ? 'true' : 'false'}>
        {list.map((s) => (
          <SessionSlot
            key={s.id}
            session={s}
            active={s.id === activeId}
            slotRef={(el) => registerSlot(s.id, el)}
          />
        ))}
      </div>
      {active ? (
        <button
          type="button"
          className="session-pill"
          onClick={() => sessions.setSwitcherOpen(true)}
          aria-label={strings.session.switcherButton(list.length)}
          title={strings.session.switcherButton(list.length)}
        >
          <Icon name="layers" size="1.125rem" />
          <span aria-hidden="true">{list.length}</span>
        </button>
      ) : (
        <button
          type="button"
          className="sessions-indicator"
          onClick={() => sessions.setSwitcherOpen(true)}
        >
          <span className="active-dot-mark" aria-hidden="true" />
          {strings.session.indicator(list.length)}
          <span className="sessions-indicator-action">{strings.session.show}</span>
        </button>
      )}
      {sessions.switcherOpen ? <SessionSwitcher /> : null}
    </>
  );
}

function SessionSlot({
  session,
  active,
  slotRef,
}: {
  session: OpenSession;
  active: boolean;
  slotRef: RefCallback<HTMLDivElement>;
}) {
  const sessions = useSessions();
  const nav = useNav();
  const el = useRef<HTMLDivElement | null>(null);
  useInactiveKeyGuard(el, active);
  return (
    <div
      ref={(node) => {
        el.current = node;
        slotRef(node);
      }}
      className={active ? 'session-slot session-slot-active' : 'session-slot session-slot-hidden'}
      inert={!active}
      aria-hidden={!active}
      data-session-id={session.id}
    >
      {session.state === 'live' ? (
        <Suspense
          fallback={
            <div className="session-loading">
              <Spinner label={strings.session.loading} />
            </div>
          }
        >
          <SessionHost
            key={session.epoch}
            session={session}
            active={active}
            onHide={sessions.hide}
            onExit={() => sessions.close(session.id)}
            onNeedsSignIn={() => {
              sessions.hide();
              nav.open({ name: 'connections', serverId: session.serverId });
            }}
          />
        </Suspense>
      ) : (
        <SuspendedSession session={session} active={active} />
      )}
    </div>
  );
}

/** Shell-side stand-in for an `active` prop on SessionScreen; see `SessionLayer`. */
function useInactiveKeyGuard(ref: { current: HTMLElement | null }, active: boolean) {
  useEffect(() => {
    if (active) return undefined;
    let marker: HTMLElement | null = null;
    let frame = 0;
    const place = () => {
      const chrome = ref.current?.querySelector('.omg-chrome');
      if (!chrome) {
        frame = requestAnimationFrame(place);
        return;
      }
      marker = document.createElement('div');
      marker.setAttribute('role', 'dialog');
      marker.setAttribute('aria-hidden', 'true');
      marker.hidden = true;
      marker.dataset['omgInactiveGuard'] = '';
      chrome.appendChild(marker);
    };
    place();
    return () => {
      cancelAnimationFrame(frame);
      marker?.remove();
    };
  }, [ref, active]);
}

function SuspendedSession({ session, active }: { session: OpenSession; active: boolean }) {
  const sessions = useSessions();
  const nav = useNav();
  const s = strings.session;
  useBackInterceptor(active, sessions.hide);
  const reauth = session.state === 'reauth';
  return (
    <div className="session-suspended" role="region" aria-label={session.target.name}>
      <div className="session-suspended-card">
        <Icon name={protocolIcon(session.target.protocol)} size="2.5rem" />
        <h2>{session.target.name}</h2>
        <p className="muted">{session.serverName}</p>
        <p className="session-suspended-title">{reauth ? s.reloginFailed : s.suspendedTitle}</p>
        {reauth ? null : <p className="muted">{s.suspendedBody}</p>}
        <div className="form-actions">
          {reauth ? (
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={() => {
                sessions.close(session.id);
                nav.open({ name: 'connections', serverId: session.serverId });
              }}
            >
              {s.signInAgain}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={() => sessions.reconnect(session.id)}
            >
              <Icon name="refresh" /> {s.reconnect}
            </button>
          )}
          <button type="button" className="btn btn-block" onClick={sessions.hide}>
            {s.backToList}
          </button>
          <button
            type="button"
            className="btn btn-danger-ghost btn-block"
            onClick={() => sessions.close(session.id)}
          >
            {s.closeSession(session.target.name)}
          </button>
        </div>
      </div>
    </div>
  );
}

/** List of open sessions: switch, disconnect, or go back to the connection list. */
export function SessionSwitcher() {
  const sessions = useSessions();
  const { sessions: list, activeId } = sessions.state;
  const s = strings.session;
  const ref = useRef<HTMLDivElement>(null);
  const close = () => sessions.setSwitcherOpen(false);
  useBackInterceptor(true, close);
  useEffect(() => {
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    return () => prev?.focus();
  }, []);
  return (
    <div className="sheet-backdrop" onClick={close}>
      <div
        ref={ref}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={s.switcherTitle}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close();
          }
        }}
      >
        <div className="sheet-header">
          <h2 className="sheet-title">{s.switcherTitle}</h2>
          <button
            type="button"
            className="icon-btn"
            onClick={close}
            aria-label={strings.common.close}
          >
            <Icon name="close" />
          </button>
        </div>
        <ul className="list">
          {list.map((x) => (
            <li key={x.id}>
              <div className={x.id === activeId ? 'row row-selected' : 'row'}>
                <button
                  type="button"
                  className="row-main"
                  onClick={() => sessions.show(x.id)}
                  aria-label={s.switchTo(x.target.name)}
                  aria-current={x.id === activeId ? 'true' : undefined}
                >
                  <SessionThumb session={x} />
                  <span className="row-text">
                    <span className="row-title">{x.target.name}</span>
                    <span className="row-subtitle">
                      {[
                        x.serverName,
                        x.id === activeId ? s.current : null,
                        x.state !== 'live' ? s.suspendedTitle : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                </button>
                <div className="row-trailing">
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => sessions.close(x.id)}
                    aria-label={s.closeSession(x.target.name)}
                    title={s.closeSession(x.target.name)}
                  >
                    <Icon name="close" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
        {activeId ? (
          <button
            type="button"
            className="btn btn-block sheet-footer-btn"
            onClick={() => {
              close();
              sessions.hide();
            }}
          >
            <Icon name="back" /> {s.backToList}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SessionThumb({ session }: { session: OpenSession }) {
  return (
    <span className="row-icon">
      <Icon name={protocolIcon(session.target.protocol)} />
    </span>
  );
}
