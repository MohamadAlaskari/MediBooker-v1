import type { ReactNode } from 'react';
import { HomePage } from '@/features/portal/home-page';
import { installationPractice, practicePath } from '@/lib/api.server';
import { pageTitle } from '@/lib/page-title';

export const generateMetadata = pageTitle('portal.home.title');

interface PageProps {
  readonly params: Promise<{ readonly locale: string }>;
}

/** PW2, where a sign-in without a way back lands (B06). */
export default async function Page({ params }: PageProps): Promise<ReactNode> {
  const { locale } = await params;
  const slug = installationPractice();
  return (
    <HomePage
      slug={slug}
      practiceHref={slug === undefined ? undefined : practicePath(locale, slug)}
    />
  );
}
