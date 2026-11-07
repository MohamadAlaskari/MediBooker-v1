import type { ReactNode } from 'react';
import { ForgotPasswordForm } from '@/features/auth/forgot-password-form';
import { pageTitle } from '@/lib/page-title';

export const generateMetadata = pageTitle('auth.forgot.title');

export default function Page(): ReactNode {
  return <ForgotPasswordForm />;
}
