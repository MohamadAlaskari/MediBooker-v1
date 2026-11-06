import { LOCALES } from '@medibooker/i18n';
import type { MetadataRoute } from 'next';
import { sitemapEntries } from '@/features/practice-page/practice-sitemap';
import { loadPublishedSlugs, publicSiteUrl } from '@/lib/api.server';

/** At run time: one image serves every environment, and the practices change (RT-30). */
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return sitemapEntries(publicSiteUrl(), await loadPublishedSlugs(), LOCALES);
}
