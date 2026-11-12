import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { isPracticeSlug } from '@/features/portal/appointment-view';
import { BookPage } from '@/features/portal/book-page';
import { pageTitle } from '@/lib/page-title';

export const generateMetadata = pageTitle('portal.book.title');

interface PageProps {
  readonly params: Promise<{ readonly locale: string; readonly slug: string }>;
}

export default async function Page({ params }: PageProps): Promise<ReactNode> {
  const { slug } = await params;
  if (!isPracticeSlug(slug)) notFound();
  return <BookPage slug={slug} />;
}
