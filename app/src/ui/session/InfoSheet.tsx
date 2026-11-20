import { useEffect, useState } from 'react';
import { formatBytes } from '../../session/transfer/TransferModel.ts';
import { humanizeParamName } from '../../session/credentials/requiredParams.ts';
import type { MutableArgument } from './argv.ts';
import { ChromeButton } from './ChromeButton.tsx';
import type { SessionInfo } from './SessionController.ts';
import { sessionStrings } from './sessionStrings.ts';
import type { ResolvedSessionSettings } from './settings.ts';
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
  /** Open this connection in the connection editor (only with permission to edit it). */
  readonly onEditConnection?: () => void;
}

function duration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h} h ${m} min` : m > 0 ? `${m} min ${sec} s` : `${sec} s`;
}

const fmt = (v: number | null, digits = 0, unit = '') =>
  v === null ? sessionStrings.info.notKnownYet : `${v.toFixed(digits)}${unit}`;

/** Session info: what is connected, how, and how it is performing. */
export function InfoSheet(props: InfoSheetProps) {
  const { getInfo } = props;
  const [info, setInfo] = useState<SessionInfo>(() => getInfo());
  useEffect(() => {
    const t = setInterval(() => setInfo(getInfo()), 1000);
    return () => clearInterval(t);
  }, [getInfo]);

  const t = sessionStrings.info;
  const rows: [string, string][] = [
    [t.connection, props.title],
    [t.protocol, props.protocol ? props.protocol.toUpperCase() : t.unknownProtocol],
    [
      t.requested,
      info.requested
        ? t.requestedValue(
            info.requested.width,
            info.requested.height,
            info.requested.dpi,
            sessionStrings.options.qualityOptions[info.requested.quality],
          )
        : '–',
    ],
    [
      t.remoteResolution,
      info.remoteSize.width > 0 ? `${info.remoteSize.width} × ${info.remoteSize.height}` : '–',
    ],
    [
      t.view,
      `${sessionStrings.fitModes.labels[props.settings.fitMode]} · ${Math.round(info.scale * 100)} %`,
    ],
    [t.tunnel, props.isDemo ? t.tunnelTypes.demo : info.tunnelType],
    [t.tunnelState, info.tunnelState],
    [t.connectedFor, info.connectedForMs === null ? '–' : duration(info.connectedForMs)],
    [
      t.received,
      `${formatBytes(info.receivedBytes)} · ${t.instructions(info.receivedInstructions)}`,
    ],
    [t.dataRate, info.receivedKbps === null ? t.notKnownYet : t.kbps(info.receivedKbps)],
    [t.sent, `${formatBytes(info.sentBytes)} · ${t.instructions(info.sentInstructions)}`],
    [t.frames, String(info.frames)],
    [t.processingLag, fmt(info.processingLagMs, 0, ' ms')],
    [t.frameRate, `${fmt(info.clientFps, 1)} / ${fmt(info.serverFps, 1)} fps`],
    [t.desktopFrameRate, fmt(info.desktopFps, 1, ' fps')],
    [t.dropped, fmt(info.dropRate, 1, ` ${t.perSecond}`)],
    [
      t.audio,
      info.requested && !info.requested.audio
        ? t.audioNotRequested
        : `${props.settings.audio === 'muted' ? t.audioMuted : t.audioOn} · ${t.audioOutput(t.audioStates[info.audioContext] ?? info.audioContext)}`,
    ],
    [t.keepScreenOn, props.keepAwake],
    [t.network, info.online ? t.online : t.offline],
  ];

  return (
    <Sheet title={t.title} onClose={props.onClose}>
      <dl className="omg-info">
        {rows.map(([k, v]) => (
          <div key={k} className="omg-info__row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="omg-muted">{t.footnote}</p>
      <p className="omg-muted">{t.serverSideHint}</p>
      {props.onEditConnection ? (
        <ChromeButton className="omg-btn--ghost" onClick={props.onEditConnection}>
          {t.editConnection}
        </ChromeButton>
      ) : null}
      {props.mutableArguments.length > 0 && (
        <section className="omg-section" aria-labelledby="omg-info-args">
          <h3 id="omg-info-args" className="omg-section__title">
            {t.connectionSettings}
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
          {sessionStrings.info.apply}
        </ChromeButton>
      </div>
    </div>
  );
}
