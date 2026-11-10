import { LOCALES } from '@medibooker/i18n';
import type { MetadataRoute } from 'next';
import { sitemapEntries } from '@/features/practice-page/practice-sitemap';
import { installationPractice, practicePath, publicSiteUrl } from '@/lib/api.server';

/** At run time: one image serves every installation, each with its own practice (RT-30). */
export const dynamic = 'force-dynamic';

/**
 * The practice of the installation, at the root of its site (ADR 0016). An installation without one,
 * as in development, has no page of its own to name.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const own = installationPractice();
  return own === undefined ? [] : sitemapEntries(publicSiteUrl(), [own], LOCALES, practicePath);
}
