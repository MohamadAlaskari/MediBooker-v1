'use client';

import {
  isApiError,
  useGetDeskDay,
  useGetProfile,
  type DeskAppointmentRowDto,
  type DeskDayDto,
} from '@medibooker/api-client';
import { isolate } from '@medibooker/i18n';
import {
  CalendarDays,
  CalendarX,
  ChevronLeft,
  ChevronRight,
  Clock,
  RefreshCw,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { practiceFormat, type PracticeFormat } from '@/lib/format';
import { FormError } from '../auth/form-parts';
import { textIn } from '../portal/appointment-view';
import { AppointmentSheet } from './appointment-sheet';
import { useDesk } from './desk-context';
import {
  dayPartOf,
  figuresOf,
  initialsOf,
  mainActionOf,
  nextDay,
  statusVariantOf,
} from './desk-view';
import { useDeskChange } from './use-desk-change';

function Figure({
  label,
  value,
  hint,
  Icon,
}: {
  readonly label: string;
  readonly value: string;
  readonly hint: string;
  readonly Icon: LucideIcon;
}): ReactNode {
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-bg-surface p-5">
      <div className="flex items-start gap-3">
        <p className="me-auto text-body-default text-text-secondary">{label}</p>
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-md bg-bg-brand-subtle text-icon-brand"
        >
          <Icon className="size-5" />
        </span>
      </div>
      <p className="text-heading-h1 text-text-primary">{value}</p>
      <p className="text-body-small text-text-secondary">{hint}</p>
    </li>
  );
}

function Figures({ day, format }: { readonly day: DeskDayDto; readonly format: PracticeFormat }) {
  const t = useTranslations('dashboard.today');
  const figures = figuresOf(day);
  return (
    <section aria-labelledby="day-figures">
      <h2 id="day-figures" className="sr-only">
        {t('figures')}
      </h2>
      <ul className="grid grid-cols-1 gap-4 tablet:grid-cols-2 desktop:grid-cols-4">
        <Figure
          label={t('appointments')}
          value={format.number(figures.appointments)}
          hint={t('appointmentsHint', { count: format.number(figures.completed) })}
          Icon={CalendarDays}
        />
        <Figure
          label={t('arrived')}
          value={format.number(figures.arrived)}
          hint={t('arrivedHint', { count: format.number(figures.waiting) })}
          Icon={Users}
        />
        <Figure
          label={t('openTimes')}
          value={format.number(figures.openTimes)}
          hint={
            figures.nextOpenAt === null
              ? t('openTimesNone')
              : t('openTimesNext', { time: format.instantTime(figures.nextOpenAt) })
          }
          Icon={Clock}
        />
        <Figure
          label={t('cancelled')}
          value={format.number(figures.cancelled)}
          hint={t('cancelledHint', { count: format.number(figures.noShow) })}
          Icon={CalendarX}
        />
      </ul>
    </section>
  );
}

function Row({
  row,
  format,
  isPending,
  isBusy,
  onAct,
  onOpen,
}: {
  readonly row: DeskAppointmentRowDto;
  readonly format: PracticeFormat;
  readonly isPending: boolean;
  readonly isBusy: boolean;
  readonly onAct: (action: 'CHECK_IN' | 'COMPLETE') => void;
  readonly onOpen: () => void;
}): ReactNode {
  const t = useTranslations('dashboard.today');
  const dashboard = useTranslations('dashboard');
  const locale = useLocale();
  const { patient } = row;
  const fullName = `${patient.firstName} ${patient.lastName}`;
  const name = isolate(fullName);
  const time = format.instantTime(row.startsAt);
  const main = mainActionOf(row);
  const cell = 'px-5 py-3 align-middle';
  return (
    <tr className="border-t border-border-subtle">
      <td className={`${cell} text-label-large whitespace-nowrap text-text-primary`}>{time}</td>
      <td className={cell}>
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-bg-brand-subtle text-label-small text-text-brand"
          >
            {initialsOf(patient.firstName, patient.lastName, locale)}
          </span>
          <div className="min-w-0">
            <p dir="auto" className="text-label-default text-text-primary">
              {fullName}
            </p>
            <p className="text-body-small text-text-secondary">
              {t('patientLine', {
                insurance: patient.insuranceType,
                online: row.bookedOnline ? 'yes' : 'no',
              })}
            </p>
          </div>
        </div>
      </td>
      <td className={`${cell} text-body-default text-text-primary`}>
        <span dir="auto">{textIn(row.serviceName, locale)}</span>
      </td>
      <td className={`${cell} text-body-default text-text-secondary`}>
        <span dir="auto">{row.providerName}</span>
      </td>
      <td className={cell}>
        <Badge variant={statusVariantOf(row.status)}>
          {dashboard('status', { status: row.status })}
        </Badge>
      </td>
      <td className={cell}>
        <div className="flex justify-end gap-2">
          {main === undefined ? null : (
            <Button
              // A new button for a new change: a second press of "check in" never completes the visit.
              key={main}
              variant="outline"
              isPending={isPending}
              isDisabled={isBusy}
              aria-label={t('rowAction', {
                action: t(main === 'CHECK_IN' ? 'checkIn' : 'complete'),
                name,
                time,
              })}
              onPress={() => {
                onAct(main);
              }}
            >
              {t(main === 'CHECK_IN' ? 'checkIn' : 'complete')}
            </Button>
          )}
          <Button
            variant="ghost"
            className="text-text-brand"
            aria-label={t('rowAction', { action: t('details'), name, time })}
            onPress={onOpen}
          >
            {t('details')}
          </Button>
        </div>
      </td>
    </tr>
  );
}

function Appointments({
  day,
  format,
  isToday,
  onOpen,
  onDone,
}: {
  readonly day: DeskDayDto;
  readonly format: PracticeFormat;
  readonly isToday: boolean;
  readonly onOpen: (id: string) => void;
  readonly onDone: (news: string) => void;
}): ReactNode {
  const t = useTranslations('dashboard.today');
  const { practiceId } = useDesk();
  const change = useDeskChange(practiceId);
  const stale = isApiError(change.error, 'INVALID_STATUS_TRANSITION');
  const cell = 'px-5 py-3 text-start text-body-small';
  return (
    <section
      aria-labelledby="day-appointments"
      className="mt-8 rounded-lg border border-border-subtle bg-bg-surface"
    >
      <h2 id="day-appointments" className="px-5 py-4 text-heading-h3 text-text-primary">
        {t('listTitle', { today: isToday ? 'yes' : 'no', date: format.dayLong(day.date) })}
      </h2>
      <div className="px-5">
        {stale ? (
          <p role="alert" className="pb-4 text-body-default text-text-danger">
            {t('stale')}
          </p>
        ) : (
          <FormError error={change.error} />
        )}
        {day.truncated ? (
          <p className="pb-4 text-body-default text-text-secondary">
            {t('truncated', { count: format.number(day.items.length) })}
          </p>
        ) : null}
      </div>
      {day.items.length === 0 ? (
        <p className="px-5 pb-5 text-body-default text-text-secondary">{t('empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] border-collapse">
            <thead className="bg-bg-subtle text-text-secondary">
              <tr>
                <th scope="col" className={cell}>
                  {t('time')}
                </th>
                <th scope="col" className={cell}>
                  {t('patient')}
                </th>
                <th scope="col" className={cell}>
                  {t('service')}
                </th>
                <th scope="col" className={cell}>
                  {t('doctor')}
                </th>
                <th scope="col" className={cell}>
                  {t('status')}
                </th>
                <th scope="col" className={cell}>
                  <span className="sr-only">{t('actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {day.items.map((row) => (
                <Row
                  key={row.id}
                  row={row}
                  format={format}
                  isPending={change.isPending && change.variables.appointmentId === row.id}
                  isBusy={change.isPending}
                  onOpen={() => {
                    onOpen(row.id);
                  }}
                  onAct={(action) => {
                    change.mutate(
                      { action, appointmentId: row.id },
                      {
                        onSuccess: () => {
                          const name = isolate(`${row.patient.firstName} ${row.patient.lastName}`);
                          onDone(t('done', { action, name }));
                        },
                      },
                    );
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** W1: the day of the practice for its team, today unless another day is chosen. */
export function TodayPage(): ReactNode {
  const t = useTranslations('dashboard.today');
  const locale = useLocale();
  const { practiceId } = useDesk();
  const [date, setDate] = useState<string | undefined>(undefined);
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  const [news, setNews] = useState('');
  // A change on a row takes its button away: the focus goes to what it did.
  const newsRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (news !== '') newsRef.current?.focus();
  }, [news]);
  const day = useGetDeskDay(practiceId, date === undefined ? undefined : { date }, {
    query: { retry: false },
  });
  const profile = useGetProfile({ query: { retry: false } });
  const announce = (message: string): void => {
    setNews(message);
  };
  if (day.data === undefined) {
    return day.isPending ? (
      <p role="status" className="text-body-default text-text-secondary">
        {t('loading')}
      </p>
    ) : (
      <FormError error={day.error} />
    );
  }
  const current = day.data;
  const format = practiceFormat(locale, current);
  const isToday = current.date === current.today;
  const part = dayPartOf(format.instantHour(current.now));
  const firstName = profile.data?.firstName;
  const heading = !isToday
    ? t('otherDay')
    : firstName === undefined
      ? t('greeting', { part })
      : t('greetingName', { part, name: isolate(firstName) });
  const goTo = (target: string | undefined): void => {
    setNews('');
    setDate(target === current.today ? undefined : target);
  };
  return (
    <>
      <header className="mb-6 flex flex-wrap items-end gap-4">
        <div className="me-auto min-w-0">
          <p className="text-body-default text-text-secondary">
            {format.dayLongWithYear(current.date)}
          </p>
          <h1 className="text-heading-h1 text-text-primary">{heading}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label={t('previous')}
            onPress={() => {
              goTo(nextDay(current.date, -1));
            }}
          >
            <ChevronLeft aria-hidden className="rtl:-scale-x-100" />
          </Button>
          {isToday ? null : (
            <Button
              variant="outline"
              onPress={() => {
                goTo(undefined);
              }}
            >
              {t('today')}
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            aria-label={t('next')}
            onPress={() => {
              goTo(nextDay(current.date, 1));
            }}
          >
            <ChevronRight aria-hidden className="rtl:-scale-x-100" />
          </Button>
          <Button
            variant="outline"
            isPending={day.isFetching}
            onPress={() => {
              setNews('');
              void day.refetch();
            }}
          >
            <RefreshCw aria-hidden data-icon="inline-start" />
            {t('refresh')}
          </Button>
        </div>
      </header>
      <p
        ref={newsRef}
        role="status"
        tabIndex={-1}
        className="mb-4 text-body-default text-text-success outline-none empty:hidden"
      >
        {news}
      </p>
      <Figures day={current} format={format} />
      <Appointments
        day={current}
        format={format}
        isToday={isToday}
        onOpen={setOpenId}
        onDone={announce}
      />
      <AppointmentSheet
        appointmentId={openId}
        onClose={() => {
          setOpenId(undefined);
        }}
        onDone={announce}
      />
    </>
  );
}
