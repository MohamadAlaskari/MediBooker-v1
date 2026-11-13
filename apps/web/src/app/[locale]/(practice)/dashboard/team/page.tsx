import type { ReactNode } from 'react';
import { TeamPage } from '@/features/dashboard/team-page';
import { pageTitle } from '@/lib/page-title';

export const generateMetadata = pageTitle('dashboard.team.title');

/** Screen W15: the practice's team, for practice management (D17), behind the layout's gate. */
export default function Page(): ReactNode {
  return <TeamPage />;
}
