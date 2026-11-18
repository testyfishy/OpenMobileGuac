/** Theme preference (SET-1). Pure helpers; DOM application is in `applyTheme`. */

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export function parseThemePreference(raw: unknown): ThemePreference {
  return raw === 'light' || raw === 'dark' ? raw : 'system';
}

export function resolveTheme(pref: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (pref === 'system') return systemPrefersDark ? 'dark' : 'light';
  return pref;
}

/** Status-bar / theme-color background per theme; keep in sync with `--omg-bg` in index.css. */
export const THEME_BACKGROUND: Readonly<Record<ResolvedTheme, string>> = {
  light: '#f5f6f8',
  dark: '#0f1115',
};
