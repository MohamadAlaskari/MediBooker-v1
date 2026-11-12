import type { ReactNode } from 'react';
import { SecureAccountForm } from '@/features/auth/secure-account-form';
import { pageTitle } from '@/lib/page-title';

export const generateMetadata = pageTitle('auth.secureAccount.title');

export default function Page(): ReactNode {
  return <SecureAccountForm />;
}
