import type { ReactNode } from 'react';
import { CheckInbox } from '@/features/auth/check-inbox';
import { pageTitle } from '@/lib/page-title';

export const generateMetadata = pageTitle('auth.checkInbox.title');

export default function Page(): ReactNode {
  return <CheckInbox />;
}
