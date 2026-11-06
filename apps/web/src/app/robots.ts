import type { MetadataRoute } from 'next';
import { publicSiteUrl } from '@/lib/api.server';

/** At run time: one image serves every environment (RT-30). */
export const dynamic = 'force-dynamic';

/** The public pages may be found, the API on the same address not (P03). */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: '/api/' },
    sitemap: new URL('/sitemap.xml', publicSiteUrl()).href,
  };
}
