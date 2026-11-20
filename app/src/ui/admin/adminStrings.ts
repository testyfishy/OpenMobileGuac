import { adminEn, type AdminStrings } from '../i18n/admin.en.ts';
import { adminEs } from '../i18n/admin.es.ts';
import type { Locale } from '../i18n/locale.ts';

/**
 * The active connection-management string table. A live binding, switched by
 * `setActiveLocale()` in `ui/strings.ts` together with the main and session tables.
 */
export const ADMIN_TABLES: Readonly<Record<Locale, AdminStrings>> = { en: adminEn, es: adminEs };

export let adminStrings: AdminStrings = adminEn;

export function setAdminLocale(locale: Locale): void {
  adminStrings = ADMIN_TABLES[locale];
}
