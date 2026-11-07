'use client';

import { createQueryClient } from '@medibooker/api-client';
import { QueryClientProvider } from '@tanstack/react-query';
import { useLocale } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';
import { I18nProvider } from 'react-aria-components';
import { configureBrowserApiClient } from '@/lib/api.client';
import { expireChoice } from '../portal/booking-choice';
import { signInAgain } from './session-redirect';

interface AuthProvidersProps {
  readonly children: ReactNode;
  /** The pages of a signed-in person: a session that is over leads to signing in, and back. */
  readonly signedIn?: boolean;
}

/** What the pages about an account need in the browser: only these pages load it. */
export function AuthProviders({ children, signedIn = false }: AuthProvidersProps): ReactNode {
  const locale = useLocale();
  const [queryClient] = useState(() => {
    configureBrowserApiClient(locale);
    return createQueryClient(
      signedIn
        ? {
            onUnauthenticated: () => {
              signInAgain(locale);
            },
          }
        : {},
    );
  });
  // A choice stored by an earlier page, in this tab: its minutes run on here.
  useEffect(() => {
    expireChoice();
  }, []);
  return (
    // React Aria's own texts and arrow keys would otherwise follow the browser's language.
    <I18nProvider locale={locale}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </I18nProvider>
  );
}
