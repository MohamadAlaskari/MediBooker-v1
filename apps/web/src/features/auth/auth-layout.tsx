import { isLocale, messages } from '@medibooker/i18n';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { AuthProviders } from './auth-providers';
import { AuthShell } from './auth-shell';

interface AuthLayoutProps {
  readonly children: ReactNode;
  readonly locale: string;
  /** The pages of a signed-in person, as against the ways in: see AuthProviders. */
  readonly signedIn?: boolean;
}

/** The frame of the pages about an account, with only the texts their client code uses (ADR 0013). */
export function AuthLayout({ children, locale, signedIn = false }: AuthLayoutProps): ReactNode {
  if (!isLocale(locale)) notFound();
  const { a11y, auth, errors, validation } = messages[locale];
  return (
    <NextIntlClientProvider messages={{ a11y, auth, errors, validation }}>
      <AuthProviders signedIn={signedIn}>
        <AuthShell>{children}</AuthShell>
      </AuthProviders>
    </NextIntlClientProvider>
  );
}
