import { getDirection, isLocale, messages } from '@medibooker/i18n';
import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { SkipLink } from '@/components/skip-link';
import { installationBrand } from '@/lib/api.server';
import { brandStyle } from '@/lib/brand-style';
import { FONT_VARIABLES } from '@/lib/fonts';
import { THEME_COOKIE, themeOf } from '@/lib/theme';
import '@/styles/globals.css';

/** Rendered per request: every page has its own CSP nonce (03 §4). */
export const dynamic = 'force-dynamic';

/** The product's name, where an installation names no practice of its own. */
const PRODUCT = 'MediBooker';

interface LocaleLayoutProps {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly locale: string }>;
}

/** Every title ends with the practice's name (ADR 0016): a page names only what it is. */
export async function generateMetadata({ params }: LocaleLayoutProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return { title: PRODUCT };
  const brand = (await installationBrand(locale))?.name ?? PRODUCT;
  const t = await getTranslations({ locale, namespace: 'app' });
  return { title: { template: t('pageTitle', { page: '%s', brand }), default: brand } };
}

/**
 * The root layout: language and reading direction come from the path, on the server (03 §5). The
 * theme follows the visitor's system, or the choice a signed-in person stored in the `theme` cookie
 * (03 §6, B06), which a public page reads and never sets.
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
  const practice = await installationBrand(locale);
  const theme = themeOf((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang={locale} dir={getDirection(locale)} data-theme={theme} className={FONT_VARIABLES}>
      <head>
        {/* React Aria reads the nonce for the styles it adds; the browser keeps it out of the DOM. */}
        <meta property="csp-nonce" nonce={nonce} suppressHydrationWarning />
        {/* The installation's colours on every page (ADR 0016). Here, once per document: a layout
            that a client navigation renders anew would bring a style with another request's nonce. */}
        {practice === undefined ? null : (
          <style nonce={nonce} suppressHydrationWarning>
            {brandStyle(practice.theme)}
          </style>
        )}
      </head>
      <body>
        <SkipLink>{t('skipToContent')}</SkipLink>
        {/* Only what client components need: the page itself renders on the server. */}
        <NextIntlClientProvider messages={{ common, errorPage }}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
