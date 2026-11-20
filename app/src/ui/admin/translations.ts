import type { GuacAdminApi } from '../../core/api/GuacAdminApi.ts';
import { activeLocale } from '../strings.ts';
import type { TranslationTable } from './labels.ts';

/**
 * The server's own label table (`translations/<lang>.json`, docs/protocol-notes.md §8.4) in
 * the UI language, else English, else `null` (labels are then derived from names).
 */
export async function loadTranslations(
  api: GuacAdminApi,
  baseUrl: string,
): Promise<TranslationTable | null> {
  const lang = activeLocale();
  const table = await api.getServerTranslations(baseUrl, lang);
  if (table || lang === 'en') return table;
  return api.getServerTranslations(baseUrl, 'en');
}
