import type { ReactNode } from 'react';
import { CalendarPage } from '@/features/dashboard/calendar-page';
import { pageTitle } from '@/lib/page-title';

export const generateMetadata = pageTitle('dashboard.calendar.title');

/** Screen W2: one doctor's week, behind the layout's gate. */
export default function Page(): ReactNode {
  return <CalendarPage />;
}
