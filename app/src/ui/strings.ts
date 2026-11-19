import { en, type Strings } from './i18n/en.ts';
import { es } from './i18n/es.ts';
import type { Locale } from './i18n/locale.ts';

/**
 * The active string table (SPEC I18N-1). Call sites keep using `strings.section.key`; the
 * binding is live, so after `setActiveLocale()` every later read gets the new language. The
 * app re-renders from the root when the locale changes (see App.tsx).
 */
const TABLES: Readonly<Record<Locale, Strings>> = { en, es };

export let strings: Strings = en;
let active: Locale = 'en';

export function setActiveLocale(locale: Locale): void {
  active = locale;
  strings = TABLES[locale];
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}

export function activeLocale(): Locale {
  return active;
}

export function tableFor(locale: Locale): Strings {
  return TABLES[locale];
}

export const SOURCE_URL = 'https://github.com/testyfishy/OpenMobileGuac';
