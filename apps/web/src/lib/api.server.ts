import 'server-only';
import {
  configureApiClient,
  getPublicPractice,
  isApiError,
  listPublicPractices,
  type PublicPracticeDto,
} from '@medibooker/api-client';
import { headers } from 'next/headers';
import { cache } from 'react';
import { parseServerEnv, type ServerEnv } from './server-env';

let serverEnv: ServerEnv | undefined;

/** On first use, not at import: `next build` loads this module without the run-time environment. */
function environment(): ServerEnv {
  if (serverEnv === undefined) {
    serverEnv = parseServerEnv(process.env);
    configureApiClient({
      baseUrl: serverEnv.API_INTERNAL_URL,
      // The API trusts one proxy hop, so it throttles per visitor and not per web container.
      getHeaders: async (): Promise<Record<string, string>> => {
        const forwardedFor = (await headers()).get('x-forwarded-for');
        return forwardedFor === null ? {} : { 'X-Forwarded-For': forwardedFor };
      },
    });
  }
  return serverEnv;
}

export function publicSiteUrl(): string {
  return environment().PUBLIC_SITE_URL;
}

/** A practice slug as the API accepts it: anything else never reaches the API's path. */
const PRACTICE_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export type PublicPracticeResult =
  | { readonly kind: 'found'; readonly practice: PublicPracticeDto }
  | { readonly kind: 'missing' }
  | { readonly kind: 'unavailable'; readonly requestId: string | undefined };

/**
 * One practice for one request, public endpoints only (03 §7); metadata and page share the call.
 * Never cached across requests (decision D2): a withdrawn consent must disappear at once (BR-24).
 */
export const loadPublicPractice = cache(
  async (slug: string, locale: string): Promise<PublicPracticeResult> => {
    if (!PRACTICE_SLUG.test(slug)) return { kind: 'missing' };
    environment();
    try {
      const practice = await getPublicPractice(
        slug,
        { 'Accept-Language': locale },
        { cache: 'no-store' },
      );
      return { kind: 'found', practice };
    } catch (error) {
      if (isApiError(error, 'NOT_FOUND')) return { kind: 'missing' };
      if (isApiError(error)) return { kind: 'unavailable', requestId: error.requestId };
      throw error;
    }
  },
);

const LARGEST_PAGE = 100;
/**
 * 5,000 practices. The walk runs on the limit of the visitor, 60 requests per minute, so it must
 * stay well below that; 08 P03 says what comes before that number. It also ends the walk if a
 * cursor should ever lead nowhere.
 */
const MAX_PAGES = 50;

/**
 * Every published slug, for the sitemap. A failure throws, so an outage answers an error instead
 * of an empty sitemap that would tell search engines the practices are gone.
 */
export async function loadPublishedSlugs(): Promise<readonly string[]> {
  environment();
  const slugs: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { items, nextCursor } = await listPublicPractices(
      { limit: LARGEST_PAGE, ...(cursor === undefined ? {} : { cursor }) },
      { cache: 'no-store' },
    );
    slugs.push(...items.map(({ slug }) => slug));
    if (nextCursor === null) break;
    cursor = nextCursor;
  }
  return slugs;
}
