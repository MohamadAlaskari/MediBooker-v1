import { LOCALES } from './generated/catalog.js';

export { LOCALES };

export type Locale = (typeof LOCALES)[number];

/** Arabic is the default language of the product. */
export const DEFAULT_LOCALE: Locale = 'ar';

export function isLocale(value: string | undefined): value is Locale {
  return LOCALES.some((locale) => locale === value);
}
