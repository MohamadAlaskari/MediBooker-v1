import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AuthLayout } from '@/features/auth/auth-layout';

export const metadata: Metadata = { robots: { index: false } };

interface LayoutProps {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly locale: string }>;
}

export default async function Layout({ children, params }: LayoutProps): Promise<ReactNode> {
  const { locale } = await params;
  return (
    <AuthLayout locale={locale} signedIn>
      {children}
    </AuthLayout>
  );
}
