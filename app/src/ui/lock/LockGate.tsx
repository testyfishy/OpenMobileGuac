import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Dialog } from '../components/Dialog.tsx';
import { Icon } from '../components/Icon.tsx';
import { useAppSettings, useServices } from '../services/context.ts';
import { onAppActiveChange, setPrivacyScreen, type AuthOutcome } from '../services/native.ts';
import { shouldLockOnResume } from '../sessions/sessionModel.ts';
import { useSessions } from '../sessions/SessionsContext.ts';
import { strings } from '../strings.ts';
import { AppAwayTracker } from './appAwayTracker.ts';
import { lockEnforced } from './LockService.ts';

/**
 * Applies the app lock (SRV-6): locks at start-up and after the configured time in the
 * background, covers the UI until unlocked, and turns the privacy screen (hidden content
 * in the app switcher, no screenshots) on while the lock is enabled.
 *
 * Fails closed (AUDIT #3): if the biometric plugin errors or reports that no biometrics or
 * passcode are set up, the app stays locked and says why, with Retry. When the device
 * reports that no biometrics or passcode exist at all, the one way out without unlocking is
 * "Remove saved sign-ins and turn off the lock": it closes every session and deletes every
 * stored password, token and TOTP seed (and the live sign-ins) first, so nothing the lock
 * protected is exposed.
 */
export function LockGate() {
  const { lock, log, profiles, auth } = useServices();
  const sessions = useSessions();
  const { settings, update } = useAppSettings();
  const state = useSyncExternalStore(lock.subscribe, lock.getSnapshot);
  const [outcome, setOutcome] = useState<AuthOutcome | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  });

  const enabled = settings.lock.enabled;
  useEffect(() => {
    let live = true;
    void lock.availability().then((a) => {
      if (!live) return;
      // Never released because the device reports no biometrics/passcode: only the web
      // build (no lock at all) turns it off here.
      const on = lockEnforced(enabled, a);
      lock.setEnabled(on);
      void setPrivacyScreen(on);
    });
    return () => {
      live = false;
    };
  }, [enabled, lock]);

  useEffect(() => {
    // Tells the biometric prompt's own pause/resume from a real trip away (appAwayTracker.ts).
    const away = new AppAwayTracker(lock);
    const sub = onAppActiveChange((active) => {
      const change = away.change(active);
      if (change.kind === 'ignore' || (change.kind === 'away' && change.tentative)) return;
      // SRV-11: the connection-password check waits for the foreground and its grace ends
      // in the background, also while the app lock is off.
      lock.setActive(active);
      if (change.kind === 'away') {
        // Hide the UI now, so the first frame after returning is the lock screen, not the
        // remote desktop (the privacy screen covers the app switcher itself).
        lock.cover();
        return;
      }
      const backgroundedAt = change.awaySince;
      const l = settingsRef.current.lock;
      if (
        shouldLockOnResume(
          lock.isEnabled() && l.enabled,
          l.afterSeconds,
          backgroundedAt,
          Date.now(),
        )
      ) {
        log.info('lock', 'locked after background');
        lock.lock();
      } else {
        lock.uncover();
      }
    });
    return () => sub.dispose();
  }, [lock, log]);

  const unlock = async () => {
    setOutcome(null);
    setOutcome(await lock.unlock(strings.lock.reason, strings.lock.cancel));
  };

  // Prompt automatically when the lock screen appears (not while only covered).
  useEffect(() => {
    if (state !== 'locked') return;
    void lock.unlock(strings.lock.reason, strings.lock.cancel).then(setOutcome);
  }, [state, lock]);

  const resetLock = async () => {
    setConfirmReset(false);
    // Everything the lock protected goes first: open sessions, live sign-ins in memory, and
    // every stored password, token and TOTP seed (sign-out on the servers is best effort).
    sessions.closeAll();
    await auth.signOutLocally(await profiles.list());
    log.info('lock', 'lock turned off from the lock screen; saved sign-ins removed');
    update({ ...settingsRef.current, lock: { ...settingsRef.current.lock, enabled: false } });
    lock.setEnabled(false);
  };

  if (state === 'unlocked') return null;
  if (state === 'covered') return <div className="lock-screen" aria-hidden="true" />;
  // Only when the device reports no usable biometrics or passcode (not after a failed or
  // cancelled attempt): then the lock cannot be passed at all and this is the way out.
  const unavailable = outcome === 'unavailable';
  return (
    <div className="lock-screen" role="dialog" aria-modal="true" aria-labelledby="lock-title">
      <Icon name="lock" size="3rem" />
      <h1 id="lock-title">{strings.lock.title}</h1>
      <p className="muted">{strings.lock.body}</p>
      {outcome === 'unavailable' ? (
        <p className="field-error">{strings.lock.unavailable}</p>
      ) : outcome !== null && outcome !== 'ok' ? (
        <p className="field-error">{strings.lock.failed}</p>
      ) : null}
      <button type="button" className="btn btn-primary" onClick={() => void unlock()}>
        {outcome !== null && outcome !== 'ok' ? strings.lock.retry : strings.lock.unlock}
      </button>
      {unavailable ? (
        <button type="button" className="btn btn-ghost" onClick={() => setConfirmReset(true)}>
          {strings.lock.reset}
        </button>
      ) : null}
      {confirmReset ? (
        <Dialog
          title={strings.lock.resetTitle}
          tone="danger"
          onCancel={() => setConfirmReset(false)}
          actions={
            <>
              <button type="button" className="btn" onClick={() => setConfirmReset(false)}>
                {strings.common.cancel}
              </button>
              <button type="button" className="btn btn-danger" onClick={() => void resetLock()}>
                {strings.lock.resetConfirm}
              </button>
            </>
          }
        >
          <p>{strings.lock.resetBody}</p>
        </Dialog>
      ) : null}
    </div>
  );
}
