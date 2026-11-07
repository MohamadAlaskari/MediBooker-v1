import type { ReactNode } from 'react';
import { SignInForm } from '@/features/auth/sign-in-form';
import { pageTitle } from '@/lib/page-title';

export const generateMetadata = pageTitle('auth.signIn.title');

export default function Page(): ReactNode {
  return <SignInForm />;
}
