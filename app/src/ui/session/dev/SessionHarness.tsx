/**
 * Dev-only harness: renders `SessionScreen` against an in-memory tunnel so the session UI
 * can be exercised without a Guacamole server. Mount it only in development, e.g. in the
 * app shell:
 *
 *   if (import.meta.env.DEV && new URLSearchParams(location.search).get('harness') === 'session') {
 *     const { SessionHarness } = await import('./ui/session/dev/SessionHarness.tsx');
 *     root.render(<SessionHarness />);
 *   }
 *
 * Pass `createTunnel` to drive it with another TunnelLike (e.g. the demo server).
 *
 * Uses `ScribbleTunnel` (a local test double). The panel in the top-right corner shows the
 * instructions the "remote" received and can simulate remote copy, network loss and
 * connection failure.
 */

import { useRef, useState, useSyncExternalStore, type CSSProperties, type JSX } from 'react';
import { makeStatus, type TunnelLike } from '../../../core/transport/TunnelLike.ts';
import { SessionScreen } from '../SessionScreen.tsx';
import { DEFAULT_SESSION_SETTINGS, type SessionSettings } from '../settings.ts';
import { FeatureTunnel } from './FeatureTunnel.ts';
import { ScribbleTunnel, type ScribbleLogEntry } from './ScribbleTunnel.ts';

/** Tiny external store for the log so the panel re-renders without effects. */
class LogStore {
  private entries: readonly ScribbleLogEntry[] = [];
  private readonly listeners = new Set<() => void>();
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  get = () => this.entries;
  set(entries: readonly ScribbleLogEntry[]) {
    this.entries = [...entries];
    for (const l of this.listeners) l();
  }
}

export interface SessionHarnessProps {
  /** Optional tunnel factory (e.g. the demo server's tunnel); defaults to ScribbleTunnel. */
  readonly createTunnel?: () => TunnelLike;
  /**
   * Use FeatureTunnel: credential prompt, filesystem, downloads, print job and audio
   * (`?tunnel=features`). `requireCredentials: false` skips the prompt.
   */
  readonly features?: { readonly requireCredentials?: boolean; readonly filesystem?: boolean };
  /** Called with each new tunnel (for automated checks). */
  readonly onTunnel?: (t: TunnelLike) => void;
}

export function SessionHarness({
  createTunnel,
  features,
  onTunnel,
}: SessionHarnessProps = {}): JSX.Element {
  // `?legacy=1`: settings as stored before key sets (a per-connection layout and text combos).
  const [settings, setSettings] = useState<SessionSettings>(() =>
    typeof location !== 'undefined' && new URLSearchParams(location.search).has('legacy')
      ? {
          ...DEFAULT_SESSION_SETTINGS,
          keyBarLayout: [['Esc', 'F2', 'combo:Ctrl+Alt+Delete']],
          customCombos: ['Ctrl+Shift+Esc', 'Ctrl+K, Ctrl+C'],
        }
      : DEFAULT_SESSION_SETTINGS,
  );
  const [run, setRun] = useState(0);
  const [exited, setExited] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  /** Simulates the shell hiding the session (the `active` prop). */
  const [active, setActive] = useState(true);
  const [log] = useState(() => new LogStore());
  const entries = useSyncExternalStore(log.subscribe, log.get);
  const current = useRef<ScribbleTunnel | null>(null);
  const failNext = useRef(0);

  const makeTunnel = (): TunnelLike => {
    if (createTunnel) return createTunnel();
    const fail = failNext.current > 0;
    failNext.current = Math.max(0, failNext.current - 1);
    const t = features
      ? new FeatureTunnel({
          requireCredentials: features.requireCredentials,
          filesystem: features.filesystem,
        })
      : new ScribbleTunnel({
          failConnect: fail ? makeStatus(0x0207, 'Simulated: host not found') : null,
        });
    t.onlog = (e) => log.set(e);
    current.current = t;
    onTunnel?.(t);
    return t;
  };

  if (exited) {
    return (
      <div style={styles.exited}>
        <p>Session closed (onExit called).</p>
        <button
          type="button"
          style={styles.button}
          onClick={() => {
            setExited(false);
            setRun((n) => n + 1);
          }}
        >
          Start again
        </button>
      </div>
    );
  }

  return (
    <>
      <SessionScreen
        key={run}
        title="Scribble desktop"
        protocol="rdp"
        isDemo
        active={active}
        createTunnel={makeTunnel}
        buildConnectData={(size) =>
          `GUAC_WIDTH=${size.width}&GUAC_HEIGHT=${size.height}&GUAC_DPI=${size.dpi}${size.audio === false ? '' : '&GUAC_AUDIO=audio/L16'}`
        }
        settings={settings}
        onSettingsChange={(patch) => setSettings((s) => ({ ...s, ...patch }))}
        onExit={() => setExited(true)}
        onMinimize={() => setExited(true)}
        onLog={(e) => console.debug(`[session ${e.level}] ${e.message}`)}
        onThumbnail={(url) => {
          (window as { __omgThumbnails?: string[] }).__omgThumbnails ??= [];
          (window as { __omgThumbnails?: string[] }).__omgThumbnails?.push(url);
        }}
      />
      <div style={styles.panel} data-harness-panel="">
        <button type="button" style={styles.button} onClick={() => setPanelOpen((v) => !v)}>
          {panelOpen ? 'Hide log' : 'Log'}
        </button>
        {panelOpen && (
          <>
            <div style={styles.row}>
              <button
                type="button"
                style={styles.button}
                onClick={() =>
                  current.current?.emitClipboard(`remote text ${new Date().toLocaleTimeString()}`)
                }
              >
                Remote copies
              </button>
              <button type="button" style={styles.button} onClick={() => current.current?.drop()}>
                Drop link
              </button>
              <button
                type="button"
                style={styles.button}
                data-harness-active=""
                onClick={() => setActive((v) => !v)}
              >
                {active ? 'Hide session' : 'Show session'}
              </button>
              {features && (
                <>
                  <button
                    type="button"
                    style={styles.button}
                    onClick={() => (current.current as FeatureTunnel | null)?.pushDownload()}
                  >
                    Push file
                  </button>
                  <button
                    type="button"
                    style={styles.button}
                    onClick={() => (current.current as FeatureTunnel | null)?.pushPrint()}
                  >
                    Print
                  </button>
                  <button
                    type="button"
                    style={styles.button}
                    onClick={() => (current.current as FeatureTunnel | null)?.playTone()}
                  >
                    Tone
                  </button>
                </>
              )}
              <button
                type="button"
                style={styles.button}
                onClick={() => {
                  failNext.current = 5;
                }}
              >
                Fail next 5
              </button>
            </div>
            <div style={styles.settings}>
              mode {settings.pointerMode} · fit {settings.fitMode} · match{' '}
              {String(settings.matchDeviceSize)} · combos {settings.customCombos.length}
            </div>
            <ol style={styles.log} data-harness-log="">
              {entries
                .slice(-14)
                .reverse()
                .map((e, i) => (
                  <li key={`${e.time}-${i}`}>
                    <span style={{ opacity: 0.6 }}>{(e.time / 1000).toFixed(1)}s</span> {e.text}
                  </li>
                ))}
            </ol>
          </>
        )}
      </div>
    </>
  );
}

const styles = {
  panel: {
    position: 'fixed',
    top: 'calc(env(safe-area-inset-top, 0px) + 40px)',
    right: 8,
    zIndex: 1000,
    width: 'min(300px, 70vw)',
    padding: 6,
    borderRadius: 10,
    background: 'rgba(0,0,0,0.72)',
    color: '#e8e8e8',
    font: '11px/1.35 ui-monospace, Menlo, Consolas, monospace',
  },
  row: { display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 },
  button: {
    padding: '4px 8px',
    borderRadius: 6,
    border: '1px solid #666',
    background: '#222',
    color: '#eee',
    font: 'inherit',
  },
  settings: { marginTop: 4, opacity: 0.8 },
  log: {
    listStyle: 'none',
    margin: '4px 0 0',
    padding: 0,
    maxHeight: 220,
    overflow: 'hidden',
    wordBreak: 'break-all',
  },
  exited: {
    position: 'fixed',
    inset: 0,
    display: 'grid',
    placeContent: 'center',
    gap: 12,
    background: '#111',
    color: '#eee',
    font: '15px system-ui, sans-serif',
  },
} as const satisfies Record<string, CSSProperties>;
