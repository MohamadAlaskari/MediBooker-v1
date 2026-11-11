'use client';

import {
  useGetDeskCatalog,
  useSearchDeskAppointments,
  type DeskAppointmentRowDto,
  type DeskAppointmentSearchDto,
  type DeskAppointmentSearchDtoStatus,
} from '@medibooker/api-client';
import { keepPreviousData } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Label } from 'react-aria-components';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { TextField } from '@/components/ui/text-field';
import { practiceFormat, type PracticeFormat } from '@/lib/format';
import { FormError } from '../auth/form-parts';
import { textIn } from '../portal/appointment-view';
import { AppointmentSheet } from './appointment-sheet';
import { AppointmentTable, type RowGroup } from './appointment-table';
import { BookForPatient } from './book-for-patient';
import { useDesk } from './desk-context';
import { nextDay } from './desk-view';
import { Pager, useCursorPages, useSettled } from './pager';

const PAGE_SIZE = 20;
const ALL = 'all';
const STATUSES: readonly DeskAppointmentSearchDtoStatus[] = [
  'BOOKED',
  'CHECKED_IN',
  'COMPLETED',
  'NO_SHOW',
  'CANCELLED',
];
const LABEL = 'text-label-default text-text-primary';

/** One heading per day, in the order of the list. */
function byDay(
  items: readonly DeskAppointmentRowDto[],
  format: PracticeFormat,
  label: (date: string) => string,
): RowGroup[] {
  const groups: { key: string; label: string; rows: DeskAppointmentRowDto[] }[] = [];
  for (const row of items) {
    const date = format.instantDate(row.startsAt);
    const last = groups.at(-1);
    if (last?.key === date) last.rows.push(row);
    else groups.push({ key: date, label: label(date), rows: [row] });
  }
  return groups;
}

function Choice({
  label,
  value,
  onChange,
  options,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly { readonly id: string; readonly label: string }[];
}): ReactNode {
  return (
    <Select
      value={value}
      onChange={(key) => {
        onChange(String(key));
      }}
    >
      <Label className={LABEL}>{label}</Label>
      <SelectTrigger className="mt-2" />
      <SelectContent>
        {options.map(({ id, label: text }) => (
          <SelectItem key={id} id={id} textValue={text}>
            <bdi>{text}</bdi>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** W5: the appointments of a week, narrowed by patient, doctor, status and service. */
export function AppointmentsPage(): ReactNode {
  const t = useTranslations('dashboard.appointments');
  const dashboard = useTranslations('dashboard');
  const locale = useLocale();
  const { practiceId } = useDesk();
  const [range, setRange] = useState<{ from: string; to: string } | undefined>(undefined);
  const [providerId, setProviderId] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [serviceId, setServiceId] = useState(ALL);
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  const [news, setNews] = useState('');
  const newsRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (news !== '') newsRef.current?.focus();
  }, [news]);
  const query = useSettled(search.trim());
  const pages = useCursorPages(JSON.stringify([range, providerId, status, serviceId, query]));
  // In the body of the search, never in a URL: a name or a number typed here is personal data.
  const body: DeskAppointmentSearchDto = {
    ...range,
    ...(providerId === ALL ? {} : { providerId }),
    ...(status === ALL ? {} : { status: status as DeskAppointmentSearchDtoStatus }),
    ...(serviceId === ALL ? {} : { serviceId }),
    ...(query.length >= 2 ? { query } : {}),
    limit: PAGE_SIZE,
    ...(pages.cursor === undefined ? {} : { cursor: pages.cursor }),
  };
  const list = useSearchDeskAppointments(practiceId, body, {
    query: { retry: false, placeholderData: keepPreviousData },
  });
  const catalog = useGetDeskCatalog(practiceId, { query: { retry: false } });
  const data = list.data;
  const format = data === undefined ? undefined : practiceFormat(locale, data);
  const shift = (days: number): void => {
    if (data === undefined) return;
    setNews('');
    setRange({ from: nextDay(data.from, days), to: nextDay(data.to, days) });
  };
  return (
    <>
      <header className="mb-6 flex flex-wrap items-end gap-4">
        <div className="me-auto min-w-0">
          <p className="text-body-default text-text-secondary">
            {data === undefined || format === undefined
              ? String.fromCodePoint(0xa0)
              : t('range', { from: format.day(data.from), to: format.day(data.to) })}
          </p>
          <h1 className="text-heading-h1 text-text-primary">{t('title')}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          {range === undefined ? null : (
            <Button
              variant="outline"
              onPress={() => {
                setRange(undefined);
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
          {format === undefined ? null : <BookForPatient format={format} onBooked={setNews} />}
        </div>
      </header>
      <section
        aria-label={t('filters')}
        className="mb-6 grid grid-cols-1 gap-4 tablet:grid-cols-2 desktop:grid-cols-[2fr_1fr_1fr_1fr]"
      >
        <TextField label={t('search')} value={search} onChange={setSearch} />
        <Choice
          label={t('doctor')}
          value={providerId}
          onChange={setProviderId}
          options={[
            { id: ALL, label: t('allDoctors') },
            ...(catalog.data?.providers ?? []).map(({ id, name }) => ({ id, label: name })),
          ]}
        />
        <Choice
          label={t('status')}
          value={status}
          onChange={setStatus}
          options={[
            { id: ALL, label: t('allStatuses') },
            ...STATUSES.map((id) => ({ id, label: dashboard('status', { status: id }) })),
          ]}
        />
        <Choice
          label={t('service')}
          value={serviceId}
          onChange={setServiceId}
          options={[
            { id: ALL, label: t('allServices') },
            ...(catalog.data?.services ?? []).map(({ id, name }) => ({
              id,
              label: textIn(name, locale),
            })),
          ]}
        />
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
        className="rounded-lg border border-border-subtle bg-bg-surface"
      >
        {data === undefined || format === undefined ? (
          list.isPending ? (
            <p role="status" className="p-5 text-body-default text-text-secondary">
              {t('loading')}
            </p>
          ) : (
            <div className="p-5">
              <FormError error={list.error} />
            </div>
          )
        ) : (
          <>
            <div className="pt-4" />
            {data.items.length === 0 ? (
              <p className="px-5 pb-5 text-body-default text-text-secondary">{t('empty')}</p>
            ) : (
              <AppointmentTable
                groups={byDay(data.items, format, (date) =>
                  date === data.today
                    ? t('today', { date: format.dayLong(date) })
                    : format.dayLong(date),
                )}
                format={format}
                onOpen={setOpenId}
                onDone={setNews}
              />
            )}
            <Pager
              page={pages.page}
              limit={PAGE_SIZE}
              count={data.items.length}
              total={pages.totalOf(data.total)}
              nextCursor={data.nextCursor}
              format={format}
              onNext={(cursor) => {
                pages.next(cursor, data.total);
              }}
              onPrevious={pages.previous}
            />
          </>
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
