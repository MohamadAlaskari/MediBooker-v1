import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { isId } from '@/features/portal/appointment-view';
import { ReschedulePage } from '@/features/portal/reschedule-page';
import { pageTitle } from '@/lib/page-title';

export const generateMetadata = pageTitle('portal.reschedule.title');

interface PageProps {
  readonly params: Promise<{ readonly practiceId: string; readonly appointmentId: string }>;
}

export default async function Page({ params }: PageProps): Promise<ReactNode> {
  const { practiceId, appointmentId } = await params;
  if (!isId(practiceId) || !isId(appointmentId)) notFound();
  return <ReschedulePage practiceId={practiceId} appointmentId={appointmentId} />;
}
