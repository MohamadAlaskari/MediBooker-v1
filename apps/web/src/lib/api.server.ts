import 'server-only';
import {
  configureApiClient,
  getPublicPractice,
  isApiError,
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

/** The practice this installation serves (ADR 0016); undefined where it serves several. */
export function installationPractice(): string | undefined {
  return environment().PRACTICE_SLUG;
}

/** Where a practice's page is: the installation's own at the root of its domain. */
export function practicePath(locale: string, slug: string): string {
  return slug === installationPractice() ? `/${locale}` : `/${locale}/${slug}`;
}

/**
 * The installation's practice for the frame of every page: its name and its colours (ADR 0016).
 * undefined without one, or while the API cannot say: a frame never fails a page.
 */
export async function installationBrand(locale: string): Promise<PublicPracticeDto | undefined> {
  const slug = installationPractice();
  if (slug === undefined) return undefined;
  try {
    const result = await loadPublicPractice(slug, locale);
    return result.kind === 'found' ? result.practice : undefined;
  } catch {
    return undefined;
  }
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
