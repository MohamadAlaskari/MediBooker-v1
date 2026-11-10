import type { ReactNode } from 'react';
import { DashboardHome } from '@/features/dashboard/dashboard-home';
import { installationBrand } from '@/lib/api.server';
import { pageTitle } from '@/lib/page-title';

export const generateMetadata = pageTitle('auth.dashboard.title');

interface PageProps {
  readonly params: Promise<{ readonly locale: string }>;
}

/** Screen W1's place: the dashboard of the installation's practice (ADR 0016). */
export default async function Page({ params }: PageProps): Promise<ReactNode> {
  const { locale } = await params;
  const practice = await installationBrand(locale);
  return <DashboardHome practiceId={practice?.id} />;
}
