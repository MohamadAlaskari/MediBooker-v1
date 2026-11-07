import type { ReactNode } from 'react';
import { ResetPasswordForm } from '@/features/auth/reset-password-form';
import { pageTitle } from '@/lib/page-title';

export const generateMetadata = pageTitle('auth.reset.title');

export default function Page(): ReactNode {
  return <ResetPasswordForm />;
}
