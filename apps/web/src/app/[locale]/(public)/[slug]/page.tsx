import { isLocale } from '@medibooker/i18n';
import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { PracticeRoute, practiceMetadata } from '@/features/practice-page/practice-route';
import { installationPractice } from '@/lib/api.server';

interface PracticeRouteProps {
  readonly params: Promise<{ readonly locale: string; readonly slug: string }>;
}

export async function generateMetadata({ params }: PracticeRouteProps): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  return practiceMetadata(locale, slug);
}

/** A practice at its own path; the installation's own practice lives at the root (ADR 0016). */
export default async function PracticeSlugRoute({
  params,
}: PracticeRouteProps): Promise<ReactNode> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  if (slug === installationPractice()) permanentRedirect(`/${locale}`);
  return <PracticeRoute locale={locale} slug={slug} />;
}
