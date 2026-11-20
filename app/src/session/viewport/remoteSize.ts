/**
 * What remote desktop size and DPI to ask guacd for (SPEC DSP-4, AUDIT #9 and §4.4,
 * "Quality"). Pure.
 *
 * guacd 1.6.0 RDP rule when the administrator has not fixed `width`, `height` or `dpi`
 * (guacamole-server `src/protocols/rdp/resolution.c` `guac_rdp_suggest_resolution`,
 * `src/protocols/rdp/settings.c` 850-889, `src/libguac/user-handlers.c` 632-655; see
 * docs/protocol-notes.md "Remote size, DPI and quality"):
 *
 * - The handshake `size` gives the client's optimal width W, height H and DPI D.
 * - `reasonable(r)` = `D == r` or `(W·r/D) · (H·r/D) ≥ 800·600` (C integer division).
 * - The resolution is 96 if `reasonable(96)`, else 120 if `reasonable(120)`, else D.
 * - Desktop width = `(W·res/D) & ~3` (rounded down to a multiple of 4), height = `H·res/D`.
 * - The DPI only converts pixels: guacd sends no DesktopScaleFactor to the RDP server, so
 *   Windows uses its own default scaling (normally 100 %) whatever DPI the client asks for.
 * - Later `size` instructions (mid-session resize) carry only width and height and are
 *   converted with the DPI chosen at connect.
 *
 * VNC uses W×H only (SetDesktopSize, if the server allows it; often ignored). SSH and the
 * other terminal protocols size the terminal from W×H and scale the font by D/96.
 */

export type Quality = 'auto' | 'best' | 'low';
export const QUALITIES: readonly Quality[] = ['auto', 'best', 'low'];

export type RemoteResolution =
  'auto' | 'device' | '1280x720' | '1600x900' | '1920x1080' | '2560x1440' | 'custom';
export const REMOTE_RESOLUTIONS: readonly RemoteResolution[] = [
  'auto',
  'device',
  '1280x720',
  '1600x900',
  '1920x1080',
  '2560x1440',
  'custom',
];

export type AudioMode = 'on' | 'muted' | 'off';
export const AUDIO_MODES: readonly AudioMode[] = ['on', 'muted', 'off'];

export interface DisplayRequest {
  readonly width: number;
  readonly height: number;
  readonly dpi: number;
}

export interface SizeInputs {
  readonly quality: Quality;
  readonly resolution: RemoteResolution;
  /** Custom size (resolution `custom`). */
  readonly customWidth: number;
  readonly customHeight: number;
  /** Percent, 100 = none. Above 100 the requested desktop is smaller, so it shows larger. */
  readonly scalePercent: number;
  /** Available area in CSS px. */
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly devicePixelRatio: number;
  /**
   * SSH, telnet, Kubernetes: guacd scales the terminal font by DPI/96, so `best` keeps the
   * `auto` DPI (same physical text size) instead of raising it.
   */
  readonly terminal?: boolean;
}

const AREA = 800 * 600;
const idiv = (a: number, b: number) => Math.trunc(a / b);

function reasonable(w: number, h: number, dpi: number, r: number): boolean {
  return dpi === r || idiv(w * r, dpi) * idiv(h * r, dpi) >= AREA;
}

/** guacd 1.6.0's RDP choice for a requested size (see the file comment). */
export function guacdRdpResult(req: DisplayRequest): DisplayRequest {
  const { width: w, height: h } = req;
  const d = req.dpi > 0 ? req.dpi : 96;
  if (w <= 0 || h <= 0) return { width: 1024, height: 768, dpi: 96 };
  const res = reasonable(w, h, d, 96) ? 96 : reasonable(w, h, d, 120) ? 120 : d;
  return { width: idiv(w * res, d) & ~3, height: idiv(h * res, d), dpi: res };
}

/**
 * The smallest DPI ≥ `atLeast` at which guacd keeps W×H (neither its 96 nor its 120 DPI
 * candidate passes the 800×600 area check), or 96 when `atLeast` is 96 (equality wins).
 * For 1170×2532 that is 298; for 750×1624, 192.
 */
export function nativeDpi(width: number, height: number, atLeast: number): number {
  if (atLeast <= 96) return 96;
  for (let d = Math.ceil(atLeast); d < 4000; d++) {
    if (!reasonable(width, height, d, 96) && !reasonable(width, height, d, 120)) return d;
  }
  return 96;
}

function fixedSize(r: RemoteResolution): { width: number; height: number } | null {
  const m = /^(\d+)x(\d+)$/.exec(r);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

/**
 * The `size` (width, height, DPI) to send at connect and on resize.
 *
 * - `auto` (upstream web client behaviour): device pixels at `96·dpr` DPI. guacd then
 *   picks 96 or 120 DPI if the area allows, so a DPR-3 phone gets a smaller desktop.
 * - `best`: device pixels at the lowest DPI that guacd keeps (`nativeDpi`), so the desktop
 *   is one remote pixel per device pixel.
 * - `low`: CSS pixels at 96 DPI (a third to a ninth of the pixels).
 *
 * `resolution` other than `auto` fixes the pixel size (at 96 DPI, which guacd always
 * keeps): `device` = device pixels; a fixed size; or `custom`. `scalePercent` > 100 divides
 * the requested size, so the remote desktop is drawn larger (DPI cannot do this: guacd sends
 * none to the RDP server).
 */
export function requestedDisplaySize(i: SizeInputs): DisplayRequest {
  const dpr =
    Number.isFinite(i.devicePixelRatio) && i.devicePixelRatio > 0 ? i.devicePixelRatio : 1;
  const scale = Math.min(4, Math.max(1, (i.scalePercent || 100) / 100));
  const deviceW = Math.floor(i.cssWidth * dpr);
  const deviceH = Math.floor(i.cssHeight * dpr);
  const scaled = (w: number, h: number) => ({
    width: Math.max(1, Math.floor(w / scale)),
    height: Math.max(1, Math.floor(h / scale)),
  });
  if (i.resolution !== 'auto') {
    const fixed = fixedSize(i.resolution);
    const px =
      i.resolution === 'device'
        ? { width: deviceW, height: deviceH }
        : i.resolution === 'custom'
          ? { width: Math.floor(i.customWidth), height: Math.floor(i.customHeight) }
          : (fixed ?? { width: deviceW, height: deviceH });
    return { ...scaled(px.width, px.height), dpi: 96 };
  }
  switch (i.quality) {
    case 'low': {
      const s = scaled(Math.floor(i.cssWidth), Math.floor(i.cssHeight));
      return { ...s, dpi: 96 };
    }
    case 'best': {
      if (scale > 1) return { ...scaled(deviceW, deviceH), dpi: 96 };
      if (i.terminal) return { width: deviceW, height: deviceH, dpi: Math.floor(96 * dpr) };
      return {
        width: deviceW,
        height: deviceH,
        dpi: nativeDpi(deviceW, deviceH, Math.floor(96 * dpr)),
      };
    }
    case 'auto':
    default: {
      if (scale > 1) return { ...scaled(deviceW, deviceH), dpi: 96 };
      return { width: deviceW, height: deviceH, dpi: Math.floor(96 * dpr) };
    }
  }
}

/** Mid-session resize debounce: `low` waits longer so a rotation or keyboard is one resize. */
export function resizeDebounceMs(quality: Quality): number {
  return quality === 'low' ? 1500 : 400;
}

/** Whether to advertise audio types in the connect string (`off` = none, guacd sends none). */
export function requestsAudio(quality: Quality, audio: AudioMode): boolean {
  return audio !== 'off' && quality !== 'low';
}
