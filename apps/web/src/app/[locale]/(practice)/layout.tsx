import { isLocale, messages } from '@medibooker/i18n';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { AuthProviders } from '@/features/auth/auth-providers';
import { DashboardGate } from '@/features/dashboard/dashboard-gate';
import { installationBrand } from '@/lib/api.server';

export const metadata: Metadata = { robots: { index: false } };

interface LayoutProps {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly locale: string }>;
}

/**
 * The practice dashboard (A04, M05) of the installation's practice (ADR 0016), with only the texts
 * its client code uses (ADR 0013). Nothing of the practice renders before the API admits the person.
 */
export default async function Layout({ children, params }: LayoutProps): Promise<ReactNode> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const { a11y, auth, common, errors, validation, dashboard } = messages[locale];
  const practice = await installationBrand(locale);
  return (
    <NextIntlClientProvider messages={{ a11y, auth, common, errors, validation, dashboard }}>
      <AuthProviders signedIn>
        <DashboardGate practiceId={practice?.id} brand={practice?.name ?? undefined}>
          {children}
        </DashboardGate>
      </AuthProviders>
    </NextIntlClientProvider>
  );
}
