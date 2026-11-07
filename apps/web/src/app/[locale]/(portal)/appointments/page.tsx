import type { ReactNode } from 'react';
import { AppointmentsPage } from '@/features/portal/appointments-page';
import { pageTitle } from '@/lib/page-title';

export const generateMetadata = pageTitle('portal.list.title');

export default function Page(): ReactNode {
  return <AppointmentsPage />;
}
