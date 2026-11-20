/**
 * Local-only diagnostics log (SPEC DIAG-1). A small ring buffer kept in memory; nothing
 * leaves the device unless the user copies or shares it. Callers must not log secrets, and
 * `redact()` is applied again on export as a second line of defence.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

export interface LogEntry {
  readonly seq: number;
  /** Epoch ms. */
  readonly at: number;
  readonly level: LogLevel;
  /** Short area name: `http`, `auth`, `session`, `app`, ... */
  readonly area: string;
  readonly message: string;
}

export interface LoggerOptions {
  readonly capacity?: number;
  readonly now?: () => number;
}

export class Logger {
  private readonly capacity: number;
  private readonly now: () => number;
  private buf: LogEntry[] = [];
  private seq = 0;
  private readonly listeners = new Set<() => void>();

  constructor(options: LoggerOptions = {}) {
    this.capacity = options.capacity ?? 500;
    this.now = options.now ?? (() => Date.now());
  }

  log(level: LogLevel, area: string, message: string): void {
    // Redact eagerly too: secrets should never sit in memory longer than needed.
    const entry: LogEntry = {
      seq: ++this.seq,
      at: this.now(),
      level,
      area,
      message: redactSecrets(message).slice(0, 2000),
    };
    this.buf = [...this.buf.slice(-(this.capacity - 1)), entry];
    for (const l of this.listeners) l();
  }

  debug(area: string, message: string): void {
    this.log('debug', area, message);
  }
  info(area: string, message: string): void {
    this.log('info', area, message);
  }
  warn(area: string, message: string): void {
    this.log('warn', area, message);
  }
  error(area: string, message: string): void {
    this.log('error', area, message);
  }

  /** Stable array (new identity only when the log changes), for `useSyncExternalStore`. */
  entries = (): readonly LogEntry[] => this.buf;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  clear(): void {
    this.buf = [];
    for (const l of this.listeners) l();
  }
}

const SECRET_PARAM =
  /([?&#;\s"'(,{]|^)(token|authToken|password|passwd|pwd|pass|passphrase|pin|id_token|access_token|refresh_token|ticket|state|key|secret|seed|totpSeed|code|guac-totp|SAMLResponse)(["']?\s*[=:]\s*["']?)([^&\s"',;})]+)/gi;
/** "password is hunter2", "token was abc": prose that a careless message might contain. */
const SECRET_PROSE =
  /\b(password|passphrase|passwd|token|secret|seed|pin)(\s+(?:is|was|=)\s+)(["']?)([^\s"',;]+)/gi;
const TOKEN_HEADER =
  /(Guacamole-Token|Authorization|Guacamole-Tunnel-Token)(\s*[:=]\s*)((?:Bearer|Basic|Token|Digest)\s+)?(\S+)/gi;
const BEARER = /\b(Bearer|Basic)(\s+)([A-Za-z0-9._~+/=-]{6,})/g;
/** `scheme://user:password@host`: keep the user name, drop the password. */
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)([^/\s@:]*):([^/\s@]+)@/gi;
const OTPAUTH = /otpauth:\/\/\S+/gi;
/** Long opaque runs (hex tokens, base64, JWTs). */
const OPAQUE = /\b[A-Za-z0-9_-]{32,}(\.[A-Za-z0-9_-]{8,}){0,2}\b/g;

/** Removes values that look like credentials. Always applied. */
export function redactSecrets(text: string): string {
  return text
    .replace(OTPAUTH, 'otpauth://[redacted]')
    .replace(URL_USERINFO, '$1$2:[redacted]@')
    .replace(TOKEN_HEADER, '$1$2$3[redacted]')
    .replace(BEARER, '$1$2[redacted]')
    .replace(SECRET_PARAM, '$1$2$3[redacted]')
    .replace(SECRET_PROSE, '$1$2$3[redacted]')
    .replace(OPAQUE, '[redacted]');
}

const URL_HOST = /\b([a-z][a-z0-9+.-]*:\/\/)(\[[^\]]+\]|[^/\s:?#]+)/gi;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
/**
 * IPv6 candidates, full or compressed (`fe80::1`, `::1`, `2001:db8::5%en0`). The leading
 * delimiter is captured instead of using a lookbehind, which iOS 15–16.3 WebViews cannot
 * parse (a regex literal that fails to parse would stop the whole bundle loading).
 */
const IPV6 = /(^|[^0-9a-z:.])([0-9a-f:]*:[0-9a-f:]*[0-9a-f:](?:%[\w.]+)?)(?![0-9a-z:])/gi;

function looksLikeIpv6(m: string): boolean {
  const addr = m.split('%')[0] ?? '';
  const colons = (addr.match(/:/g) ?? []).length;
  if (addr.includes(':::') || colons < 2 || colons > 7) return false;
  // `::` compression, or hex letters (not a clock time like 12:30:45), or a full address.
  return addr.includes('::') || /[a-f]/i.test(addr) || colons === 7;
}
const HOSTNAME = /\b(?:[a-z0-9-]+\.)+(?:[a-z]{2,63}|ts\.net)\b/gi;

/** Also hides host names and IP addresses (optional, on by default when exporting). */
export function redactHosts(text: string): string {
  return text
    .replace(URL_HOST, '$1<host>')
    .replace(IPV4, '<ip>')
    .replace(IPV6, (m, lead: string, addr: string) => (looksLikeIpv6(addr) ? `${lead}<ip>` : m))
    .replace(HOSTNAME, (m) => (/^\d+(\.\d+)+$/.test(m) ? m : '<host>'));
}

export interface FormatOptions {
  readonly hideHosts: boolean;
  /** Lowest level to include. */
  readonly minLevel?: LogLevel;
}

export function filterByLevel(entries: readonly LogEntry[], minLevel: LogLevel): LogEntry[] {
  const min = LOG_LEVELS.indexOf(minLevel);
  return entries.filter((e) => LOG_LEVELS.indexOf(e.level) >= min);
}

export function formatEntry(e: LogEntry, hideHosts: boolean): string {
  const time = new Date(e.at).toISOString();
  const msg = redactSecrets(e.message);
  return `${time} ${e.level.toUpperCase().padEnd(5)} [${e.area}] ${hideHosts ? redactHosts(msg) : msg}`;
}

export function formatLog(entries: readonly LogEntry[], options: FormatOptions): string {
  const list = options.minLevel ? filterByLevel(entries, options.minLevel) : entries;
  return list.map((e) => formatEntry(e, options.hideHosts)).join('\n');
}
