import { describe, expect, it } from 'vitest';
import { en } from './en.ts';
import { es } from './es.ts';
import { matchLocale, parseLanguagePreference, resolveLocale } from './locale.ts';
import { sessionEs } from './session.es.ts';
import { sessionStrings, sessionStringsEn } from '../session/sessionStrings.ts';
import { setActiveLocale } from '../strings.ts';

describe('locale selection', () => {
  it('uses the first supported device language', () => {
    expect(matchLocale(['fr-FR', 'es-MX', 'en'])).toBe('es');
    expect(matchLocale(['de'])).toBe('en');
    expect(matchLocale([])).toBe('en');
  });

  it('lets the user override the device language', () => {
    expect(resolveLocale('en', ['es-ES'])).toBe('en');
    expect(resolveLocale('system', ['es-ES'])).toBe('es');
    expect(parseLanguagePreference('es')).toBe('es');
    expect(parseLanguagePreference('xx')).toBe('system');
  });
});

/** Every leaf, as `path → value` (functions called with sample arguments). */
function leaves(obj: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  const visit = (v: unknown, p: string) => {
    if (typeof v === 'string') out.set(p, v);
    else if (typeof v === 'function')
      out.set(p, String((v as (...a: unknown[]) => unknown)(2, 1, 0)));
    else if (Array.isArray(v)) v.forEach((x, i) => visit(x, `${p}[${i}]`));
    else if (v && typeof v === 'object')
      for (const [k, x] of Object.entries(v)) visit(x, p ? `${p}.${k}` : k);
  };
  visit(obj, prefix);
  return out;
}

describe('Spanish table', () => {
  it('has exactly the English keys, all non-empty', () => {
    const e = leaves(en);
    const s = leaves(es);
    expect([...s.keys()].sort()).toEqual([...e.keys()].sort());
    for (const [k, v] of s) expect(v.trim(), k).not.toBe('');
  });

  it('is actually translated (most strings differ from English)', () => {
    const e = leaves(en);
    const s = leaves(es);
    const same = [...s].filter(([k, v]) => e.get(k) === v).length;
    expect(same / s.size).toBeLessThan(0.15);
  });
});

describe('Spanish session table', () => {
  it('has exactly the English keys, all non-empty', () => {
    const e = leaves(sessionStringsEn);
    const s = leaves(sessionEs);
    expect([...s.keys()].sort()).toEqual([...e.keys()].sort());
    for (const [k, v] of s) expect(v.trim(), k).not.toBe('');
  });

  it('is actually translated (most strings differ from English)', () => {
    const e = leaves(sessionStringsEn);
    const s = leaves(sessionEs);
    const same = [...s].filter(([k, v]) => e.get(k) === v).length;
    expect(same / s.size).toBeLessThan(0.15);
  });

  it('follows the active locale', () => {
    try {
      setActiveLocale('es');
      expect(sessionStrings).toBe(sessionEs);
      setActiveLocale('en');
      expect(sessionStrings).toBe(sessionStringsEn);
    } finally {
      setActiveLocale('en');
    }
  });
});
