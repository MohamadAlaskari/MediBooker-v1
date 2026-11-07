import { isLocale, messages } from '@medibooker/i18n';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { AuthProviders } from '../auth/auth-providers';
import { PortalShell } from './portal-shell';

interface PortalLayoutProps {
  readonly children: ReactNode;
  readonly locale: string;
}

/** The signed-in pages, with only the texts their client code uses (ADR 0013). */
export function PortalLayout({ children, locale }: PortalLayoutProps): ReactNode {
  if (!isLocale(locale)) notFound();
  const { a11y, auth, errors, validation, portal, practicePage } = messages[locale];
  return (
    <NextIntlClientProvider
      messages={{
        a11y,
        auth,
        errors,
        validation,
        portal,
        practicePage: { freeTimes: practicePage.freeTimes },
      }}
    >
      <AuthProviders signedIn>
        <PortalShell>{children}</PortalShell>
      </AuthProviders>
    </NextIntlClientProvider>
  );
}
