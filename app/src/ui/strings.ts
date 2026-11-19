import { en, type Strings } from './i18n/en.ts';
import { es } from './i18n/es.ts';
import type { Locale } from './i18n/locale.ts';
import { sessionEs } from './i18n/session.es.ts';
// By file path, not through ui/session/index.ts: this module is in the main chunk and must
// not pull in SessionScreen (lazy-loaded with the session host).
import {
  sessionStringsEn,
  setSessionStrings,
  type SessionStrings,
} from './session/sessionStrings.ts';

/**
 * The active string table (SPEC I18N-1). Call sites keep using `strings.section.key`; the
 * binding is live, so after `setActiveLocale()` every later read gets the new language. The
 * app re-renders from the root when the locale changes (see App.tsx). The session screen
 * has its own table (`ui/session/sessionStrings.ts`), switched here at the same time.
 */
const TABLES: Readonly<Record<Locale, Strings>> = { en, es };
const SESSION_TABLES: Readonly<Record<Locale, SessionStrings>> = {
  en: sessionStringsEn,
  es: sessionEs,
};

export let strings: Strings = en;
let active: Locale = 'en';

export function setActiveLocale(locale: Locale): void {
  active = locale;
  strings = TABLES[locale];
  setSessionStrings(SESSION_TABLES[locale]);
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}

export function activeLocale(): Locale {
  return active;
}

export function tableFor(locale: Locale): Strings {
  return TABLES[locale];
}
export const SOURCE_URL = 'https://github.com/testyfishy/OpenMobileGuac';
