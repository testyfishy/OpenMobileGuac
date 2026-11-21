import { describe, expect, it } from 'vitest';
import indexHtml from '../../../index.html?raw';
import { RELEASE_CSP, cspMetaTag, injectCspMeta, serializeCsp } from './csp.ts';

function parse(policy: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) out.set(name, sources);
  }
  return out;
}

describe('release CSP', () => {
  const policy = serializeCsp();
  const d = parse(policy);

  it('has the required restrictive directives', () => {
    expect(d.get('default-src')).toEqual(["'self'", 'capacitor://localhost']);
    expect(d.get('script-src')).toEqual(["'self'", 'capacitor://localhost']);
    expect(d.get('object-src')).toEqual(["'none'"]);
    expect(d.get('base-uri')).toEqual(["'none'"]);
    expect(d.get('form-action')).toEqual(["'none'"]);
    expect(d.get('frame-src')).toEqual(["'none'"]);
    expect(d.get('worker-src')).toEqual(["'none'"]);
  });

  it('allows no eval and no inline script or style element', () => {
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toContain("'wasm-unsafe-eval'");
    // Inline is allowed for style attributes only (they cannot run script).
    for (const [name, sources] of d) {
      if (name !== 'style-src-attr') expect(sources, name).not.toContain("'unsafe-inline'");
    }
    expect(d.get('style-src-attr')).toEqual(["'unsafe-inline'"]);
    expect(policy).not.toContain("'unsafe-hashes'");
    expect(policy).not.toContain("'strict-dynamic'");
    for (const [name, sources] of d) {
      // No wildcard anywhere, and scheme sources only where user servers need them.
      expect(sources, name).not.toContain('*');
      if (name !== 'connect-src') {
        expect(
          sources.filter((s) => /^(https?|wss?):$/.test(s)),
          name,
        ).toEqual([]);
      }
    }
    expect(d.get('script-src')).not.toContain('data:');
    expect(d.get('script-src')).not.toContain('blob:');
  });

  it('lets sessions reach any user server but nothing else', () => {
    expect(d.get('connect-src')).toEqual([
      "'self'",
      'capacitor://localhost',
      'https:',
      'wss:',
      'http:',
      'ws:',
    ]);
    expect(d.get('img-src')).toEqual(["'self'", 'capacitor://localhost', 'data:', 'blob:']);
    expect(d.get('media-src')).toEqual(["'self'", 'capacitor://localhost']);
  });

  it('serialises every directive once', () => {
    expect([...d.keys()]).toEqual(Object.keys(RELEASE_CSP));
    // Directives a meta policy ignores would only mislead a reader.
    for (const ignored of ['frame-ancestors', 'report-uri', 'report-to', 'sandbox']) {
      expect(d.has(ignored)).toBe(false);
    }
  });

  it('refuses characters that would break out of the attribute', () => {
    expect(() => cspMetaTag(`default-src 'self'" onload="x`)).toThrow();
    expect(() => cspMetaTag(`default-src <x>`)).toThrow();
  });
});

describe('injectCspMeta on app/index.html', () => {
  const out = injectCspMeta(indexHtml);

  it('adds exactly one policy meta, right after the charset', () => {
    expect(out.match(/http-equiv="Content-Security-Policy"/g)).toHaveLength(1);
    expect(out).toContain(`content="${serializeCsp()}"`);
    const charset = out.indexOf('<meta charset');
    const csp = out.indexOf('Content-Security-Policy');
    expect(charset).toBeGreaterThan(0);
    expect(csp).toBeGreaterThan(charset);
    expect(out.slice(charset, csp)).not.toContain('<script');
    expect(csp).toBeLessThan(out.indexOf('<script'));
  });

  it('keeps a bare <head> before the policy (Capacitor inline-bridge fallback)', () => {
    // JSInjector inserts its inline <script> right after the literal "<head>"; that only
    // stays outside the meta policy while <head> is bare and comes first.
    const head = out.indexOf('<head>');
    expect(head).toBeGreaterThan(0);
    expect(head).toBeLessThan(out.indexOf('Content-Security-Policy'));
  });

  it('refuses documents the fallback would break on, or a second policy', () => {
    expect(() => injectCspMeta(indexHtml.replace('<head>', '<head data-x="1">'))).toThrow(
      /bare <head>/,
    );
    expect(() => injectCspMeta(out)).toThrow(/already/);
    expect(() => injectCspMeta('<html><head></head></html>')).toThrow(/charset/);
  });
});
