'use client';

import { isApiError, useGetDeskAppointment, type DeskAppointmentDto } from '@medibooker/api-client';
import { isolate } from '@medibooker/i18n';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { practiceFormat, type PracticeFormat } from '@/lib/format';
import { FormError } from '../auth/form-parts';
import { textIn } from '../portal/appointment-view';
import { CancelDialog } from './cancel-dialog';
import { useDesk } from './desk-context';
import { initialsOf, statusVariantOf } from './desk-view';
import { useDeskChange, type DeskChangeAction } from './use-desk-change';

const LABELS = {
  CHECK_IN: 'checkIn',
  COMPLETE: 'complete',
  NO_SHOW: 'noShow',
} as const satisfies Readonly<Record<Exclude<DeskChangeAction, 'CANCEL'>, string>>;

type Hint = 'hintFuture' | 'hintPast' | 'hintBeforeStart';

function when(format: PracticeFormat, instant: string): string {
  return `${format.dayLong(format.instantDate(instant))} ${format.instantTime(instant)}`;
}

function Fact({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-body-small text-text-secondary">{label}</dt>
      <dd className="text-body-default text-text-primary">{children}</dd>
    </div>
  );
}

/** Why an action is not offered yet, as the API's answer says: only for a booked appointment. */
function hintOf({ status, day, started }: DeskAppointmentDto): Hint | undefined {
  if (status !== 'BOOKED') return undefined;
  if (day === 'FUTURE') return 'hintFuture';
  if (day === 'PAST') return 'hintPast';
  return started ? undefined : 'hintBeforeStart';
}

function Details({
  appointment,
  onDone,
}: {
  readonly appointment: DeskAppointmentDto;
  readonly onDone: (news: string) => void;
}): ReactNode {
  const t = useTranslations('dashboard.details');
  const today = useTranslations('dashboard.today');
  const dashboard = useTranslations('dashboard');
  const locale = useLocale();
  const { practiceId } = useDesk();
  const change = useDeskChange(practiceId);
  const format = practiceFormat(locale, appointment);
  const { patient } = appointment;
  const fullName = `${patient.firstName} ${patient.lastName}`;
  const name = isolate(fullName);
  const hint = hintOf(appointment);
  const stale = isApiError(change.error, 'INVALID_STATUS_TRANSITION');
  // A change takes its own button away: the focus goes to what it did, so that it stays in the
  // drawer, Escape still closes it, and a screen reader says what happened.
  const [news, setNews] = useState('');
  const newsRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (news !== '') newsRef.current?.focus();
  }, [news]);
  const done = (message: string): void => {
    setNews(message);
    onDone(message);
  };
  return (
    <>
      <section className="flex flex-wrap items-center gap-4 rounded-lg bg-bg-subtle p-5">
        <span
          aria-hidden
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-bg-brand-subtle text-label-large text-text-brand"
        >
          {initialsOf(patient.firstName, patient.lastName, locale)}
        </span>
        <div className="min-w-0 flex-1">
          <h3 dir="auto" className="text-heading-h3 text-text-primary">
            {fullName}
          </h3>
          <p className="text-body-default text-text-secondary">
            {t('born', {
              date: format.calendarDate(patient.dateOfBirth),
              age: patient.age,
            })}
            {' · '}
            {t('insurance', { type: patient.insuranceType })}
            {patient.insuranceProvider === null ? null : (
              <>
                {' · '}
                <span dir="auto">{patient.insuranceProvider}</span>
              </>
            )}
          </p>
          <dl className="mt-1 flex flex-wrap gap-x-4 text-body-default text-text-secondary">
            {patient.phone === null ? null : (
              <div className="flex gap-1">
                <dt>{t('phone')}:</dt>
                <dd dir="ltr">{patient.phone}</dd>
              </div>
            )}
            {patient.email === null ? null : (
              <div className="flex min-w-0 gap-1">
                <dt>{t('email')}:</dt>
                <dd dir="ltr" className="truncate">
                  {patient.email}
                </dd>
              </div>
            )}
          </dl>
        </div>
      </section>
      <dl className="grid grid-cols-1 gap-4 tablet:grid-cols-2">
        <Fact label={t('statusLabel')}>
          <Badge variant={statusVariantOf(appointment.status)}>
            {dashboard('status', { status: appointment.status })}
          </Badge>
        </Fact>
        <Fact label={t('serviceLabel')}>
          {t('serviceValue', {
            service: isolate(textIn(appointment.serviceName, locale)),
            minutes: format.number(appointment.durationMinutes),
          })}
        </Fact>
        <Fact label={t('doctorLabel')}>
          <span dir="auto">{appointment.providerName}</span>
        </Fact>
        <Fact label={t('bookedLabel')}>
          {t('bookedValue', {
            online: appointment.bookedOnline ? 'yes' : 'no',
            when: when(format, appointment.bookedAt),
          })}
        </Fact>
      </dl>
      <section className="flex flex-col gap-1">
        <h3 className="text-body-small text-text-secondary">{t('noteLabel')}</h3>
        <p dir="auto" className="text-body-default whitespace-pre-line text-text-primary">
          {appointment.patientNote ?? t('noNote')}
        </p>
      </section>
      {appointment.checkedInAt === null ? null : (
        <p className="text-body-default text-text-primary">
          {t('checkedInAt', { time: format.instantTime(appointment.checkedInAt) })}
          {appointment.completedAt === null
            ? null
            : ` · ${t('completedAt', { time: format.instantTime(appointment.completedAt) })}`}
        </p>
      )}
      {appointment.status === 'CANCELLED' ? (
        <p dir="auto" className="text-body-default text-text-primary">
          {appointment.cancelledByPractice
            ? t('cancelledByPractice', { reason: isolate(appointment.cancelReason ?? '') })
            : t('cancelledByPatient')}
        </p>
      ) : null}
      <p
        ref={newsRef}
        role="status"
        tabIndex={-1}
        className="text-body-default text-text-success outline-none empty:hidden"
      >
        {news}
      </p>
      {appointment.actions.length === 0 && hint === undefined ? null : (
        <section className="flex flex-col gap-3 border-t border-border-subtle pt-5">
          {stale ? (
            <p role="alert" className="text-body-default text-text-danger">
              {today('stale')}
            </p>
          ) : (
            <FormError error={change.error} />
          )}
          <div className="flex flex-wrap items-center gap-3">
            {appointment.actions.includes('CANCEL') ? (
              <CancelDialog appointment={appointment} onDone={done} />
            ) : null}
            {(['CHECK_IN', 'COMPLETE', 'NO_SHOW'] as const)
              .filter((action) => appointment.actions.includes(action))
              .map((action) => (
                <Button
                  key={action}
                  variant={action === 'NO_SHOW' ? 'outline' : 'default'}
                  isPending={change.isPending && change.variables.action === action}
                  isDisabled={change.isPending}
                  onPress={() => {
                    change.mutate(
                      { action, appointmentId: appointment.id },
                      {
                        onSuccess: () => {
                          done(today('done', { action, name }));
                        },
                      },
                    );
                  }}
                >
                  {t(LABELS[action])}
                </Button>
              ))}
          </div>
          {hint === undefined ? null : (
            <p className="text-body-small text-text-secondary">{t(hint)}</p>
          )}
        </section>
      )}
      <p className="mt-auto text-caption text-text-tertiary">{t('audited')}</p>
    </>
  );
}

/** W6: one appointment for the team, opened from a row of the day. Every opening is audited. */
export function AppointmentSheet({
  appointmentId,
  onClose,
  onDone,
}: {
  readonly appointmentId: string | undefined;
  readonly onClose: () => void;
  readonly onDone: (news: string) => void;
}): ReactNode {
  const t = useTranslations('dashboard.details');
  const locale = useLocale();
  const { practiceId } = useDesk();
  const details = useGetDeskAppointment(practiceId, appointmentId ?? '', {
    query: { enabled: appointmentId !== undefined, retry: false },
  });
  const appointment = details.data;
  const format = appointment === undefined ? undefined : practiceFormat(locale, appointment);
  const title =
    appointment === undefined || format === undefined
      ? t('loading')
      : t('title', {
          service: isolate(textIn(appointment.serviceName, locale)),
          date: format.dayLong(format.instantDate(appointment.startsAt)),
          time: format.instantTime(appointment.startsAt),
        });
  return (
    <Sheet
      isOpen={appointmentId !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      kicker={t('kicker')}
      title={title}
      closeLabel={t('close')}
    >
      {appointment === undefined ? (
        details.isPending ? (
          <p role="status" className="text-body-default text-text-secondary">
            {t('loading')}
          </p>
        ) : (
          <FormError error={details.error} />
        )
      ) : (
        <Details appointment={appointment} onDone={onDone} />
      )}
    </Sheet>
  );
}
