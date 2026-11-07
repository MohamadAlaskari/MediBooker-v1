import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppointmentDetailsPage } from '@/features/portal/appointment-details-page';
import { isId } from '@/features/portal/appointment-view';
import { pageTitle } from '@/lib/page-title';

export const generateMetadata = pageTitle('portal.details.title');

interface PageProps {
  readonly params: Promise<{ readonly practiceId: string; readonly appointmentId: string }>;
}

export default async function Page({ params }: PageProps): Promise<ReactNode> {
  const { practiceId, appointmentId } = await params;
  if (!isId(practiceId) || !isId(appointmentId)) notFound();
  return <AppointmentDetailsPage practiceId={practiceId} appointmentId={appointmentId} />;
}
