import type { ReactNode } from 'react';
import { WorkingHoursPage } from '@/features/dashboard/working-hours-page';
import { pageTitle } from '@/lib/page-title';

export const generateMetadata = pageTitle('dashboard.workingHours.title');

/** Screen W14: the doctors' working hours, absences and free times, behind the layout's gate. */
export default function Page(): ReactNode {
  return <WorkingHoursPage />;
}
