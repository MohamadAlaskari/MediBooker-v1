import type { ReactNode } from 'react';
import { PatientsPage } from '@/features/dashboard/patients-page';
import { pageTitle } from '@/lib/page-title';

export const generateMetadata = pageTitle('dashboard.patients.title');

/** Screen W8: the patients of the practice, behind the layout's gate. */
export default function Page(): ReactNode {
  return <PatientsPage />;
}
