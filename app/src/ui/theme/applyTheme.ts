import { StatusBar, Style } from '@capacitor/status-bar';
import { resolveTheme, THEME_BACKGROUND, type ThemePreference } from './theme.ts';

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches;
}

/**
 * Applies the theme: `data-theme` on <html> for a manual override (no attribute = follow the
 * system via CSS), the `theme-color` meta, and the native status bar.
 */
export function applyTheme(pref: ThemePreference, native: boolean): void {
  const root = document.documentElement;
  if (pref === 'system') delete root.dataset['theme'];
  else root.dataset['theme'] = pref;
  const resolved = resolveTheme(pref, systemPrefersDark());
  root.style.colorScheme = resolved;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_BACKGROUND[resolved]);
  if (native) {
    // Style.Dark = light text, for dark backgrounds.
    void StatusBar.setStyle({ style: resolved === 'dark' ? Style.Dark : Style.Light }).catch(
      () => undefined,
    );
    void StatusBar.setBackgroundColor({ color: THEME_BACKGROUND[resolved] }).catch(() => undefined);
  }
}

/** Re-applies when the system theme changes while following the system. */
export function watchSystemTheme(onChange: () => void): () => void {
  if (typeof matchMedia !== 'function') return () => undefined;
  const mq = matchMedia(DARK_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

export function subscribeMedia(query: string, onChange: () => void): () => void {
  if (typeof matchMedia !== 'function') return () => undefined;
  const mq = matchMedia(query);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

export function matchesMedia(query: string): boolean {
  return typeof matchMedia === 'function' && matchMedia(query).matches;
}
