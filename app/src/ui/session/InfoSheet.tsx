import { useEffect, useState } from 'react';
import { formatBytes } from '../../session/transfer/TransferModel.ts';
import { humanizeParamName } from '../../session/credentials/requiredParams.ts';
import type { MutableArgument } from './argv.ts';
import { ChromeButton } from './ChromeButton.tsx';
import type { SessionInfo } from './SessionController.ts';
import { FIT_MODE_LABELS, type ResolvedSessionSettings } from './settings.ts';
import { Sheet } from './Sheet.tsx';

export interface InfoSheetProps {
  readonly title: string;
  readonly protocol?: string;
  readonly isDemo?: boolean;
  readonly settings: ResolvedSessionSettings;
  readonly getInfo: () => SessionInfo;
  readonly keepAwake: string;
  readonly mutableArguments: readonly MutableArgument[];
  readonly onSetArgument: (name: string, value: string) => boolean;
  readonly onClose: () => void;
}

function duration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h} h ${m} min` : m > 0 ? `${m} min ${sec} s` : `${sec} s`;
}

const fmt = (v: number | null, digits = 0, unit = '') =>
  v === null ? 'not known yet' : `${v.toFixed(digits)}${unit}`;

/** Session info: what is connected, how, and how it is performing. */
export function InfoSheet(props: InfoSheetProps) {
  const { getInfo } = props;
  const [info, setInfo] = useState<SessionInfo>(() => getInfo());
  useEffect(() => {
    const t = setInterval(() => setInfo(getInfo()), 1000);
    return () => clearInterval(t);
  }, [getInfo]);

  const rows: [string, string][] = [
    ['Connection', props.title],
    ['Protocol', (props.protocol ?? 'unknown').toUpperCase()],
    [
      'Remote resolution',
      info.remoteSize.width > 0 ? `${info.remoteSize.width} × ${info.remoteSize.height}` : '–',
    ],
    ['View', `${FIT_MODE_LABELS[props.settings.fitMode]} · ${Math.round(info.scale * 100)} %`],
    ['Tunnel', props.isDemo ? 'In-app demo' : info.tunnelType],
    ['Tunnel state', info.tunnelState],
    ['Connected for', info.connectedForMs === null ? '–' : duration(info.connectedForMs)],
    ['Received', `${formatBytes(info.receivedBytes)} · ${info.receivedInstructions} instructions`],
    ['Sent', `${formatBytes(info.sentBytes)} · ${info.sentInstructions} instructions`],
    ['Frames', String(info.frames)],
    ['Frame processing lag', fmt(info.processingLagMs, 0, ' ms')],
    ['Frame rate (client / server)', `${fmt(info.clientFps, 1)} / ${fmt(info.serverFps, 1)} fps`],
    ['Remote desktop frame rate', fmt(info.desktopFps, 1, ' fps')],
    ['Frames dropped by the server', fmt(info.dropRate, 1, ' per s')],
    ['Audio', `${props.settings.audioMuted ? 'muted' : 'on'} · output ${info.audioContext}`],
    ['Keep screen on', props.keepAwake],
    ['Network', info.online ? 'online' : 'offline'],
  ];

  return (
    <Sheet title="Session info" onClose={props.onClose}>
      <dl className="omg-info">
        {rows.map(([k, v]) => (
          <div key={k} className="omg-info__row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="omg-muted">
        Frame figures come from the library&apos;s sync timing. Network round-trip time is not
        available: the tunnel does not expose its ping replies.
      </p>
      {props.mutableArguments.length > 0 && (
        <section className="omg-section" aria-labelledby="omg-info-args">
          <h3 id="omg-info-args" className="omg-section__title">
            Connection settings
          </h3>
          {props.mutableArguments.map((a) => (
            <ArgumentRow key={a.name} arg={a} onSet={props.onSetArgument} />
          ))}
        </section>
      )}
    </Sheet>
  );
}

function ArgumentRow({
  arg,
  onSet,
}: {
  arg: MutableArgument;
  onSet: (name: string, value: string) => boolean;
}) {
  const [value, setValue] = useState(arg.value);
  const id = `omg-arg-${arg.name}`;
  return (
    <div className="omg-field">
      <label className="omg-label" htmlFor={id}>
        {humanizeParamName(arg.name)}
      </label>
      <div className="omg-combo-form__row">
        <input
          id={id}
          className="omg-input"
          value={value}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
        />
        <ChromeButton
          className="omg-btn--ghost"
          disabled={value === arg.value}
          onClick={() => onSet(arg.name, value)}
        >
          Apply
        </ChromeButton>
      </div>
    </div>
  );
}
