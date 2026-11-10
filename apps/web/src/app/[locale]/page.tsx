import { isLocale } from '@medibooker/i18n';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { MessagePage } from '@/components/message-page';
import { PracticeRoute, practiceMetadata } from '@/features/practice-page/practice-route';
import { installationPractice } from '@/lib/api.server';

interface HomeProps {
  readonly params: Promise<{ readonly locale: string }>;
}

export async function generateMetadata({ params }: HomeProps): Promise<Metadata> {
  const { locale } = await params;
  const slug = installationPractice();
  // Without a practice of its own, the layout's metadata stands.
  if (slug === undefined || !isLocale(locale)) return {};
  return practiceMetadata(locale, slug);
}

/**
 * The root of the domain: the installation's practice (ADR 0016). Where an installation serves
 * several, as in development, a neutral page until a design exists (03 §5).
 */
export default async function HomePage({ params }: HomeProps): Promise<ReactNode> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const slug = installationPractice();
  if (slug !== undefined) return <PracticeRoute locale={locale} slug={slug} />;
  const t = await getTranslations({ locale, namespace: 'app' });
  // The product name is not translated.
  return <MessagePage title="MediBooker" body={t('tagline')} />;
}
