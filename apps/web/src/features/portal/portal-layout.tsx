import { isLocale, messages } from '@medibooker/i18n';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { installationBrand } from '@/lib/api.server';
import { AuthProviders } from '../auth/auth-providers';
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
  return (
    <NextIntlClientProvider
      messages={{
        a11y,
        auth,
        common,
        errors,
        validation,
        portal,
        practicePage: { freeTimes: practicePage.freeTimes },
      }}
    >
      <AuthProviders signedIn>
        <PortalShell brand={practice?.name ?? undefined}>{children}</PortalShell>
      </AuthProviders>
    </NextIntlClientProvider>
  );
}
