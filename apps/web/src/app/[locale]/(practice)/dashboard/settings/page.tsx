import type { ReactNode } from 'react';
import { SettingsPage } from '@/features/dashboard/settings-page';
import { pageTitle } from '@/lib/page-title';

export const generateMetadata = pageTitle('dashboard.settings.title');

/** Screen W20, its opening hours and special days (M02), behind the layout's gate. */
export default function Page(): ReactNode {
  return <SettingsPage />;
}
