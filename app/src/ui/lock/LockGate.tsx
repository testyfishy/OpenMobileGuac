import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from '../components/Icon.tsx';
import { useAppSettings, useServices } from '../services/context.ts';
import { onAppActiveChange, setPrivacyScreen } from '../services/native.ts';
import { shouldLockOnResume } from '../sessions/sessionModel.ts';
import { strings } from '../strings.ts';

/**
 * Applies the app lock (SRV-6): locks at start-up and after the configured time in the
 * background, covers the UI until unlocked, and turns the privacy screen (hidden content
 * in the app switcher, no screenshots) on while the lock is enabled.
 */
export function LockGate() {
  const { lock, log } = useServices();
  const { settings } = useAppSettings();
  const locked = useSyncExternalStore(lock.subscribe, lock.getSnapshot);
  const [failed, setFailed] = useState(false);
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  });

  const enabled = settings.lock.enabled;
  useEffect(() => {
    let live = true;
    void lock.availability().then((a) => {
      if (!live) return;
      const on = enabled && a === 'available';
      lock.setEnabled(on);
      void setPrivacyScreen(on);
    });
    return () => {
      live = false;
    };
  }, [enabled, lock]);

  useEffect(() => {
    let backgroundedAt: number | null = null;
    const sub = onAppActiveChange((active) => {
      if (lock.promptActive()) return;
      if (!active) {
        backgroundedAt = Date.now();
        return;
      }
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
      }
      backgroundedAt = null;
    });
    return () => sub.dispose();
  }, [lock, log]);

  const unlock = async () => {
    setFailed(false);
    const r = await lock.unlock(strings.lock.reason, strings.lock.cancel);
    if (r !== 'ok') setFailed(true);
  };

  // Prompt automatically when the lock screen appears.
  useEffect(() => {
    if (!locked) return;
    void lock.unlock(strings.lock.reason, strings.lock.cancel).then((r) => setFailed(r !== 'ok'));
  }, [locked, lock]);

  if (!locked) return null;
  return (
    <div className="lock-screen" role="dialog" aria-modal="true" aria-labelledby="lock-title">
      <Icon name="lock" size="3rem" />
      <h1 id="lock-title">{strings.lock.title}</h1>
      <p className="muted">{strings.lock.body}</p>
      {failed ? <p className="field-error">{strings.lock.failed}</p> : null}
      <button type="button" className="btn btn-primary" onClick={() => void unlock()}>
        {strings.lock.unlock}
      </button>
    </div>
  );
}
