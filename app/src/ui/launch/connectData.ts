import { buildTunnelConnectString, type TunnelTargetType } from '../../core/api/tunnel.ts';

/** What the web client advertises in the connect string (docs/protocol-notes.md §3.2). */
export interface MediaSupport {
  readonly audio: readonly string[];
  readonly video: readonly string[];
  readonly image: readonly string[];
}

export interface ConnectDataParams {
  /** Read at connect time, so a reconnect after silent re-login uses the new token. */
  readonly getToken: () => string;
  readonly dataSource: string;
  readonly id: string;
  readonly type: TunnelTargetType;
  readonly timezone: string | undefined;
  /** Evaluated lazily at connect. */
  readonly media: () => MediaSupport;
}

/** `SessionScreenProps.buildConnectData` for one connection. */
export function makeConnectDataBuilder(
  p: ConnectDataParams,
): (size: { width: number; height: number; dpi: number; audio?: boolean }) => string {
  return (size) => {
    const media = p.media();
    // Quality / Audio "off": advertise no audio types, so guacd encodes and sends none
    // (libguac/audio.c assigns encoders only for advertised types).
    const audio = size.audio === false ? [] : media.audio;
    return buildTunnelConnectString({
      token: p.getToken(),
      dataSource: p.dataSource,
      id: p.id,
      type: p.type,
      width: size.width,
      height: size.height,
      dpi: size.dpi,
      timezone: p.timezone,
      audioMimetypes: audio,
      videoMimetypes: media.video,
      imageMimetypes: media.image,
    });
  };
}

/** The device's IANA zone, as the web client sends it; `undefined` if unknown. */
export function deviceTimezone(): string | undefined {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && tz.length > 0 ? tz : undefined;
  } catch {
    return undefined;
  }
}
