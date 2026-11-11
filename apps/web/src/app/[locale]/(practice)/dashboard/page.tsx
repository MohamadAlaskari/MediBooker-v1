import type { ReactNode } from 'react';
import { TodayPage } from '@/features/dashboard/today-page';
import { pageTitle } from '@/lib/page-title';

export const generateMetadata = pageTitle('auth.dashboard.title');

/** Screen W1: the day of the installation's practice (ADR 0016), behind the layout's gate. */
export default function Page(): ReactNode {
  return <TodayPage />;
}
