import type { ReactNode } from 'react';
import { EditDetails } from '@/features/auth/edit-details';
import { pageTitle } from '@/lib/page-title';

export const generateMetadata = pageTitle('auth.details.editTitle');

export default function Page(): ReactNode {
  return <EditDetails />;
}
