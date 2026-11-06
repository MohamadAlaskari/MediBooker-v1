import type { MetadataRoute } from 'next';

/** The public pages may be found, the API on the same address not (P03). */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', allow: '/', disallow: '/api/' } };
}
