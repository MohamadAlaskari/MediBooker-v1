import type { ReactNode } from 'react';
import { VerifyEmailForm } from '@/features/auth/verify-email-form';
import { pageTitle } from '@/lib/page-title';

export const generateMetadata = pageTitle('auth.verifyEmail.title');

export default function Page(): ReactNode {
  return <VerifyEmailForm />;
}
