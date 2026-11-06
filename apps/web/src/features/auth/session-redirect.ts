'use client';

import { isApiError } from '@medibooker/api-client';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { useEffect } from 'react';

/** A session that really is over, after the one refresh: back to signing in, and back here after. */
export function useSignInWhenOver(error: unknown, path: string): void {
  const router = useRouter();
  const locale = useLocale();
  const over = isApiError(error) && error.status === 401;
  useEffect(() => {
    if (over) router.replace(`/${locale}/sign-in#next=${encodeURIComponent(`/${locale}${path}`)}`);
  }, [over, router, locale, path]);
}
