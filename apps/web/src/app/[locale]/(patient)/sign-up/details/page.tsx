import type { ReactNode } from 'react';
import { SignUpDetails } from '@/features/auth/sign-up-details';
import { pageTitle } from '@/lib/page-title';

export const generateMetadata = pageTitle('auth.details.title');

export default function Page(): ReactNode {
  return <SignUpDetails />;
}
