/**
 * Records Content-Security-Policy violations in the local diagnostics log (DIAG-1), so a
 * device test can see at once whether the release policy (core/security/csp.ts) blocked
 * something. Read-only: it only listens, and cannot change or relax the policy.
 *
 * Only the directive and the blocked origin or keyword are kept: never the full URL (query
 * strings can carry tokens), the code sample or the source file path.
 */

import type { Logger } from './log.ts';

/** The fields of a `SecurityPolicyViolationEvent` this module reads. */
export interface ViolationLike {
  readonly effectiveDirective?: string;
  readonly violatedDirective?: string;
  readonly blockedURI?: string;
  readonly disposition?: string;
}

/** Most distinct violations kept per run; repeats are counted, not logged again. */
export const MAX_DISTINCT_VIOLATIONS = 20;

const KEYWORDS = new Set(['inline', 'eval', 'wasm-eval', 'self', 'trusted-types-policy']);

/** Reduces a blocked URI to a keyword, a scheme (`data:`, `blob:`) or an origin. */
export function blockedOrigin(raw: string | undefined): string {
  const value = (raw ?? '').trim();
  if (value.length === 0) return 'unknown';
  const lower = value.toLowerCase();
  if (KEYWORDS.has(lower)) return lower;
  // Chromium reports a bare scheme ("data", "blob") for these.
  if (/^[a-z][a-z0-9+.-]*$/.test(lower)) return `${lower}:`;
  try {
    const url = new URL(value);
    // Opaque origins (data:, blob: of an opaque page, custom schemes): scheme only.
    if (url.origin === 'null' || url.host.length === 0) return url.protocol;
    return url.origin;
  } catch {
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value);
    return scheme ? `${(scheme[1] ?? '').toLowerCase()}:` : 'unknown';
  }
}

function directiveName(e: ViolationLike): string {
  const d = (e.effectiveDirective || e.violatedDirective || 'unknown').trim();
  // Only the directive name, never its source list.
  return (d.split(/\s+/)[0] ?? 'unknown').replace(/[^a-z-]/gi, '') || 'unknown';
}

/** One log line for a violation. */
export function describeViolation(e: ViolationLike): string {
  const mode = e.disposition === 'report' ? 'report-only' : 'blocked';
  // Origin last and unbracketed: the host redaction on export would swallow a bracket.
  return `CSP ${mode} ${directiveName(e)}: ${blockedOrigin(e.blockedURI)}`;
}

interface ViolationTarget {
  addEventListener(type: 'securitypolicyviolation', fn: (e: ViolationLike) => void): void;
}

export interface CspViolationRecorder {
  /** Sends buffered and future violations to `log`. */
  attach(log: Pick<Logger, 'warn'>): void;
}

/**
 * Starts listening at once (call at module load, before anything else runs) and buffers
 * until a logger is attached.
 */
export function recordCspViolations(target: ViolationTarget): CspViolationRecorder {
  const seen = new Map<string, number>();
  const pending: string[] = [];
  let log: Pick<Logger, 'warn'> | undefined;
  let dropped = false;

  const emit = (line: string) => {
    if (log) log.warn('csp', line);
    else pending.push(line);
  };

  target.addEventListener('securitypolicyviolation', (e) => {
    const line = describeViolation(e);
    const count = (seen.get(line) ?? 0) + 1;
    if (count === 1 && seen.size >= MAX_DISTINCT_VIOLATIONS) {
      if (!dropped)
        emit(`CSP: more than ${MAX_DISTINCT_VIOLATIONS} kinds of violation, not logging more`);
      dropped = true;
      return;
    }
    seen.set(line, count);
    // First occurrence, then at 10, 100, 1000... so a repeating one cannot flood the log.
    if (count === 1) emit(line);
    else if (/^10+$/.test(String(count))) emit(`${line} x${count}`);
  });

  return {
    attach(l) {
      log = l;
      for (const line of pending.splice(0)) l.warn('csp', line);
    },
  };
}
