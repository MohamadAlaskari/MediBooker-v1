import 'server-only';
import { LOCALES, type Locale } from '@medibooker/i18n';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, permanentRedirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { loadPublicPractice, practicePath, publicSiteUrl } from '@/lib/api.server';
import { brandStyle } from '@/lib/brand-style';
import { PracticePage } from './practice-page';
import { practiceJsonLd } from './practice-view';
import { PracticeUnavailable } from './practice-unavailable';

/**
 * The metadata of a practice's page, wherever it is served: at its own path, or at the root of the
 * installation's domain (ADR 0016). Its canonical address is always the one `practicePath` gives.
 */
export async function practiceMetadata(locale: Locale, slug: string): Promise<Metadata> {
  const result = await loadPublicPractice(slug, locale);
  // A short outage or a throttled crawler: the page answers 200, but it is nothing to keep.
  if (result.kind === 'unavailable') return { robots: { index: false } };
  // Here too, or a page that is not there would keep the title of the layout.
  if (result.kind !== 'found') notFound();
  const { practice } = result;
  const t = await getTranslations({ locale, namespace: 'practicePage' });
  const name = practice.name ?? '';
  const languages = LOCALES.filter((code) => practice.supportedLocales.includes(code));
  return {
    metadataBase: new URL(publicSiteUrl()),
    // It names the practice already: the layout's template would name it twice.
    title: { absolute: t('metaTitle', { name }) },
    description: practice.about ?? t('metaDescription', { name }),
    alternates: {
      canonical: practicePath(locale, practice.slug),
      languages: Object.fromEntries(
        languages.map((code) => [code, practicePath(code, practice.slug)]),
      ),
    },
  };
}

/** Fetches and decides; the content is in synchronous components (03 §8). */
export async function PracticeRoute({
  locale,
  slug,
}: {
  readonly locale: Locale;
  readonly slug: string;
}): Promise<ReactNode> {
  const result = await loadPublicPractice(slug, locale);
  if (result.kind === 'missing') notFound();
  if (result.kind === 'unavailable') return <PracticeUnavailable requestId={result.requestId} />;
  const { practice } = result;
  const path = practicePath(locale, practice.slug);
  // A retired slug: to where the practice is now, for good.
  if (practice.slug !== slug) permanentRedirect(path);
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const url = new URL(path, publicSiteUrl()).href;
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
