import type { MetadataRoute } from 'next';

/** Where a practice's page is in a language: its own path, or the root of its installation. */
export type PracticePath = (locale: string, slug: string) => string;

const OWN_PATH: PracticePath = (locale, slug) => `/${locale}/${slug}`;

/**
 * One address per practice and language, each naming the others, without a date: the list has none
 * (08 P02). Every language of the site, because the registry does not know a practice's languages;
 * the page exists in each of them, with its own canonical address.
 */
export function sitemapEntries(
  site: string,
  slugs: readonly string[],
  locales: readonly string[],
  pathOf: PracticePath = OWN_PATH,
): MetadataRoute.Sitemap {
  return slugs.flatMap((slug) => {
    const addressIn = (locale: string): string => new URL(pathOf(locale, slug), site).href;
    const languages = Object.fromEntries(locales.map((locale) => [locale, addressIn(locale)]));
    return locales.map((locale) => ({ url: addressIn(locale), alternates: { languages } }));
  });
}
