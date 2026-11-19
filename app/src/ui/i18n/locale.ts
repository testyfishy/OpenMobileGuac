/**
 * Locale selection (I18N-1). Pure. The app picks the device language when a translation
 * exists, unless the user chose one in Settings.
 */

export const LOCALES = ['en', 'es'] as const;
export type Locale = (typeof LOCALES)[number];
export type LanguagePreference = 'system' | Locale;

/** Each language's own name, shown in the picker in that language. */
export const LOCALE_NAMES: Readonly<Record<Locale, string>> = {
  en: 'English',
  es: 'Español',
};

export function parseLanguagePreference(raw: unknown): LanguagePreference {
  return raw === 'system' || (LOCALES as readonly unknown[]).includes(raw)
    ? (raw as LanguagePreference)
    : 'system';
}

/** First supported locale among the device's preferred languages (`navigator.languages`). */
export function matchLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const lang = tag.toLowerCase().split(/[-_]/)[0];
    const hit = LOCALES.find((l) => l === lang);
    if (hit) return hit;
  }
  return 'en';
}

export function resolveLocale(pref: LanguagePreference, preferred: readonly string[]): Locale {
  return pref === 'system' ? matchLocale(preferred) : pref;
}

export function deviceLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
    return navigator.languages;
  }
  return navigator.language ? [navigator.language] : [];
}
