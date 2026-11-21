import type { Logger } from '../diagnostics/log.ts';
import { describeUrl } from '../diagnostics/LoggingHttpClient.ts';
import {
  DEFAULT_TIMEOUT_MS,
  HttpTransportError,
  withQuery,
  type HttpClient,
  type HttpRequest,
  type HttpResponse,
} from './HttpClient.ts';

/**
 * Sits in front of the real HTTP client and keeps the REST traffic to each server small, so
 * badges and permission lookups never delay sign-in, the connection list or a tunnel:
 *
 * - **One in-flight request per GET.** Identical GET/HEAD requests (same URL, query and
 *   headers, so the same token) that start while one is running share its answer.
 * - **A short cache** (`cacheMs`, a few seconds) for the lookups several screens make at once:
 *   `self/effectivePermissions` and `connections/{id}` (successful answers only). Any other
 *   method to the same server (a sign-out, an admin change, ending a session) drops the
 *   cached answers for that server, and stops sharing reads already in flight, when it
 *   starts and again when it ends.
 * - A foreground caller that joins a shared GET still queued as background promotes it.
 * - **A limit per server**: at most `maxPerOrigin` requests at a time, of which at most
 *   `maxBackgroundPerOrigin` with `priority: 'background'`; a waiting foreground request is
 *   always sent before a waiting background one.
 * - **A hard deadline** in JavaScript: native timeouts are idle timeouts (a request that
 *   trickles never ends); after `timeoutMs` + `deadlineGraceMs` the caller gets a `timeout`
 *   transport error. Nothing is retried here.
 */
export interface RequestCoordinatorOptions {
  readonly maxPerOrigin?: number;
  readonly maxBackgroundPerOrigin?: number;
  readonly cacheMs?: number;
  readonly deadlineGraceMs?: number;
  /** Which successful GET answers may be cached (by URL path). */
  readonly cacheable?: (path: string) => boolean;
  readonly now?: () => number;
  readonly log?: Pick<Logger, 'debug'>;
}

export const DEFAULT_MAX_PER_ORIGIN = 4;
export const DEFAULT_MAX_BACKGROUND_PER_ORIGIN = 2;
export const DEFAULT_CACHE_MS = 4000;
export const DEFAULT_DEADLINE_GRACE_MS = 3000;

/** `…/self/effectivePermissions` and `…/connections/{id}` (not its sub-resources). */
export function defaultCacheable(path: string): boolean {
  return /\/self\/effectivePermissions$/.test(path) || /\/connections\/[^/]+$/.test(path);
}

interface Waiter {
  /** Cleared when a foreground caller joins a queued background request. */
  background: boolean;
  readonly start: () => void;
}

interface OriginState {
  active: number;
  activeBackground: number;
  readonly waiting: Waiter[];
}

interface CacheEntry {
  readonly at: number;
  readonly origin: string;
  readonly res: HttpResponse;
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** Identity of a GET/HEAD: method, URL with query, and every header (the token included). */
function sharedKey(req: HttpRequest): string | undefined {
  if ((req.method !== 'GET' && req.method !== 'HEAD') || req.body) return undefined;
  const headers = Object.entries(req.headers ?? {})
    .map(([k, v]) => [k.toLowerCase(), v] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `${req.method} ${withQuery(req.url, req.query)} ${JSON.stringify(headers)}`;
}

export class RequestCoordinator implements HttpClient {
  private readonly inner: HttpClient;
  private readonly maxPerOrigin: number;
  private readonly maxBackground: number;
  private readonly cacheMs: number;
  private readonly graceMs: number;
  private readonly cacheable: (path: string) => boolean;
  private readonly now: () => number;
  private readonly log: Pick<Logger, 'debug'> | undefined;
  private readonly origins = new Map<string, OriginState>();
  private readonly inFlight = new Map<
    string,
    { readonly p: Promise<HttpResponse>; readonly origin: string }
  >();
  /** Shared GETs still waiting for a slot, by key (to promote them). */
  private readonly queued = new Map<string, Waiter>();
  private readonly cache = new Map<string, CacheEntry>();

  constructor(inner: HttpClient, options: RequestCoordinatorOptions = {}) {
    this.inner = inner;
    this.maxPerOrigin = Math.max(1, options.maxPerOrigin ?? DEFAULT_MAX_PER_ORIGIN);
    this.maxBackground = Math.max(
      1,
      Math.min(
        this.maxPerOrigin,
        options.maxBackgroundPerOrigin ?? DEFAULT_MAX_BACKGROUND_PER_ORIGIN,
      ),
    );
    this.cacheMs = options.cacheMs ?? DEFAULT_CACHE_MS;
    this.graceMs = options.deadlineGraceMs ?? DEFAULT_DEADLINE_GRACE_MS;
    this.cacheable = options.cacheable ?? defaultCacheable;
    this.now = options.now ?? (() => Date.now());
    this.log = options.log;
  }

  /** Requests sent and not yet answered, over all servers. */
  get activeCount(): number {
    let n = 0;
    for (const s of this.origins.values()) n += s.active;
    return n;
  }

  /** Drops every cached answer (for example after signing out). */
  clearCache(): void {
    this.cache.clear();
  }

  request(req: HttpRequest): Promise<HttpResponse> {
    const origin = originOf(req.url);
    const key = sharedKey(req);
    if (key === undefined) {
      // A write or sign-out: what was cached or is being read for this server may be wrong
      // now, and again once it is done.
      this.forget(origin);
      const p = this.send(req, origin, undefined);
      const after = () => this.forget(origin);
      p.then(after, after);
      return p;
    }
    const cached = this.cache.get(key);
    if (cached) {
      const age = this.now() - cached.at;
      if (age >= 0 && age < this.cacheMs) {
        this.log?.debug(
          'http',
          `${req.method} ${describeUrl(req.url)} answered from cache (${age} ms old)`,
        );
        return Promise.resolve(cached.res);
      }
      this.cache.delete(key);
    }
    const running = this.inFlight.get(key);
    if (running) {
      this.log?.debug(
        'http',
        `${req.method} ${describeUrl(req.url)} shared with the one in flight`,
      );
      // Someone now waits for a request that was queued as background: it moves up.
      const queued = this.queued.get(key);
      if (queued && queued.background && req.priority !== 'background') {
        queued.background = false;
        this.pump(origin, this.state(origin));
      }
      return running.p;
    }
    const p = this.send(req, origin, key).then((res) => {
      // Not cached when a write to this server started meanwhile (the entry is gone).
      const stillCurrent = this.inFlight.get(key)?.p === p;
      if (
        stillCurrent &&
        res.status === 200 &&
        this.cacheMs > 0 &&
        this.cacheable(pathOf(req.url))
      ) {
        this.sweep();
        this.cache.set(key, { at: this.now(), origin, res });
      }
      return res;
    });
    this.inFlight.set(key, { p, origin });
    const clear = () => {
      if (this.inFlight.get(key)?.p === p) this.inFlight.delete(key);
    };
    p.then(clear, clear);
    return p;
  }

  /** Drops cached answers and stops sharing in-flight reads for one server. */
  private forget(origin: string): void {
    for (const [k, e] of this.cache) if (e.origin === origin) this.cache.delete(k);
    for (const [k, e] of this.inFlight) if (e.origin === origin) this.inFlight.delete(k);
  }

  /** Removes expired entries (their keys carry tokens of sessions that may be gone). */
  private sweep(): void {
    const now = this.now();
    for (const [k, e] of this.cache) if (now - e.at >= this.cacheMs) this.cache.delete(k);
  }

  private state(origin: string): OriginState {
    let s = this.origins.get(origin);
    if (!s) {
      s = { active: 0, activeBackground: 0, waiting: [] };
      this.origins.set(origin, s);
    }
    return s;
  }

  private canStart(s: OriginState, background: boolean): boolean {
    if (s.active >= this.maxPerOrigin) return false;
    return !background || s.activeBackground < this.maxBackground;
  }

  private send(req: HttpRequest, origin: string, key: string | undefined): Promise<HttpResponse> {
    const s = this.state(origin);
    // For a foreground caller the deadline counts from the call, time spent waiting for a
    // slot included (a sign-in spinner must not wait behind a stuck server twice). Background
    // reads (badges) keep the full deadline once sent: late is fine for them.
    const deadline = (req.timeoutMs ?? DEFAULT_TIMEOUT_MS) + this.graceMs;
    const enqueuedAt = this.now();
    const timedOut = () =>
      new HttpTransportError(
        'timeout',
        req.url,
        `No answer within ${Math.round(deadline / 1000)} s`,
      );
    return new Promise<HttpResponse>((resolve, reject) => {
      let queueTimer: ReturnType<typeof setTimeout> | undefined;
      const waiter: Waiter = {
        background: req.priority === 'background',
        start: () => {
          clearTimeout(queueTimer);
          if (key !== undefined && this.queued.get(key) === waiter) this.queued.delete(key);
          // Read at start: a queued background request may have been promoted.
          const background = waiter.background;
          s.active++;
          if (background) s.activeBackground++;
          let done = false;
          const finish = () => {
            if (done) return false;
            done = true;
            clearTimeout(timer);
            s.active--;
            if (background) s.activeBackground--;
            this.pump(origin, s);
            return true;
          };
          const left = queueTimer ? Math.max(1, enqueuedAt + deadline - this.now()) : deadline;
          const timer = setTimeout(() => {
            if (!finish()) return;
            reject(timedOut());
          }, left);
          let sent: Promise<HttpResponse>;
          try {
            sent = this.inner.request(req);
          } catch (err) {
            sent = Promise.reject(err instanceof Error ? err : new Error(String(err)));
          }
          sent.then(
            (res) => {
              if (finish()) resolve(res);
            },
            (err: unknown) => {
              if (finish()) reject(err instanceof Error ? err : new Error(String(err)));
            },
          );
        },
      };
      // Foreground requests never wait behind queued background ones.
      const queuedAhead = s.waiting.some((w) => !w.background || waiter.background);
      if (!queuedAhead && this.canStart(s, waiter.background)) {
        waiter.start();
      } else {
        s.waiting.push(waiter);
        if (key !== undefined) this.queued.set(key, waiter);
        // A foreground request still without a slot at the deadline: the caller gets its
        // answer, nothing is sent.
        if (!waiter.background) {
          queueTimer = setTimeout(() => {
            const i = s.waiting.indexOf(waiter);
            if (i < 0) return;
            s.waiting.splice(i, 1);
            if (key !== undefined && this.queued.get(key) === waiter) this.queued.delete(key);
            reject(timedOut());
            this.pump(origin, s);
          }, deadline);
        }
      }
    });
  }

  private pump(origin: string, s: OriginState): void {
    for (;;) {
      const fg = s.waiting.findIndex((w) => !w.background);
      const pick =
        fg >= 0 && this.canStart(s, false)
          ? fg
          : s.waiting.findIndex((w) => w.background && this.canStart(s, true));
      if (pick < 0) break;
      const [w] = s.waiting.splice(pick, 1);
      w?.start();
    }
    if (s.active === 0 && s.waiting.length === 0) this.origins.delete(origin);
  }
}
