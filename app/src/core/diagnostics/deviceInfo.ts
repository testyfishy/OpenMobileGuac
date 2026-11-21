/** Pure helpers for the "About this device" block (DIAG-1). */

export interface WebViewInfo {
  readonly engine: 'chromium' | 'webkit' | 'gecko' | 'unknown';
  readonly version: string | undefined;
  /** Android System WebView (`; wv)` in the UA) rather than a browser. */
  readonly embedded: boolean;
}

export function parseWebView(userAgent: string): WebViewInfo {
  const ua = userAgent;
  const chrome = /(?:Chrome|CriOS|Chromium)\/(\d+(?:\.\d+){0,3})/.exec(ua);
  const embedded = /; wv\)/.test(ua) || /\bwv\b/.test(ua);
  if (chrome && !/CriOS/.test(ua)) {
    return { engine: 'chromium', version: chrome[1], embedded };
  }
  const firefox = /Firefox\/(\d+(?:\.\d+)?)/.exec(ua);
  if (firefox) return { engine: 'gecko', version: firefox[1], embedded: false };
  if (/AppleWebKit/.test(ua)) {
    // iOS WKWebView omits "Version/x"; the OS version is the WebKit version that matters.
    const ios = /OS (\d+)_(\d+)(?:_(\d+))? like Mac OS X/.exec(ua);
    const version = /Version\/(\d+(?:\.\d+)*)/.exec(ua);
    const v =
      version?.[1] ?? (ios ? [ios[1], ios[2], ios[3]].filter(Boolean).join('.') : undefined);
    return { engine: 'webkit', version: v, embedded: !version };
  }
  return { engine: 'unknown', version: undefined, embedded: false };
}

export function describeWebView(info: WebViewInfo): string {
  const name =
    info.engine === 'chromium'
      ? info.embedded
        ? 'Android System WebView'
        : 'Chromium'
      : info.engine === 'webkit'
        ? info.embedded
          ? 'WKWebView'
          : 'WebKit'
        : info.engine === 'gecko'
          ? 'Gecko'
          : 'Unknown';
  return info.version ? `${name} ${info.version}` : name;
}

/** The part of `navigator` the network summary reads (Network Information API is optional). */
export interface NavigatorNetworkLike {
  readonly onLine?: boolean;
  readonly connection?: {
    readonly type?: string;
    readonly effectiveType?: string;
    readonly rtt?: number;
    readonly downlink?: number;
  };
}

/**
 * One line for the top of an exported log: online state, the connection type when the
 * WebView reports it (Android Chrome does; WKWebView does not), and how REST requests go out.
 */
export function describeNetwork(nav: NavigatorNetworkLike | undefined, restPath: string): string {
  const parts: string[] = [nav?.onLine === false ? 'offline' : 'online'];
  const c = nav?.connection;
  if (c && (c.type || c.effectiveType)) {
    const kind = [c.type, c.effectiveType].filter(Boolean).join('/');
    const rtt = typeof c.rtt === 'number' ? `, rtt ~${c.rtt} ms` : '';
    const down = typeof c.downlink === 'number' ? `, ~${c.downlink} Mbit/s` : '';
    parts.push(`${kind}${rtt}${down}`);
  } else {
    parts.push('connection type not reported by this WebView');
  }
  parts.push(`REST: ${restPath}`);
  return parts.join('; ');
}
