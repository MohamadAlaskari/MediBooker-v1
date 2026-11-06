import { SetMetadata } from '@nestjs/common';

/** The metadata key of `@PublicCache`, which the NoStoreInterceptor reads. */
export const PUBLIC_CACHE_SECONDS = 'medibooker:publicCacheSeconds';

/**
 * Opens one route's answer for browsers and shared caches, for that many seconds: only for an
 * answer without anything personal. Every other answer stays `no-store`, errors included.
 */
export function PublicCache(seconds: number): MethodDecorator {
  return SetMetadata(PUBLIC_CACHE_SECONDS, seconds);
}
