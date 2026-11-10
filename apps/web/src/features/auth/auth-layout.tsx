import { isLocale, messages } from '@medibooker/i18n';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { installationBrand } from '@/lib/api.server';
import { AuthProviders } from './auth-providers';
import { AuthShell } from './auth-shell';

interface AuthLayoutProps {
  readonly children: ReactNode;
  readonly locale: string;
  /** The pages of a signed-in person, as against the ways in: see AuthProviders. */
  readonly signedIn?: boolean;
}

/**
 * The frame of the pages about an account, in the name of the installation's practice
 * (ADR 0016), with only the texts their client code uses (ADR 0013).
 */
export async function AuthLayout({
  children,
  locale,
  signedIn = false,
}: AuthLayoutProps): Promise<ReactNode> {
  if (!isLocale(locale)) notFound();
  const { a11y, auth, common, errors, validation } = messages[locale];
  const practice = await installationBrand(locale);
  return (
    <NextIntlClientProvider messages={{ a11y, auth, common, errors, validation }}>
      <AuthProviders signedIn={signedIn}>
        <AuthShell brand={practice?.name ?? undefined}>{children}</AuthShell>
      </AuthProviders>
    </NextIntlClientProvider>
  );
}
