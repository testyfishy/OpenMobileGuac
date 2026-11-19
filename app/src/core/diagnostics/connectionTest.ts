import { GuacApiError, type GuacErrorInfo } from '../api/errors.ts';
import { buildTunnelUrls } from '../api/tunnel.ts';
import { HttpTransportError, type HttpClient } from '../http/HttpClient.ts';
import { isRecord } from '../models/json.ts';
import { joinUrl, normalizeServerUrl } from '../url/normalizeServerUrl.ts';

/**
 * "Test connection" diagnostics for a server (DIAG-1, SRV-2): which candidate URL worked,
 * whether the REST API answers, whether the WebSocket tunnel endpoint accepts a connection
 * from this WebView, and the round-trip time. Sends no credentials.
 */

export type StepStatus = 'ok' | 'fail' | 'skipped';

export interface CandidateResult {
  readonly baseUrl: string;
  readonly status: StepStatus;
  /** Why it failed (`unreachable`, `tls`, `not-guacamole`, `timeout`). */
  readonly failure?: GuacErrorInfo['kind'] | 'timeout';
  readonly httpStatus?: number;
  readonly ms?: number;
}

export interface ConnectionTestResult {
  readonly input: string;
  readonly candidates: readonly CandidateResult[];
  /** The first candidate whose API answered. */
  readonly workingUrl?: string;
  readonly api: StepStatus;
  readonly websocket: StepStatus;
  readonly websocketDetail?: 'error' | 'timeout' | 'closed';
  /** Best of a few `GET api/languages` round trips, ms. */
  readonly latencyMs?: number;
  /** Set when the input could not be parsed. */
  readonly invalid?: boolean;
}

/** The subset of `WebSocket` the probe uses, so tests can fake it. */
export interface WebSocketLike {
  onopen: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  close(): void;
}
export type WebSocketFactory = (url: string) => WebSocketLike;

export interface ConnectionTestDeps {
  readonly http: HttpClient;
  readonly openWebSocket?: WebSocketFactory;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly latencySamples?: number;
}

function failureOf(err: unknown): CandidateResult['failure'] {
  if (err instanceof HttpTransportError) {
    return err.kind === 'tls' ? 'tls' : err.kind === 'timeout' ? 'timeout' : 'unreachable';
  }
  if (err instanceof GuacApiError) return err.info.kind;
  return 'unreachable';
}

/** Opens the tunnel endpoint without parameters and reports whether the socket opened. */
export function probeWebSocket(
  url: string,
  open: WebSocketFactory,
  timeoutMs: number,
): Promise<{ status: StepStatus; detail?: 'error' | 'timeout' | 'closed' }> {
  return new Promise((resolve) => {
    let done = false;
    let ws: WebSocketLike | undefined;
    const finish = (r: { status: StepStatus; detail?: 'error' | 'timeout' | 'closed' }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        // already closed
      }
      resolve(r);
    };
    const timer = setTimeout(() => finish({ status: 'fail', detail: 'timeout' }), timeoutMs);
    try {
      ws = open(url);
    } catch {
      finish({ status: 'fail', detail: 'error' });
      return;
    }
    ws.onopen = () => finish({ status: 'ok' });
    ws.onerror = () => finish({ status: 'fail', detail: 'error' });
    ws.onclose = () => finish({ status: 'fail', detail: 'closed' });
  });
}

export async function runConnectionTest(
  input: string,
  deps: ConnectionTestDeps,
): Promise<ConnectionTestResult> {
  const now = deps.now ?? (() => Date.now());
  const timeoutMs = deps.timeoutMs ?? 6000;
  const normalized = normalizeServerUrl(input);
  if (!normalized.ok) {
    return { input, candidates: [], api: 'skipped', websocket: 'skipped', invalid: true };
  }
  const candidates: CandidateResult[] = [];
  let workingUrl: string | undefined;
  for (const c of normalized.candidates) {
    if (workingUrl) {
      candidates.push({ baseUrl: c.baseUrl, status: 'skipped' });
      continue;
    }
    const started = now();
    try {
      const res = await deps.http.request({
        method: 'GET',
        url: joinUrl(c.baseUrl, 'api/languages'),
        timeoutMs,
      });
      const ms = now() - started;
      if (res.status === 200 && isRecord(res.body)) {
        workingUrl = c.baseUrl;
        candidates.push({ baseUrl: c.baseUrl, status: 'ok', httpStatus: res.status, ms });
      } else {
        candidates.push({
          baseUrl: c.baseUrl,
          status: 'fail',
          failure: 'not-guacamole',
          httpStatus: res.status,
          ms,
        });
      }
    } catch (err) {
      candidates.push({
        baseUrl: c.baseUrl,
        status: 'fail',
        failure: failureOf(err),
        ms: now() - started,
      });
    }
  }
  if (!workingUrl) {
    return { input, candidates, api: 'fail', websocket: 'skipped' };
  }

  let latencyMs: number | undefined = candidates.find((c) => c.status === 'ok')?.ms;
  for (let i = 1; i < (deps.latencySamples ?? 3); i++) {
    const started = now();
    try {
      await deps.http.request({
        method: 'GET',
        url: joinUrl(workingUrl, 'api/languages'),
        timeoutMs,
      });
      const ms = now() - started;
      latencyMs = latencyMs === undefined ? ms : Math.min(latencyMs, ms);
    } catch {
      break;
    }
  }

  let websocket: StepStatus = 'skipped';
  let websocketDetail: ConnectionTestResult['websocketDetail'];
  if (deps.openWebSocket) {
    const ws = await probeWebSocket(
      buildTunnelUrls(workingUrl).websocket,
      deps.openWebSocket,
      timeoutMs,
    );
    websocket = ws.status;
    websocketDetail = ws.detail;
  }
  return {
    input,
    candidates,
    workingUrl,
    api: 'ok',
    websocket,
    ...(websocketDetail ? { websocketDetail } : {}),
    ...(latencyMs !== undefined ? { latencyMs } : {}),
  };
}
