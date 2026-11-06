import { getDirection, isLocale, messages } from '@medibooker/i18n';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { FONT_VARIABLES } from '@/lib/fonts';
import '@/styles/globals.css';

/** Rendered per request: every page has its own CSP nonce (03 §4). */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'MediBooker' };

interface LocaleLayoutProps {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly locale: string }>;
}

/**
 * The root layout: language and reading direction come from the path, on the server (03 §5). The
 * theme follows the visitor's system; only signed-in areas will store a choice (A05), so a public
 * page sets no cookie.
 */
export default async function LocaleLayout({
  children,
  params,
}: LocaleLayoutProps): Promise<ReactNode> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = await getTranslations({ locale, namespace: 'a11y' });
  const { common, errorPage } = messages[locale];
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang={locale} dir={getDirection(locale)} data-theme="system" className={FONT_VARIABLES}>
      <head>
        {/* React Aria reads the nonce for the styles it adds; the browser keeps it out of the DOM. */}
        <meta property="csp-nonce" nonce={nonce} suppressHydrationWarning />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only rounded-md bg-bg-surface text-label-default text-text-brand focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-20 focus:flex focus:min-h-touch-target focus:items-center focus:px-3 focus:shadow-elevation-2"
        >
          {t('skipToContent')}
        </a>
        {/* Only what client components need: the page itself renders on the server. */}
        <NextIntlClientProvider messages={{ common, errorPage }}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
