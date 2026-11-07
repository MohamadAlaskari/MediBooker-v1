import type { ReactNode } from 'react';
import { AccountOverview } from '@/features/auth/account-overview';
import { pageTitle } from '@/lib/page-title';

export const generateMetadata = pageTitle('auth.account.title');

export default function Page(): ReactNode {
  return <AccountOverview />;
}
