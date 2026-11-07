import type { ReactNode } from 'react';
import { SignUpForm } from '@/features/auth/sign-up-form';
import { pageTitle } from '@/lib/page-title';

export const generateMetadata = pageTitle('auth.signUp.title');

export default function Page(): ReactNode {
  return <SignUpForm />;
}
