import { describe, expect, it } from 'vitest';
import {
  MAX_DISTINCT_VIOLATIONS,
  blockedOrigin,
  describeViolation,
  recordCspViolations,
  type ViolationLike,
} from './cspViolations.ts';
import { Logger, redactHosts } from './log.ts';

describe('blockedOrigin', () => {
  it('keeps the origin only, never path, query or credentials', () => {
    const s = blockedOrigin('https://user:pw@guac.example.test:8443/api/tokens?token=SECRET123#x');
    expect(s).toBe('https://guac.example.test:8443');
    expect(blockedOrigin('wss://10.0.0.5/guacamole/websocket-tunnel?token=abc')).toBe(
      'wss://10.0.0.5',
    );
  });

  it('reduces data:, blob: and keywords to a short name', () => {
    expect(blockedOrigin('data')).toBe('data:');
    expect(blockedOrigin('data:image/png;base64,AAAA')).toBe('data:');
    expect(blockedOrigin('blob')).toBe('blob:');
    expect(blockedOrigin('blob:https://localhost/1b2c-uuid')).toBe('blob:');
    expect(blockedOrigin('inline')).toBe('inline');
    expect(blockedOrigin('eval')).toBe('eval');
    expect(blockedOrigin('')).toBe('unknown');
    expect(blockedOrigin(undefined)).toBe('unknown');
    expect(blockedOrigin('not a url at all')).toBe('unknown');
  });
});

describe('describeViolation', () => {
  it('names the directive, not its source list', () => {
    const e: ViolationLike = {
      violatedDirective: "img-src 'self' data:",
      blockedURI: 'https://cdn.example.test/a.png?sig=abc',
    };
    expect(describeViolation(e)).toBe('CSP blocked img-src: https://cdn.example.test');
    // Exported with "hide hosts": the origin goes, the rest of the line stays readable.
    expect(redactHosts(describeViolation(e))).toBe('CSP blocked img-src: https://<host>');
    expect(describeViolation({ effectiveDirective: 'script-src-elem', blockedURI: 'inline' })).toBe(
      'CSP blocked script-src-elem: inline',
    );
    expect(describeViolation({ disposition: 'report' })).toBe('CSP report-only unknown: unknown');
  });
});

function fakeTarget() {
  let fn: ((e: ViolationLike) => void) | undefined;
  return {
    addEventListener(_type: 'securitypolicyviolation', f: (e: ViolationLike) => void) {
      fn = f;
    },
    fire(e: ViolationLike) {
      fn?.(e);
    },
  };
}

describe('recordCspViolations', () => {
  it('buffers until a log is attached, then logs at warn level', () => {
    const t = fakeTarget();
    const rec = recordCspViolations(t);
    t.fire({ effectiveDirective: 'connect-src', blockedURI: 'data:text/plain,token=abc' });
    const log = new Logger();
    rec.attach(log);
    t.fire({ effectiveDirective: 'style-src-attr', blockedURI: 'inline' });
    expect(log.entries().map((e) => [e.level, e.area, e.message])).toEqual([
      ['warn', 'csp', 'CSP blocked connect-src: data:'],
      ['warn', 'csp', 'CSP blocked style-src-attr: inline'],
    ]);
  });

  it('does not flood the log with repeats or many kinds', () => {
    const t = fakeTarget();
    const log = new Logger();
    recordCspViolations(t).attach(log);
    for (let i = 0; i < 1000; i++)
      t.fire({ effectiveDirective: 'img-src', blockedURI: 'https://a.test/x' });
    expect(log.entries().map((e) => e.message)).toEqual([
      'CSP blocked img-src: https://a.test',
      'CSP blocked img-src: https://a.test x10',
      'CSP blocked img-src: https://a.test x100',
      'CSP blocked img-src: https://a.test x1000',
    ]);
    for (let i = 0; i < MAX_DISTINCT_VIOLATIONS + 10; i++) {
      t.fire({ effectiveDirective: 'img-src', blockedURI: `https://h${i}.test/` });
    }
    const n = log.entries().length;
    expect(n).toBe(4 + MAX_DISTINCT_VIOLATIONS - 1 + 1);
    expect(log.entries().at(-1)?.message).toContain('not logging more');
  });
});
