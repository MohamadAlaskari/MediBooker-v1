'use client';

import {
  getGetPublicAvailabilityQueryKey,
  getGetPublicFreeTimesQueryKey,
  isApiError,
  useGetMyAppointment,
  useGetPublicPractice,
  useListMyPractices,
  useRescheduleAppointment,
  type AppointmentDto,
} from '@medibooker/api-client';
import { isolate } from '@medibooker/i18n';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Button, LinkButton } from '@/components/ui/button';
import { FormError, PageHeading, useFocusOnArrival } from '../auth/form-parts';
import { FreeTimesChooser, type ChosenTime } from '../practice-page/free-times/free-times-picker';
import { doctorsOf, fullNameOf } from '../practice-page/practice-view';
import {
  formatOf,
  isChoiceGone,
  isOutcomeUnknown,
  practiceById,
  textIn,
  whenParts,
} from './appointment-view';
import {
  Card,
  LoadError,
  Loading,
  NarrowForm,
  StaleNotice,
  StatusBadge,
  TooLateNote,
} from './portal-parts';
import { UpdateDetailsStep } from './practice-details-steps';

interface RescheduleProps {
  readonly practiceId: string;
  readonly appointmentId: string;
}

/**
 * The appointment is not what this page knew: moved elsewhere, past its deadline, or no telling. Another
 * press cannot help, and what the page shows has to be read again.
 */
function isOvertaken(error: unknown): boolean {
  return (
    isApiError(error, 'INVALID_STATUS_TRANSITION') ||
    isApiError(error, 'CANCELLATION_DEADLINE_PASSED') ||
    isOutcomeUnknown(error)
  );
}

export function Confirm({
  from,
  to,
  doctor,
  pending,
  error,
  onConfirm,
  onOther,
}: {
  readonly from: string;
  readonly to: string;
  /** Undefined for any doctor: whoever is free then, who need not be the one of the appointment. */
  readonly doctor: string | undefined;
  readonly pending: boolean;
  readonly error: unknown;
  readonly onConfirm: () => void;
  readonly onOther: () => void;
}): ReactNode {
  const t = useTranslations('portal');
  const locale = useLocale();
  const heading = useFocusOnArrival();
  const overtaken = isOvertaken(error);
  const moveGone = overtaken || isChoiceGone(error);
  // The button with the focus goes, and this one stays.
  const other = useFocusOnArrival<HTMLButtonElement>(moveGone);
  return (
    <Card>
      <h2 ref={heading} tabIndex={-1} className="text-heading-h3 text-text-primary outline-none">
        {t('reschedule.confirmTitle')}
      </h2>
      <p className="mt-2 text-body-default text-text-secondary">
        {t('reschedule.from', { when: from })}
      </p>
      <p className="text-body-default text-text-primary">{t('reschedule.to', { when: to })}</p>
      <p className="text-body-default text-text-primary">
        {doctor === undefined
          ? t('reschedule.practiceAssigns')
          : t('reschedule.withDoctor', { doctor: isolate(doctor) })}
      </p>
      <div className="mt-4 flex flex-col gap-2">
        <FormError error={error} notFound={t('book.timeGone')} />
        {moveGone ? null : (
          <Button isPending={pending} onPress={onConfirm}>
            {t('reschedule.confirm')}
          </Button>
        )}
        {/* Reset while a request runs, the page would never hear its answer. */}
        <Button ref={other} variant="outline" isDisabled={pending} onPress={onOther}>
          {t('reschedule.other')}
        </Button>
        {overtaken ? (
          <LinkButton variant="ghost" href={`/${locale}/appointments`}>
            {t('details.back')}
          </LinkButton>
        ) : null}
      </div>
    </Card>
  );
}

/** Nothing to choose: what the appointment is now, and what is left to do about it. */
function NotChangeable({
  details,
  phone,
  focusOnArrival,
}: {
  readonly details: AppointmentDto;
  readonly phone: string | null | undefined;
  readonly focusOnArrival: boolean;
}): ReactNode {
  const t = useTranslations('portal');
  const locale = useLocale();
  const when = t('appointment.when', whenParts(formatOf(details, locale), details.startsAt));
  return (
    <>
      <PageHeading title={t('reschedule.closedTitle')} focusOnArrival={focusOnArrival} />
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge appointment={details} />
          <p className="text-body-default text-text-primary">{when}</p>
        </div>
        {details.status === 'BOOKED' && !details.started ? <TooLateNote phone={phone} /> : null}
        {details.status === 'CANCELLED' ? (
          <p className="text-body-default text-text-secondary">{t('reschedule.closedCancelled')}</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <LinkButton href={`/${locale}/appointments/${details.practiceId}/${details.id}`}>
            {t('details.title')}
          </LinkButton>
          <LinkButton variant="outline" href={`/${locale}/appointments`}>
            {t('details.back')}
          </LinkButton>
        </div>
      </div>
    </>
  );
}

/** Screen 17: the same service at another free time. Nothing changes before the last press. */
export function ReschedulePage({ practiceId, appointmentId }: RescheduleProps): ReactNode {
  const t = useTranslations('portal');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const detailsHref = `/${locale}/appointments/${practiceId}/${appointmentId}`;
  const appointment = useGetMyAppointment(practiceId, appointmentId);
  const practices = useListMyPractices();
  const known = practiceById(practices.data?.items, practiceId);
  const page = useGetPublicPractice(known?.slug ?? '', undefined, {
    query: { enabled: Boolean(known?.slug) },
  });
  const move = useRescheduleAppointment();
  const [target, setTarget] = useState<ChosenTime>();
  const [key, setKey] = useState(() => crypto.randomUUID());
  // The practice now asks for more than the person's details hold (BR-09).
  const [completing, setCompleting] = useState(false);
  // What a press took away had the focus: the heading takes it, each time.
  const [arrival, setArrival] = useState(0);
  const arrive = (): void => {
    setArrival((count) => count + 1);
  };
  if (appointment.isPending || practices.isPending) {
    return (
      <>
        <PageHeading title={t('reschedule.title')} />
        <Loading>{t('list.loading')}</Loading>
      </>
    );
  }
  if (appointment.data === undefined) {
    return (
      <>
        <PageHeading title={t('reschedule.title')} />
        <div className="flex flex-col items-start gap-4">
          {isApiError(appointment.error) && appointment.error.status === 404 ? (
            <p className="text-body-default text-text-primary">{t('details.notFound')}</p>
          ) : (
            <LoadError query={appointment} onPassed={arrive} />
          )}
          <LinkButton variant="outline" href={`/${locale}/appointments`}>
            {t('details.back')}
          </LinkButton>
        </div>
      </>
    );
  }
  const details = appointment.data;
  if (!details.changeable) {
    return (
      <NotChangeable
        details={details}
        phone={page.data?.phone}
        // Not on loading the page: only when a press found out.
        focusOnArrival={target !== undefined || arrival > 0}
      />
    );
  }
  const format = formatOf(details, locale);
  const whenOf = (instant: string): string => t('appointment.when', whenParts(format, instant));
  const heading = (
    <>
      <PageHeading
        key={arrival}
        title={t('reschedule.title')}
        body={t('reschedule.current', { when: whenOf(details.startsAt) })}
        focusOnArrival={arrival > 0}
      />
      {appointment.isRefetchError ? (
        <div className="mb-4">
          <StaleNotice query={appointment} onPassed={arrive} />
        </div>
      ) : null}
    </>
  );
  const wayBack = (
    <LinkButton variant="ghost" className="mt-4" href={detailsHref}>
      {t('details.title')}
    </LinkButton>
  );
  if (practices.data === undefined) {
    return (
      <>
        {heading}
        <LoadError query={practices} onPassed={arrive} />
        {wayBack}
      </>
    );
  }
  const hasNoPage = isApiError(page.error) && page.error.status === 404;
  if (known === undefined || known.slug === null || (page.data === undefined && hasNoPage)) {
    return (
      <>
        {heading}
        <p className="text-body-default text-text-primary">{t('reschedule.noPage')}</p>
        {wayBack}
      </>
    );
  }
  const { slug } = known;
  if (page.data === undefined) {
    return (
      <>
        {heading}
        {page.isPending ? (
          <Loading>{t('list.loading')}</Loading>
        ) : (
          <LoadError query={page} onPassed={arrive} />
        )}
        {wayBack}
      </>
    );
  }
  const { numberingSystem, hourCycle, timeZone, today, weekStart, team, phone } = page.data;
  if (completing) {
    return (
      <NarrowForm>
        <UpdateDetailsStep
          practice={page.data}
          onDone={() => {
            // Back on the same target: the refused attempt took its key back, so this one still fits.
            setCompleting(false);
            move.reset();
          }}
        />
      </NarrowForm>
    );
  }
  if (target !== undefined) {
    const doctor = team.find(({ id }) => id === target.providerId);
    return (
      <>
        {heading}
        <Confirm
          from={whenOf(details.startsAt)}
          to={whenOf(target.startsAt)}
          doctor={doctor === undefined ? undefined : fullNameOf(doctor)}
          pending={move.isPending}
          error={move.error}
          onOther={() => {
            if (isChoiceGone(move.error)) {
              // Younger than 30 seconds, an answer would offer the same time again.
              void queryClient.invalidateQueries({
                queryKey: getGetPublicAvailabilityQueryKey(slug),
              });
              void queryClient.invalidateQueries({ queryKey: getGetPublicFreeTimesQueryKey(slug) });
            }
            move.reset();
            setTarget(undefined);
            setKey(crypto.randomUUID());
            arrive();
          }}
          onConfirm={() => {
            move.mutate(
              {
                practiceId,
                appointmentId,
                data: {
                  startsAt: target.startsAt,
                  ...(target.providerId === undefined ? {} : { providerId: target.providerId }),
                },
                headers: { 'Idempotency-Key': key },
              },
              {
                onSuccess: (moved) => {
                  // The old row is cancelled now: the page of the new one takes over.
                  window.location.replace(`/${locale}/appointments/${practiceId}/${moved.id}`);
                },
                onError: (failure) => {
                  if (failure.code === 'PATIENT_PROFILE_INCOMPLETE') {
                    setCompleting(true);
                    // What this page knows of the practice's rules is out of date, and the form must
                    // ask for what the practice asks now.
                    void page.refetch();
                  } else if (isOvertaken(failure)) void appointment.refetch();
                },
              },
            );
          }}
        />
      </>
    );
  }
  return (
    <>
      {heading}
      <FreeTimesChooser
        slug={slug}
        locale={locale}
        settings={{ numberingSystem, hourCycle, timeZone }}
        today={today}
        weekStart={weekStart}
        services={[{ id: details.serviceId, label: textIn(details.serviceName, locale) }]}
        doctors={doctorsOf(team)}
        phone={phone}
        hint={t('reschedule.hint')}
        // Without a word of the person, a move stays with the doctor it has.
        initialProviderId={details.providerId}
        // This page has no section heading above the chooser, unlike the public one.
        dayHeadingLevel="h2"
        action={{
          href: `${detailsHref}/reschedule`,
          onChoose: (time, event) => {
            event.preventDefault();
            setTarget(time);
          },
        }}
      />
      {wayBack}
    </>
  );
}
