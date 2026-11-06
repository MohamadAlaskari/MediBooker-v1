import { getDirection, isLocale } from '@medibooker/i18n';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

/** Rendered per request: every page has its own CSP nonce (03 §4). */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'MediBooker' };

interface LocaleLayoutProps {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly locale: string }>;
}

/** The root layout: language and reading direction come from the path, on the server (03 §5). */
export default async function LocaleLayout({
  children,
  params,
}: LocaleLayoutProps): Promise<ReactNode> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <html lang={locale} dir={getDirection(locale)}>
      <body>{children}</body>
    </html>
  );
}
