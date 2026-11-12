'use client';

import {
  isApiError,
  useGetMyAppointment,
  useGetPublicPractice,
  useListMyPractices,
} from '@medibooker/api-client';
import { ArrowLeft, CalendarClock, CalendarPlus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Button, LinkButton } from '@/components/ui/button';
import { useFragmentValue } from '../auth/fragment';
import { PageHeading, TEXT_LINK, useFocusOnArrival } from '../auth/form-parts';
import { formatOf, practiceById, textIn } from './appointment-view';
import { downloadCalendarFile } from './calendar-file';
import { CancelButton } from './cancel-button';
import {
  AppointmentFacts,
  Card,
  ChangeNote,
  LoadError,
  Loading,
  StaleNotice,
  StatusBadge,
  StatusNote,
  TooLateNote,
  useArrivals,
} from './portal-parts';

interface DetailsProps {
  readonly practiceId: string;
  readonly appointmentId: string;
}

/** The page's heading beside the status. After a cancel the card with its button has gone, so it takes the focus. */
function ServiceHeading({
  focusOnArrival,
  children,
}: {
  readonly focusOnArrival: boolean;
  readonly children: string;
}): ReactNode {
  const heading = useFocusOnArrival(focusOnArrival);
  return (
    <h1
      ref={heading}
      tabIndex={focusOnArrival ? -1 : undefined}
      // Only a script can focus it: the focus is shown by what is read out, not by a ring.
      className="text-heading-h1 text-text-primary outline-none"
    >
      <bdi>{children}</bdi>
    </h1>
  );
}

/** PW8: one appointment, and what can still be done about it. */
export function AppointmentDetailsPage({ practiceId, appointmentId }: DetailsProps): ReactNode {
  const t = useTranslations('portal');
  const locale = useLocale();
  const appointment = useGetMyAppointment(practiceId, appointmentId);
  const practices = useListMyPractices();
  const known = practiceById(practices.data?.items, practiceId);
  // Address and phone are on the practice's page; an appointment does not need it to be shown.
  const page = useGetPublicPractice(known?.slug ?? '', undefined, {
    query: { enabled: Boolean(known?.slug) },
  });
  const fromHistory = useFragmentValue('from') === 'past';
  const { arrival, said, onChanged } = useArrivals();
  // To the history, which shows this appointment again (B06): its id, which this page's path holds
  // already, and no count of what else a person has had.
  const history = `#tab=past&practice=${practiceId}&appointment=${appointmentId}`;
  const back = (
    <a href={`/${locale}/appointments${fromHistory ? history : ''}`} className={TEXT_LINK}>
      <ArrowLeft aria-hidden className="me-2 size-4 rtl:rotate-180" />
      {t('details.back')}
    </a>
  );
  if (appointment.isPending) {
    return (
      <>
        <PageHeading title={t('details.title')} />
        <Loading>{t('list.loading')}</Loading>
      </>
    );
  }
  if (appointment.data === undefined) {
    return (
      <>
        <PageHeading title={t('details.title')} />
        {isApiError(appointment.error) && appointment.error.status === 404 ? (
          <p className="mb-4 text-body-default text-text-primary">{t('details.notFound')}</p>
        ) : (
          <div className="mb-4">
            <LoadError query={appointment} onPassed={onChanged} />
          </div>
        )}
        {back}
      </>
    );
  }
  const details = appointment.data;
  const format = formatOf(details, locale);
  const practiceName = known === undefined ? '' : textIn(known.name, locale);
  const { changeable } = details;
  // Booked and not begun: what can still be done about it. A visit that has been stays booked until M05.
  const ahead = details.status === 'BOOKED' && !details.started;
  const phone = page.data?.phone;
  return (
    <div className="flex flex-col gap-6">
      {back}
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-body-small text-text-secondary">{t('details.title')}</p>
          <ServiceHeading key={arrival} focusOnArrival={arrival > 0}>
            {textIn(details.serviceName, locale)}
          </ServiceHeading>
        </div>
        <StatusBadge appointment={details} />
      </header>
      {appointment.isRefetchError ? <StaleNotice query={appointment} onPassed={onChanged} /> : null}
      <div>
        <StatusNote>{said}</StatusNote>
        <div className="grid grid-cols-1 gap-6 desktop:grid-cols-3">
          <div className="desktop:col-span-2">
            <Card>
              <AppointmentFacts
                appointment={details}
                practice={practiceName}
                address={page.data?.address}
              />
            </Card>
          </div>
          <div className="flex flex-col gap-4">
            {ahead ? (
              <Card>
                <h2 className="mb-4 text-heading-h3 text-text-primary">{t('details.manage')}</h2>
                <div className="flex flex-col gap-2">
                  <Button
                    onPress={() => {
                      downloadCalendarFile(
                        {
                          id: details.id,
                          startsAt: details.startsAt,
                          endsAt: details.endsAt,
                          bookedAt: details.bookedAt,
                          summary: t('book.calendarSummary', {
                            practice: practiceName === '' ? t('list.somePractice') : practiceName,
                          }),
                          location: page.data?.address ?? null,
                        },
                        t('book.calendarFileName'),
                      );
                    }}
                  >
                    <CalendarPlus aria-hidden data-icon="inline-start" />
                    {t('book.addToCalendar')}
                  </Button>
                  {changeable ? (
                    <>
                      <LinkButton
                        variant="outline"
                        href={`/${locale}/appointments/${practiceId}/${appointmentId}/reschedule`}
                      >
                        <CalendarClock aria-hidden data-icon="inline-start" />
                        {t('list.reschedule')}
                      </LinkButton>
                      <CancelButton
                        appointment={details}
                        label={t('cancel.confirm')}
                        variant="danger"
                        onChanged={onChanged}
                      />
                    </>
                  ) : null}
                </div>
              </Card>
            ) : null}
            {changeable && page.data !== undefined ? (
              <ChangeNote
                hours={page.data.cancellationDeadlineHours}
                phone={phone}
                format={format}
              />
            ) : null}
            {ahead && !changeable ? <TooLateNote phone={phone} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
