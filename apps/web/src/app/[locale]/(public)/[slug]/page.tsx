import { isLocale, LOCALES } from '@medibooker/i18n';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, permanentRedirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { PracticePage } from '@/features/practice-page/practice-page';
import { practiceJsonLd } from '@/features/practice-page/practice-view';
import { PracticeUnavailable } from '@/features/practice-page/practice-unavailable';
import { loadPublicPractice, publicSiteUrl } from '@/lib/api.server';
import { brandStyle } from '@/lib/brand-style';

interface PracticeRouteProps {
  readonly params: Promise<{ readonly locale: string; readonly slug: string }>;
}

export async function generateMetadata({ params }: PracticeRouteProps): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const result = await loadPublicPractice(slug, locale);
  // A short outage or a throttled crawler: the page answers 200, but it is nothing to keep.
  if (result.kind === 'unavailable') return { robots: { index: false } };
  if (result.kind !== 'found') return {};
  const { practice } = result;
  const t = await getTranslations({ locale, namespace: 'practicePage' });
  const name = practice.name ?? '';
  const languages = LOCALES.filter((code) => practice.supportedLocales.includes(code));
  return {
    metadataBase: new URL(publicSiteUrl()),
    title: t('metaTitle', { name }),
    description: practice.about ?? t('metaDescription', { name }),
    alternates: {
      canonical: `/${locale}/${practice.slug}`,
      languages: Object.fromEntries(languages.map((code) => [code, `/${code}/${practice.slug}`])),
    },
  };
}

/** Fetches and decides; the content is in synchronous components (03 §8). */
export default async function PracticeRoute({ params }: PracticeRouteProps): Promise<ReactNode> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const result = await loadPublicPractice(slug, locale);
  if (result.kind === 'missing') notFound();
  if (result.kind === 'unavailable') return <PracticeUnavailable requestId={result.requestId} />;
  const { practice } = result;
  if (practice.slug !== slug) permanentRedirect(`/${locale}/${practice.slug}`);
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const url = new URL(`/${locale}/${practice.slug}`, publicSiteUrl()).href;
  return (
    <>
      {/* The browser hides a nonce from the DOM, so hydration cannot compare it. */}
      <style nonce={nonce} suppressHydrationWarning>
        {brandStyle(practice.theme)}
      </style>
      <script
        type="application/ld+json"
        nonce={nonce}
        suppressHydrationWarning
        // Escaped by practiceJsonLd: no text a practice wrote can end this script.
        dangerouslySetInnerHTML={{ __html: practiceJsonLd(practice, url) }}
      />
      <PracticePage practice={practice} locale={locale} />
    </>
  );
}
