/** Mirrors `locales.json`, which config files read without a build (01 §3); a test keeps them equal. */
export const LOCALES = ['ar', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

/** Arabic is the default language of the product. */
export const DEFAULT_LOCALE: Locale = 'ar';

export function isLocale(value: string | undefined): value is Locale {
  return LOCALES.some((locale) => locale === value);
}
