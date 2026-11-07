import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { PortalLayout } from '@/features/portal/portal-layout';

export const metadata: Metadata = { robots: { index: false } };

interface LayoutProps {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly locale: string }>;
}

export default async function Layout({ children, params }: LayoutProps): Promise<ReactNode> {
  const { locale } = await params;
  return <PortalLayout locale={locale}>{children}</PortalLayout>;
}
