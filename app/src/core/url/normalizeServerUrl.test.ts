import { describe, expect, it } from 'vitest';
import {
  joinUrl,
  normalizeServerUrl,
  sameServerEndpoint,
  serverEndpoint,
} from './normalizeServerUrl.ts';

function urls(input: string): string[] {
  const r = normalizeServerUrl(input);
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
  return r.candidates.map((c) => c.baseUrl);
}

describe('normalizeServerUrl', () => {
  it('tries https then http, with and without /guacamole, for a bare host', () => {
    expect(urls('guac.example')).toEqual([
      'https://guac.example/guacamole',
      'https://guac.example',
      'http://guac.example/guacamole',
      'http://guac.example',
    ]);
  });

  it('marks http candidates as insecure', () => {
    const r = normalizeServerUrl('guac.example/guacamole');
    expect(r.ok && r.candidates.map((c) => c.secure)).toEqual([true, false]);
  });

  it('keeps an explicit scheme only', () => {
    expect(urls('http://guac.example:8080')).toEqual([
      'http://guac.example:8080/guacamole',
      'http://guac.example:8080',
    ]);
    expect(urls('HTTPS://Guac.Example/guacamole')).toEqual(['https://guac.example/guacamole']);
  });

  it('accepts host:port without a scheme', () => {
    expect(urls('guac.example:8080/guacamole/')).toEqual([
      'https://guac.example:8080/guacamole',
      'http://guac.example:8080/guacamole',
    ]);
    expect(urls('localhost:8080')[0]).toBe('https://localhost:8080/guacamole');
  });

  it('strips trailing slashes, query, fragment and index.html', () => {
    expect(urls('https://guac.example/guacamole/')).toEqual(['https://guac.example/guacamole']);
    expect(urls('https://guac.example/guacamole/#/client/abc')).toEqual([
      'https://guac.example/guacamole',
    ]);
    expect(urls('https://guac.example/guacamole/index.html?x=1')).toEqual([
      'https://guac.example/guacamole',
    ]);
    expect(urls('  https://guac.example/guacamole//  ')).toEqual([
      'https://guac.example/guacamole',
    ]);
  });

  it('tries a custom context path both with and without /guacamole appended', () => {
    expect(urls('https://guac.example/remote/')).toEqual([
      'https://guac.example/remote/guacamole',
      'https://guac.example/remote',
    ]);
  });

  it('treats /guacamole case-insensitively but preserves the typed case', () => {
    expect(urls('https://guac.example/Guacamole')).toEqual(['https://guac.example/Guacamole']);
  });

  it('drops default ports', () => {
    expect(urls('https://guac.example:443/guacamole')).toEqual(['https://guac.example/guacamole']);
  });

  it('handles IPv6 literals', () => {
    expect(urls('http://[2001:db8::1]:8080/guacamole')).toEqual([
      'http://[2001:db8::1]:8080/guacamole',
    ]);
  });

  it('brackets a bare IPv6 address (AUDIT #16)', () => {
    expect(urls('fe80::1')).toEqual([
      'https://[fe80::1]/guacamole',
      'https://[fe80::1]',
      'http://[fe80::1]/guacamole',
      'http://[fe80::1]',
    ]);
    expect(urls('::1/guacamole')).toEqual(['https://[::1]/guacamole', 'http://[::1]/guacamole']);
    expect(urls('2001:db8::10')[0]).toBe('https://[2001:db8::10]/guacamole');
    expect(urls('[fe80::1]:8080')[0]).toBe('https://[fe80::1]:8080/guacamole');
    // Not an IPv6 literal and not a scheme: "invalid", never "only http(s)".
    expect(normalizeServerUrl('fe80::zz')).toEqual({ ok: false, reason: 'invalid' });
    expect(normalizeServerUrl('host:1:2')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects empty, invalid and unsupported input', () => {
    expect(normalizeServerUrl('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(normalizeServerUrl('ftp://guac.example')).toEqual({
      ok: false,
      reason: 'unsupported-scheme',
    });
    expect(normalizeServerUrl('mailto:someone')).toEqual({
      ok: false,
      reason: 'unsupported-scheme',
    });
    expect(normalizeServerUrl('https://')).toEqual({ ok: false, reason: 'invalid' });
    expect(normalizeServerUrl('https://user:pw@guac.example')).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });
});

describe('joinUrl', () => {
  it('joins with exactly one slash', () => {
    expect(joinUrl('https://guac.example/guacamole', 'api/tokens')).toBe(
      'https://guac.example/guacamole/api/tokens',
    );
    expect(joinUrl('https://guac.example/', '/api/tokens')).toBe('https://guac.example/api/tokens');
  });
});

describe('serverEndpoint', () => {
  it('compares scheme, host, port and path, ignoring case of host and trailing slashes', () => {
    expect(serverEndpoint('https://Guac.Example:443/guacamole/')).toBe(
      'https://guac.example/guacamole',
    );
    expect(
      sameServerEndpoint('https://guac.example/guacamole', 'https://GUAC.example/guacamole/'),
    ).toBe(true);
    expect(
      sameServerEndpoint('https://guac.example/guacamole', 'http://guac.example/guacamole'),
    ).toBe(false);
    expect(
      sameServerEndpoint('https://guac.example/guacamole', 'https://guac.example:8443/guacamole'),
    ).toBe(false);
    expect(
      sameServerEndpoint('https://guac.example/guacamole', 'https://guac.example/remote'),
    ).toBe(false);
    expect(
      sameServerEndpoint('https://guac.example/guacamole', 'https://other.example/guacamole'),
    ).toBe(false);
  });
});
