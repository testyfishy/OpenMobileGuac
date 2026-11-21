import { describe, expect, it } from 'vitest';
import { setActiveLocale } from '../strings.ts';
import { tlsEn, tlsEs, tlsStrings } from './tlsStrings.ts';

/** Every leaf, as `path → value` (functions called with sample arguments). */
function leaves(obj: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  const visit = (v: unknown, p: string) => {
    if (typeof v === 'string') out.set(p, v);
    else if (typeof v === 'function')
      out.set(p, String((v as (...a: unknown[]) => unknown)('A', 'B')));
    else if (v && typeof v === 'object')
      for (const [k, x] of Object.entries(v)) visit(x, p ? `${p}.${k}` : k);
  };
  visit(obj, prefix);
  return out;
}

describe('certificate trust strings (SRV-8)', () => {
  it('Spanish has exactly the English keys, all non-empty, mostly translated', () => {
    const e = leaves(tlsEn);
    const s = leaves(tlsEs);
    expect([...s.keys()].sort()).toEqual([...e.keys()].sort());
    for (const [k, v] of s) expect(v.trim(), k).not.toBe('');
    const same = [...s].filter(([k, v]) => e.get(k) === v).length;
    expect(same / s.size).toBeLessThan(0.15);
  });

  it('follows the active locale', () => {
    try {
      setActiveLocale('es');
      expect(tlsStrings()).toBe(tlsEs);
    } finally {
      setActiveLocale('en');
    }
    expect(tlsStrings()).toBe(tlsEn);
  });
});
