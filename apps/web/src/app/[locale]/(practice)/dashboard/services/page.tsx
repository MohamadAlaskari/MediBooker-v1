import type { ReactNode } from 'react';
import { ServicesPage } from '@/features/dashboard/services-page';
import { pageTitle } from '@/lib/page-title';

export const generateMetadata = pageTitle('dashboard.services.title');

/** Screens W12 and W13: the practice's services, behind the layout's gate. */
export default function Page(): ReactNode {
  return <ServicesPage />;
}
