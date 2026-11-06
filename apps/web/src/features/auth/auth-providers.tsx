'use client';

import { createQueryClient } from '@medibooker/api-client';
import { QueryClientProvider } from '@tanstack/react-query';
import { useLocale } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { configureBrowserApiClient } from '@/lib/api.client';

/** What the pages about an account need in the browser: only these pages load it. */
export function AuthProviders({ children }: { readonly children: ReactNode }): ReactNode {
  const locale = useLocale();
  const [queryClient] = useState(() => {
    configureBrowserApiClient(locale);
    return createQueryClient();
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
