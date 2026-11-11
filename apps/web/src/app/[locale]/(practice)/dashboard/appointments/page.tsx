import type { ReactNode } from 'react';
import { AppointmentsPage } from '@/features/dashboard/appointments-page';
import { pageTitle } from '@/lib/page-title';

export const generateMetadata = pageTitle('dashboard.appointments.title');

/** Screen W5: the appointments of a week, behind the layout's gate. */
export default function Page(): ReactNode {
  return <AppointmentsPage />;
}
