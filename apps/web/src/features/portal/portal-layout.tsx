import { isLocale, messages } from '@medibooker/i18n';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { installationBrand, installationPractice } from '@/lib/api.server';
import { AuthProviders } from '../auth/auth-providers';
import { bookHref } from './free-times/free-times-view';
import { PortalShell } from './portal-shell';

interface PortalLayoutProps {
  readonly children: ReactNode;
  readonly locale: string;
}

/**
 * The signed-in pages, in the name of the installation's practice (ADR 0016), with only
 * the texts their client code uses (ADR 0013).
 */
export async function PortalLayout({ children, locale }: PortalLayoutProps): Promise<ReactNode> {
  if (!isLocale(locale)) notFound();
  const { a11y, auth, common, errors, validation, portal, practicePage } = messages[locale];
  const practice = await installationBrand(locale);
  const slug = installationPractice();
  return (
    <NextIntlClientProvider
      messages={{
        a11y,
        auth,
        common,
        errors,
        validation,
        portal,
        // The booking page names a service with its length (B07).
        practicePage: {
          freeTimes: practicePage.freeTimes,
          services: { duration: practicePage.services.duration },
        },
      }}
    >
      <AuthProviders signedIn>
        <PortalShell
          brand={practice?.name ?? undefined}
          bookHref={slug === undefined ? undefined : bookHref(locale, slug)}
        >
          {children}
        </PortalShell>
      </AuthProviders>
    </NextIntlClientProvider>
  );
}
