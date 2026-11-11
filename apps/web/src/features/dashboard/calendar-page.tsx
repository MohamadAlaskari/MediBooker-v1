'use client';

import {
  useGetDeskCatalog,
  useGetDeskWeek,
  useUpdateSlot,
  type DeskWeekAppointmentDto,
  type DeskWeekSlotDto,
} from '@medibooker/api-client';
import { isolate } from '@medibooker/i18n';
import { keepPreviousData } from '@tanstack/react-query';
import { CalendarClock, ChevronLeft, ChevronRight } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Label } from 'react-aria-components';
import { Button, LinkButton } from '@/components/ui/button';
import { DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { practiceFormat, type PracticeFormat } from '@/lib/format';
import { cn } from '@/lib/utils';
import { FormError } from '../auth/form-parts';
import { textIn } from '../portal/appointment-view';
import { AppointmentSheet } from './appointment-sheet';
import { calendarGrid, minutesOf, type CalendarCell } from './calendar-view';
import { useDesk } from './desk-context';
import { nextDay, statusVariantOf, type StatusVariant } from './desk-view';
import { useInvalidatePractice } from './setup-parts';

const LABEL = 'text-label-default text-text-primary';
const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus';
const CELL = 'flex min-h-touch-target w-full flex-col justify-center rounded-md px-3 py-1';

/** The colours of Figma's calendar events: a line at the start and a tint, per status. */
const TONES: Readonly<Record<StatusVariant, string>> = {
  brandSubtle: 'border-s-4 border-border-brand bg-bg-brand-subtle text-text-brand',
  info: 'border-s-4 border-bg-info bg-bg-info-subtle text-text-info',
  success: 'border-s-4 border-bg-success bg-bg-success-subtle text-text-success',
  warning: 'border-s-4 border-bg-warning bg-bg-warning-subtle text-text-warning',
  danger: 'border-s-4 border-border-danger bg-bg-danger-subtle text-text-danger',
};

/** The appointment that holds a time: a press opens it (W6). */
function Held({
  appointment,
  startsAt,
  format,
  onOpen,
}: {
  readonly appointment: DeskWeekAppointmentDto;
  readonly startsAt: string;
  readonly format: PracticeFormat;
  readonly onOpen: (id: string) => void;
}): ReactNode {
  const locale = useLocale();
  const name = `${appointment.patient.firstName} ${appointment.patient.lastName}`;
  const service = textIn(appointment.serviceName, locale);
  return (
    <button
      type="button"
      onClick={() => {
        onOpen(appointment.id);
      }}
      className={cn(
        CELL,
        'items-start text-start',
        TONES[statusVariantOf(appointment.status)],
        FOCUS_RING,
      )}
    >
      <span dir="auto" className="w-full truncate text-label-default">
        {name}
      </span>
      <span dir="auto" className="w-full truncate text-body-small">
        {service}
      </span>
      {/* Its name is what it shows, and the time that the row says: label in name (WCAG 2.5.3). */}
      <span className="sr-only">{format.instantTime(startsAt)}</span>
    </button>
  );
}

/** A free or blocked time of a doctor the person plans: a press asks to block or free it (BR-07). */
function SlotChange({
  slot,
  format,
  onDone,
}: {
  readonly slot: DeskWeekSlotDto;
  readonly format: PracticeFormat;
  readonly onDone: (news: string) => void;
}): ReactNode {
  const t = useTranslations('dashboard.calendar');
  const { practiceId } = useDesk();
  const invalidate = useInvalidatePractice();
  const update = useUpdateSlot({ mutation: { onSettled: invalidate } });
  const [isOpen, setOpen] = useState(false);
  const blocked = slot.status === 'BLOCKED';
  const time = format.instantTime(slot.startsAt);
  const day = format.dayLong(format.instantDate(slot.startsAt));
  return (
    <DialogTrigger
      isOpen={isOpen}
      onOpenChange={(open) => {
        setOpen(open);
        if (!open) update.reset();
      }}
    >
      <Button
        variant="ghost"
        className={cn(
          CELL,
          'h-auto items-start whitespace-normal text-start text-body-small',
          blocked
            ? 'bg-bg-muted text-text-secondary'
            : 'border border-dashed border-border-strong text-text-secondary',
        )}
      >
        {blocked ? t('blocked') : t('availableFor', { minutes: format.number(minutesOf(slot)) })}
        {/* Its name is what it shows, and the time that the row says: label in name (WCAG 2.5.3). */}
        <span className="sr-only">{time}</span>
      </Button>
      <DialogContent
        title={blocked ? t('unblockTitle') : t('blockTitle')}
        description={blocked ? t('unblockBody', { time, day }) : t('blockBody', { time, day })}
        isDismissable={!update.isPending}
      >
        {(close) => (
          <div className="flex flex-col gap-4">
            <FormError error={update.error} />
            <Button
              variant={blocked ? 'default' : 'danger'}
              isPending={update.isPending}
              onPress={() => {
                update.mutate(
                  {
                    practiceId,
                    slotId: slot.id,
                    data: { status: blocked ? 'OPEN' : 'BLOCKED' },
                  },
                  {
                    onSuccess: () => {
                      close();
                      onDone(
                        blocked
                          ? t('unblockedNews', { time, day })
                          : t('blockedNews', { time, day }),
                      );
                    },
                  },
                );
              }}
            >
              {blocked ? t('unblock') : t('block')}
            </Button>
            <Button variant="outline" isDisabled={update.isPending} onPress={close}>
              {t('cancel')}
            </Button>
          </div>
        )}
      </DialogContent>
    </DialogTrigger>
  );
}

function Cell({
  cell,
  past,
  format,
  onOpen,
  canPlan,
  onNews,
}: {
  readonly cell: CalendarCell;
  /** Its time has gone: a free one is shown, but no longer as something to offer. */
  readonly past: (slot: DeskWeekSlotDto) => boolean;
  readonly format: PracticeFormat;
  readonly onOpen: (id: string) => void;
  /** The person plans this doctor: the reception, the admin, or the doctor itself (M04). */
  readonly canPlan: boolean;
  readonly onNews: (news: string) => void;
}): ReactNode {
  const t = useTranslations('dashboard.calendar');
  if (cell.kind === 'empty') return null;
  if (cell.kind === 'absence') {
    return (
      <p className={cn(CELL, 'bg-bg-muted text-body-small text-text-secondary')}>
        {t('absence', { reason: cell.reason })}
      </p>
    );
  }
  const { slot } = cell;
  if (slot.appointment !== null) {
    return (
      <Held
        appointment={slot.appointment}
        startsAt={slot.startsAt}
        format={format}
        onOpen={onOpen}
      />
    );
  }
  if (canPlan && !past(slot) && (slot.status === 'BLOCKED' || slot.status === 'OPEN')) {
    return <SlotChange slot={slot} format={format} onDone={onNews} />;
  }
  if (slot.status === 'BLOCKED') {
    return (
      <p className={cn(CELL, 'bg-bg-muted text-body-small text-text-secondary')}>{t('blocked')}</p>
    );
  }
  return (
    <p
      className={cn(
        CELL,
        'border border-dashed border-border-strong text-body-small',
        past(slot) ? 'text-text-tertiary' : 'text-text-secondary',
      )}
    >
      {t('availableFor', { minutes: format.number(minutesOf(slot)) })}
    </p>
  );
}

/** What the colours mean, as in Figma. */
function Legend(): ReactNode {
  const t = useTranslations('dashboard.calendar');
  const entries = [
    { label: t('booked'), mark: 'bg-bg-brand' },
    { label: t('checkedIn'), mark: 'bg-bg-info' },
    { label: t('available'), mark: 'border border-dashed border-border-strong' },
    { label: t('blocked'), mark: 'bg-bg-muted' },
  ];
  return (
    <ul aria-label={t('legend')} className="flex flex-wrap items-center gap-2">
      {entries.map(({ label, mark }) => (
        <li
          key={label}
          className="flex items-center gap-2 rounded-full bg-bg-subtle px-3 py-1 text-body-small text-text-secondary"
        >
          <span aria-hidden className={cn('size-2 rounded-full', mark)} />
          {label}
        </li>
      ))}
    </ul>
  );
}

/** W2: one doctor's week, a row per time and a column per working day, as in Figma. */
export function CalendarPage(): ReactNode {
  const t = useTranslations('dashboard.calendar');
  const locale = useLocale();
  const { practiceId, role, providerId: own } = useDesk();
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const [from, setFrom] = useState<string | undefined>(undefined);
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  const [news, setNews] = useState('');
  const newsRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (news !== '') newsRef.current?.focus();
  }, [news]);
  const catalog = useGetDeskCatalog(practiceId, { query: { retry: false } });
  const providers = catalog.data?.providers ?? [];
  const providerId = chosen ?? providers[0]?.id;
  const doctor = providers.find(({ id }) => id === providerId)?.name ?? '';
  const week = useGetDeskWeek(
    practiceId,
    { providerId: providerId ?? '', ...(from === undefined ? {} : { from }) },
    {
      query: { enabled: providerId !== undefined, retry: false, placeholderData: keepPreviousData },
    },
  );
  // Another doctor's week waits for its own: the old one must not stand under the new name.
  const data = week.data?.providerId === providerId ? week.data : undefined;
  const format = data === undefined ? undefined : practiceFormat(locale, data);
  const grid = data === undefined || format === undefined ? undefined : calendarGrid(data, format);
  const shift = (days: number): void => {
    if (data === undefined) return;
    setNews('');
    setFrom(nextDay(data.from, days));
  };
  const past = (slot: DeskWeekSlotDto): boolean =>
    data !== undefined && Date.parse(slot.startsAt) < Date.parse(data.now);
  return (
    <>
      <header className="mb-6 flex flex-wrap items-end gap-4">
        <div className="me-auto min-w-0">
          <h1 className="text-heading-h1 text-text-primary">{t('title')}</h1>
          <p className="text-body-default text-text-secondary">
            {data === undefined || format === undefined
              ? String.fromCodePoint(0xa0)
              : t('week', { from: format.day(data.from), to: format.day(data.to) })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LinkButton variant="outline" href={`/${locale}/dashboard/calendar/working-hours`}>
            <CalendarClock aria-hidden data-icon="inline-start" />
            {t('workingHours')}
          </LinkButton>
          <Button
            variant="outline"
            size="icon"
            aria-label={t('previousWeek')}
            isDisabled={data === undefined}
            onPress={() => {
              shift(-7);
            }}
          >
            <ChevronLeft aria-hidden className="rtl:-scale-x-100" />
          </Button>
          {from === undefined ? null : (
            <Button
              variant="outline"
              onPress={() => {
                setFrom(undefined);
              }}
            >
              {t('thisWeek')}
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            aria-label={t('nextWeek')}
            isDisabled={data === undefined}
            onPress={() => {
              shift(7);
            }}
          >
            <ChevronRight aria-hidden className="rtl:-scale-x-100" />
          </Button>
        </div>
      </header>
      <section className="mb-6 flex flex-wrap items-end gap-4">
        {providers.length === 0 ? null : (
          <div className="w-full tablet:w-auto tablet:min-w-[18rem]">
            <Select
              value={providerId ?? null}
              onChange={(key) => {
                if (key === null) return;
                setNews('');
                setChosen(String(key));
              }}
            >
              <Label className={LABEL}>{t('doctor')}</Label>
              <SelectTrigger className="mt-2" />
              <SelectContent>
                {providers.map(({ id, name }) => (
                  <SelectItem key={id} id={id} textValue={name}>
                    <bdi>{name}</bdi>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <Legend />
      </section>
      <p
        ref={newsRef}
        role="status"
        tabIndex={-1}
        className="mb-4 text-body-default text-text-success outline-none empty:hidden"
      >
        {news}
      </p>
      <section
        aria-label={t('title')}
        className="rounded-lg border border-border-subtle bg-bg-surface p-4"
      >
        {catalog.data !== undefined && providers.length === 0 ? (
          <p className="text-body-default text-text-secondary">{t('noDoctor')}</p>
        ) : data === undefined || format === undefined || grid === undefined ? (
          week.isError || catalog.isError ? (
            <FormError error={week.error ?? catalog.error} />
          ) : (
            <p role="status" className="text-body-default text-text-secondary">
              {t('loading')}
            </p>
          )
        ) : grid.rows.length === 0 ? (
          <p className="text-body-default text-text-secondary">{t('empty')}</p>
        ) : (
          <div className="flex flex-col gap-3 overflow-x-auto">
            {data.truncated ? (
              <p role="note" className="text-body-small text-text-secondary">
                {t('truncated')}
              </p>
            ) : null}
            <table className="w-full min-w-[40rem] border-separate border-spacing-2 text-start">
              <caption className="sr-only">{t('grid', { doctor: isolate(doctor) })}</caption>
              <thead>
                <tr>
                  <th scope="col" className="w-16 text-start text-body-small text-text-secondary">
                    {t('time')}
                  </th>
                  {grid.days.map((day) => (
                    <th
                      key={day}
                      scope="col"
                      aria-current={day === data.today ? 'date' : undefined}
                      className={cn(
                        'rounded-md px-3 py-2 text-center text-label-default',
                        day === data.today
                          ? 'bg-bg-brand-subtle text-text-brand'
                          : 'text-text-primary',
                      )}
                    >
                      {format.weekdayShort(day)} {format.dayOfMonth(day)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((row) => (
                  <tr key={row.time}>
                    <th
                      scope="row"
                      className="tabular-times align-top text-start text-body-small text-text-secondary"
                    >
                      {format.instantTime(row.startsAt)}
                    </th>
                    {row.cells.map((cell, index) => (
                      <td key={grid.days[index] ?? index} className="align-top">
                        <Cell
                          cell={cell}
                          past={past}
                          format={format}
                          onOpen={setOpenId}
                          canPlan={role !== 'DOCTOR' || own === providerId}
                          onNews={setNews}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <AppointmentSheet
        appointmentId={openId}
        onClose={() => {
          setOpenId(undefined);
        }}
        onDone={setNews}
      />
    </>
  );
}
