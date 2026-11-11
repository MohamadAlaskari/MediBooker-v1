'use client';

import {
  isApiError,
  useCreateAbsence,
  useDeleteAbsence,
  useGenerateSlots,
  useGetDeskCatalog,
  useGetWorkingHours,
  useListAbsences,
  useReplaceWorkingHours,
  type AbsenceDto,
  type AbsenceInputDtoReason,
  type DeskServiceDto,
  type WorkingHoursDto,
} from '@medibooker/api-client';
import { isolate } from '@medibooker/i18n';
import { CalendarOff, Info, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Label } from 'react-aria-components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Radio, RadioGroup } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { practiceFormat, type PracticeFormat } from '@/lib/format';
import { FormError } from '../auth/form-parts';
import { textIn } from '../portal/appointment-view';
import { useDesk } from './desk-context';
import { CONTROL, counter, TimeInput, useInvalidatePractice } from './setup-parts';
import {
  draftOf,
  intervalsOfDraft,
  nextRangeOf,
  problemOf,
  weekdaysFrom,
  type DraftRange,
  type WeekDraft,
} from './setup-view';

const CARD = 'flex flex-col gap-4 rounded-lg border border-border-subtle bg-bg-surface p-5';
const LABEL = 'text-label-default text-text-primary';
/** The start times W14 offers, with a doctor's own when it is another. */
const STEPS = [5, 10, 15, 20, 30, 45, 60, 90, 120];
const REASONS: readonly AbsenceInputDtoReason[] = ['VACATION', 'HOLIDAY', 'TRAINING', 'OTHER'];

type RangeTrouble = 'missingTime' | 'endsBeforeStarts' | 'tooShort' | 'tooMany' | 'overlaps';

function stepsWith(current: number): readonly number[] {
  return STEPS.includes(current) ? STEPS : [...STEPS, current].toSorted((a, b) => a - b);
}

/** W14's week editor: each day on or off with its ranges, the start times and the services. */
function WeekForm({
  week,
  services,
  doctor,
  onSaved,
}: {
  readonly week: WorkingHoursDto;
  readonly services: readonly DeskServiceDto[];
  readonly doctor: string;
  readonly onSaved: (news: string) => void;
}): ReactNode {
  const t = useTranslations('dashboard.workingHours');
  const locale = useLocale();
  const { practiceId } = useDesk();
  const format = practiceFormat(locale, week);
  const keys = useRef(0);
  const nextKey = (): string => {
    keys.current += 1;
    return `added-${String(keys.current)}`;
  };
  const [draft, setDraft] = useState<WeekDraft>(() =>
    draftOf(
      week.intervals.map(({ weekday, startsAt, endsAt }) => ({
        weekday,
        opensAt: startsAt,
        closesAt: endsAt,
      })),
      counter('saved'),
    ),
  );
  const [step, setStep] = useState(week.slotMinutes ?? 15);
  const [chosen, setChosen] = useState<readonly string[]>(() =>
    week.serviceIds.length > 0 ? week.serviceIds : services.map(({ id }) => id),
  );
  const [troubles, setTroubles] = useState<Readonly<Record<string, RangeTrouble>>>({});
  const [servicesMissing, setServicesMissing] = useState(false);
  const invalidate = useInvalidatePractice();
  const replace = useReplaceWorkingHours({ mutation: { onSettled: invalidate } });
  const dayIds = useId();
  const stepHintId = useId();

  const change = (weekday: number, ranges: readonly DraftRange[]): void => {
    setDraft({ ...draft, [weekday]: ranges });
  };

  const submit = (): void => {
    const found: Record<string, RangeTrouble> = {};
    for (const weekday of weekdaysFrom(1)) {
      for (const range of draft[weekday] ?? []) {
        const problem = problemOf(range);
        if (problem === 'missingTime') found[range.key] = 'missingTime';
        else if (problem === 'closesBeforeOpens') found[range.key] = 'endsBeforeStarts';
      }
    }
    const { intervals, keys: sent } = intervalsOfDraft(draft, week.weekStart);
    const missing = intervals.length > 0 && chosen.length === 0;
    setTroubles(found);
    setServicesMissing(missing);
    if (Object.keys(found).length > 0 || missing) return;
    replace.mutate(
      {
        practiceId,
        providerId: week.providerId,
        data: {
          slotMinutes: step,
          intervals: intervals.map(({ weekday, opensAt, closesAt }) => ({
            weekday,
            startsAt: opensAt,
            endsAt: closesAt,
          })),
          serviceIds: [...chosen],
        },
      },
      {
        onSuccess: () => {
          onSaved(t('saved', { doctor: isolate(doctor) }));
        },
        onError: (failure) => {
          if (!isApiError(failure)) return;
          const named: Record<string, RangeTrouble> = {};
          for (const { field, code } of failure.fieldErrors) {
            if (field === 'serviceIds') setServicesMissing(true);
            const match = /^intervals\[(\d+)\](\.endsAt)?/u.exec(field);
            const key = match === null ? undefined : sent[Number(match[1])];
            if (key === undefined || match === null) continue;
            named[key] =
              code === 'OVERLAPS_EXISTING'
                ? 'overlaps'
                : code === 'TOO_LARGE'
                  ? 'tooMany'
                  : match[2] === undefined
                    ? 'tooShort'
                    : 'endsBeforeStarts';
          }
          setTroubles(named);
        },
      },
    );
  };

  const named = Object.keys(troubles).length > 0 || servicesMissing;
  return (
    <form
      noValidate
      className={CARD}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-heading-h3 text-text-primary">{t('scheduleTitle')}</h2>
        <p className="text-body-small text-text-secondary">
          {t('timeZone', { zone: week.timeZone })}
        </p>
      </div>
      {named ? null : <FormError error={replace.error} />}
      <ul className="flex flex-col divide-y divide-border-subtle">
        {weekdaysFrom(week.weekStart).map((weekday) => {
          const ranges = draft[weekday] ?? [];
          const dayId = `${dayIds}-${String(weekday)}`;
          const day = format.weekday(weekday);
          return (
            <li key={weekday} className="py-3">
              <div role="group" aria-labelledby={dayId} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-3">
                  <Switch
                    isSelected={ranges.length > 0}
                    onChange={(works) => {
                      change(weekday, works ? [{ key: nextKey(), ...nextRangeOf([]) }] : []);
                    }}
                  >
                    <span id={dayId} className="text-label-default">
                      {t('worksOn', { day })}
                    </span>
                  </Switch>
                  {ranges.length === 0 ? (
                    <span className="text-body-default text-text-secondary">{t('closed')}</span>
                  ) : (
                    <Button
                      variant="ghost"
                      className="ms-auto"
                      onPress={() => {
                        change(weekday, [...ranges, { key: nextKey(), ...nextRangeOf(ranges) }]);
                      }}
                    >
                      <Plus aria-hidden data-icon="inline-start" />
                      {t('addHours')}
                    </Button>
                  )}
                </div>
                {ranges.map((range) => {
                  const trouble = troubles[range.key];
                  return (
                    <div key={range.key} className="flex flex-wrap items-end gap-3">
                      <TimeInput
                        label={t('from')}
                        value={range.opensAt}
                        invalid={trouble !== undefined}
                        onChange={(opensAt) => {
                          change(
                            weekday,
                            ranges.map((each) =>
                              each.key === range.key ? { ...each, opensAt } : each,
                            ),
                          );
                        }}
                      />
                      <TimeInput
                        label={t('to')}
                        value={range.closesAt}
                        invalid={trouble !== undefined}
                        onChange={(closesAt) => {
                          change(
                            weekday,
                            ranges.map((each) =>
                              each.key === range.key ? { ...each, closesAt } : each,
                            ),
                          );
                        }}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('removeHours')}
                        onPress={() => {
                          change(
                            weekday,
                            ranges.filter((each) => each.key !== range.key),
                          );
                        }}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                      {trouble === undefined ? null : (
                        <p role="alert" className="w-full text-body-small text-text-danger">
                          {t(trouble)}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-body-small text-text-secondary">{t('midnight')}</p>
      <div className="flex flex-col gap-1 tablet:flex-row tablet:items-end tablet:gap-4">
        <Select
          value={step}
          onChange={(key) => {
            if (key !== null) setStep(Number(key));
          }}
          aria-describedby={stepHintId}
          className="tablet:max-w-[14rem]"
        >
          <Label className={LABEL}>{t('every')}</Label>
          <SelectTrigger className="mt-2" />
          <SelectContent>
            {stepsWith(step).map((minutes) => (
              <SelectItem key={minutes} id={minutes}>
                {t('minutes', { minutes: format.number(minutes) })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p id={stepHintId} className="text-body-small text-text-secondary tablet:pb-3">
          {t('everyHint')}
        </p>
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className={LABEL}>{t('services')}</legend>
        <p className="text-body-small text-text-secondary">{t('servicesHint')}</p>
        <div className="flex flex-wrap gap-x-6">
          {services.map((service) => (
            <Checkbox
              key={service.id}
              isSelected={chosen.includes(service.id)}
              onChange={(selected) => {
                setChosen(
                  selected ? [...chosen, service.id] : chosen.filter((id) => id !== service.id),
                );
              }}
            >
              <bdi>{textIn(service.name, locale)}</bdi>
            </Checkbox>
          ))}
        </div>
        {servicesMissing ? (
          <p role="alert" className="text-body-small text-text-danger">
            {t('servicesMissing')}
          </p>
        ) : null}
      </fieldset>
      <div className="flex justify-end border-t border-border-subtle pt-4">
        <Button type="submit" isPending={replace.isPending}>
          {t('save')}
        </Button>
      </div>
    </form>
  );
}

/** How an absence reads: its days, or its time of one day, and why. */
function absenceText(
  absence: AbsenceDto,
  format: PracticeFormat,
  t: ReturnType<typeof useTranslations<'dashboard.workingHours'>>,
): string {
  const reason = t('reason', { reason: absence.reason });
  const first = format.instantDate(absence.startsAt);
  if (!absence.allDay) {
    return `${format.dayLongWithYear(first)} · ${format.instantTime(absence.startsAt)}–${format.instantTime(absence.endsAt)} · ${reason}`;
  }
  // The end is the start of the day after the last one.
  const last = format.instantDate(new Date(Date.parse(absence.endsAt) - 1).toISOString());
  const days =
    first === last
      ? format.dayLongWithYear(first)
      : `${format.dayLongWithYear(first)} – ${format.dayLongWithYear(last)}`;
  return `${days} · ${t('allDay')} · ${reason}`;
}

function messageOfAbsence(field: string, code: string): string | undefined {
  if (field === 'endDate' && code === 'TOO_SMALL') return 'past';
  if (field === 'endDate' && code === 'TOO_LARGE') return 'tooLong';
  if (field === 'endDate' && code === 'INVALID_VALUE') return 'oneDay';
  if ((field === 'startTime' || field === 'endTime') && code === 'REQUIRED') return 'timesMissing';
  if (field === 'endTime' && code === 'TOO_SMALL') return 'endsBeforeStarts';
  if (field === 'startDate' || field === 'endDate') return 'datesMissing';
  return undefined;
}

/** A new absence: whole days, or a time of one day, and why. */
function AbsenceForm({
  doctorId,
  today,
  onSaved,
  onCancel,
}: {
  readonly doctorId: string;
  readonly today: string;
  readonly onSaved: (news: string) => void;
  readonly onCancel: () => void;
}): ReactNode {
  const t = useTranslations('dashboard.absenceForm');
  const page = useTranslations('dashboard.workingHours');
  const { practiceId } = useDesk();
  const invalidate = useInvalidatePractice();
  const create = useCreateAbsence({ mutation: { onSettled: invalidate } });
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [allDay, setAllDay] = useState(true);
  const [times, setTimes] = useState({ from: '08:00', to: '12:00' });
  const [reason, setReason] = useState<AbsenceInputDtoReason>('VACATION');
  const [trouble, setTrouble] = useState<string | undefined>(undefined);
  const firstId = useId();
  const lastId = useId();
  const troubleId = useId();

  const submit = (): void => {
    const end = allDay ? last : first;
    let found: string | undefined;
    if (first === '' || end === '') found = 'datesMissing';
    else if (end < first) found = 'endBeforeStart';
    else if (!allDay && (times.from === '' || times.to === '')) found = 'timesMissing';
    else if (!allDay && times.to !== '00:00' && times.to <= times.from) found = 'endsBeforeStarts';
    setTrouble(found);
    if (found !== undefined) return;
    create.mutate(
      {
        practiceId,
        providerId: doctorId,
        data: {
          startDate: first,
          endDate: end,
          reason,
          ...(allDay
            ? {}
            : { startTime: times.from, endTime: times.to === '00:00' ? '24:00' : times.to }),
        },
      },
      {
        onSuccess: ({ bookedInside }) => {
          onSaved(
            bookedInside === 0
              ? page('absenceAdded')
              : page('absenceAddedBooked', { count: bookedInside }),
          );
        },
        onError: (failure) => {
          if (!isApiError(failure)) return;
          const shown = failure.fieldErrors
            .map(({ field, code }) => messageOfAbsence(field, code))
            .find((key) => key !== undefined);
          setTrouble(shown);
        },
      },
    );
  };

  const message = trouble === undefined ? undefined : t(trouble as 'datesMissing');
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {trouble === undefined ? <FormError error={create.error} /> : null}
      <Checkbox isSelected={allDay} onChange={setAllDay}>
        {t('allDay')}
      </Checkbox>
      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={firstId} className={LABEL}>
            {t('from')}
          </label>
          <input
            id={firstId}
            type="date"
            min={today}
            value={first}
            required
            aria-invalid={trouble === undefined ? undefined : true}
            aria-describedby={troubleId}
            onChange={(event) => {
              setFirst(event.target.value);
            }}
            className={CONTROL}
          />
        </div>
        {allDay ? (
          <div className="flex flex-col gap-1">
            <label htmlFor={lastId} className={LABEL}>
              {t('to')}
            </label>
            <input
              id={lastId}
              type="date"
              min={first === '' ? today : first}
              value={last}
              required
              aria-invalid={trouble === undefined ? undefined : true}
              aria-describedby={troubleId}
              onChange={(event) => {
                setLast(event.target.value);
              }}
              className={CONTROL}
            />
          </div>
        ) : (
          <>
            <TimeInput
              label={t('startTime')}
              value={times.from}
              onChange={(from) => {
                setTimes({ ...times, from });
              }}
            />
            <TimeInput
              label={t('endTime')}
              value={times.to}
              onChange={(to) => {
                setTimes({ ...times, to });
              }}
            />
          </>
        )}
      </div>
      <p id={troubleId} role="alert" className="text-body-small text-text-danger empty:hidden">
        {message ?? ''}
      </p>
      <Select
        value={reason}
        onChange={(key) => {
          if (key !== null) setReason(String(key) as AbsenceInputDtoReason);
        }}
        className="tablet:max-w-[16rem]"
      >
        <Label className={LABEL}>{t('reason')}</Label>
        <SelectTrigger className="mt-2" />
        <SelectContent>
          {REASONS.map((value) => (
            <SelectItem key={value} id={value}>
              {page('reason', { reason: value })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex flex-wrap justify-end gap-3 border-t border-border-subtle pt-4">
        <Button variant="outline" isDisabled={create.isPending} onPress={onCancel}>
          {t('cancel')}
        </Button>
        <Button type="submit" isPending={create.isPending}>
          {t('save')}
        </Button>
      </div>
    </form>
  );
}

function AbsenceRow({
  absence,
  doctorId,
  format,
  onDone,
}: {
  readonly absence: AbsenceDto;
  readonly doctorId: string;
  readonly format: PracticeFormat;
  readonly onDone: (news: string) => void;
}): ReactNode {
  const t = useTranslations('dashboard.workingHours');
  const { practiceId } = useDesk();
  const invalidate = useInvalidatePractice();
  const remove = useDeleteAbsence({ mutation: { onSettled: invalidate } });
  const when = absenceText(absence, format, t);
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-bg-subtle">
          <CalendarOff aria-hidden className="size-5 text-icon-secondary" />
        </span>
        <p className="me-auto min-w-0 text-body-default text-text-primary">{when}</p>
        <Button
          variant="ghost"
          aria-label={t('removeAbsence', { when })}
          isPending={remove.isPending}
          onPress={() => {
            remove.mutate(
              { practiceId, providerId: doctorId, absenceId: absence.id },
              {
                onSuccess: () => {
                  onDone(t('absenceRemoved'));
                },
              },
            );
          }}
        >
          <Trash2 aria-hidden data-icon="inline-start" />
          {t('remove')}
        </Button>
      </div>
      <FormError error={remove.error} />
    </li>
  );
}

function AbsencesCard({
  doctorId,
  onDone,
}: {
  readonly doctorId: string;
  readonly onDone: (news: string) => void;
}): ReactNode {
  const t = useTranslations('dashboard.workingHours');
  const form = useTranslations('dashboard.absenceForm');
  const locale = useLocale();
  const { practiceId } = useDesk();
  const absences = useListAbsences(practiceId, doctorId, { query: { retry: false } });
  const [isOpen, setOpen] = useState(false);
  const titleId = useId();
  const data = absences.data;
  const format = data === undefined ? undefined : practiceFormat(locale, data);
  return (
    <section aria-labelledby={titleId} className={CARD}>
      <h2 id={titleId} className="text-heading-h3 text-text-primary">
        {t('absencesTitle')}
      </h2>
      {data === undefined || format === undefined ? (
        absences.isError ? (
          <FormError error={absences.error} />
        ) : (
          <p role="status" className="text-body-default text-text-secondary">
            {t('loading')}
          </p>
        )
      ) : (
        <>
          {data.absences.length === 0 ? (
            <p className="text-body-default text-text-secondary">{t('noAbsences')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border-subtle">
              {data.absences.map((absence) => (
                <AbsenceRow
                  key={absence.id}
                  absence={absence}
                  doctorId={doctorId}
                  format={format}
                  onDone={onDone}
                />
              ))}
            </ul>
          )}
          <DialogTrigger isOpen={isOpen} onOpenChange={setOpen}>
            <Button variant="outline">
              <Plus aria-hidden data-icon="inline-start" />
              {t('addAbsence')}
            </Button>
            <DialogContent title={form('title')} size="medium">
              {(close) => (
                <AbsenceForm
                  doctorId={doctorId}
                  today={data.today}
                  onCancel={close}
                  onSaved={(news) => {
                    close();
                    onDone(news);
                  }}
                />
              )}
            </DialogContent>
          </DialogTrigger>
        </>
      )}
    </section>
  );
}

/** What the free times are now, and the way to make them anew from the rules. */
function BookingCard({
  week,
  canGenerate,
  onDone,
}: {
  readonly week: WorkingHoursDto;
  readonly canGenerate: boolean;
  readonly onDone: (news: string) => void;
}): ReactNode {
  const t = useTranslations('dashboard.workingHours');
  const locale = useLocale();
  const { practiceId } = useDesk();
  const invalidate = useInvalidatePractice();
  const generate = useGenerateSlots({ mutation: { onSettled: invalidate } });
  const format = practiceFormat(locale, week);
  const titleId = useId();
  const { openUntil, freeTimes } = week.booking;
  return (
    <section aria-labelledby={titleId} className={CARD}>
      <h2 id={titleId} className="text-heading-h3 text-text-primary">
        {t('bookingTitle')}
      </h2>
      <p className="text-body-default text-text-secondary">
        {openUntil === null
          ? t('bookingNone')
          : t('bookingUntil', { date: format.dayLongWithYear(openUntil), count: freeTimes })}
      </p>
      {canGenerate ? (
        <div className="flex flex-col gap-2">
          <FormError error={generate.error} />
          <Button
            variant="outline"
            isPending={generate.isPending}
            onPress={() => {
              generate.mutate(
                { practiceId },
                {
                  onSuccess: ({ created, removed }) => {
                    onDone(t('generated', { created, removed }));
                  },
                },
              );
            }}
          >
            <RefreshCw aria-hidden data-icon="inline-start" />
            {t('generate')}
          </Button>
        </div>
      ) : null}
      <Alert className="flex gap-3 bg-bg-info-subtle">
        <Info aria-hidden className="size-5 shrink-0 text-icon-info" />
        <div>
          <AlertTitle>{t('bookedStay')}</AlertTitle>
          <AlertDescription>{t('bookedStayBody')}</AlertDescription>
        </div>
      </Alert>
    </section>
  );
}

function DoctorSchedule({
  doctorId,
  doctor,
  services,
  canGenerate,
  onDone,
}: {
  readonly doctorId: string;
  readonly doctor: string;
  readonly services: readonly DeskServiceDto[];
  readonly canGenerate: boolean;
  readonly onDone: (news: string) => void;
}): ReactNode {
  const t = useTranslations('dashboard.workingHours');
  const { practiceId } = useDesk();
  const week = useGetWorkingHours(practiceId, doctorId, { query: { retry: false } });
  // A doctor's week waits for its own answer: another doctor's must not stand under its name.
  const data = week.data?.providerId === doctorId ? week.data : undefined;
  if (data === undefined) {
    return week.isError ? (
      <FormError error={week.error} />
    ) : (
      <p role="status" className="text-body-default text-text-secondary">
        {t('loading')}
      </p>
    );
  }
  return (
    <div className="grid grid-cols-1 items-start gap-6 desktop:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <WeekForm week={data} services={services} doctor={doctor} onSaved={onDone} />
      <div className="flex flex-col gap-6">
        <AbsencesCard doctorId={doctorId} onDone={onDone} />
        <BookingCard week={data} canGenerate={canGenerate} onDone={onDone} />
      </div>
    </div>
  );
}

/**
 * W14: the doctors' working hours, absences and free times (M04). The reception and the admin plan
 * every doctor; a doctor plans itself only, once its account is linked to it.
 */
export function WorkingHoursPage(): ReactNode {
  const t = useTranslations('dashboard.workingHours');
  const { practiceId, role, providerId: own } = useDesk();
  const catalog = useGetDeskCatalog(practiceId, { query: { retry: false } });
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const [news, setNews] = useState('');
  const newsRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (news !== '') newsRef.current?.focus();
  }, [news]);
  const all = catalog.data?.providers ?? [];
  const doctors = role === 'DOCTOR' ? all.filter(({ id }) => id === own) : all;
  const doctorId = doctors.some(({ id }) => id === chosen) ? chosen : doctors[0]?.id;
  const doctor = doctors.find(({ id }) => id === doctorId)?.name ?? '';
  const services = (catalog.data?.services ?? []).filter(({ active }) => active);
  return (
    <>
      <header className="mb-6">
        <p className="text-body-default text-text-secondary">{t('kicker')}</p>
        <h1 className="text-heading-h1 text-text-primary">{t('title')}</h1>
      </header>
      <p
        ref={newsRef}
        role="status"
        tabIndex={-1}
        className="mb-4 text-body-default text-text-success outline-none empty:hidden"
      >
        {news}
      </p>
      {catalog.data === undefined ? (
        catalog.isError ? (
          <FormError error={catalog.error} />
        ) : (
          <p role="status" className="text-body-default text-text-secondary">
            {t('loading')}
          </p>
        )
      ) : role === 'DOCTOR' && own === null ? (
        <p className="text-body-default text-text-secondary">{t('notLinked')}</p>
      ) : doctorId === undefined ? (
        <p className="text-body-default text-text-secondary">{t('noDoctor')}</p>
      ) : (
        <div className="flex flex-col gap-6">
          {doctors.length > 1 ? (
            <RadioGroup
              label={t('doctors')}
              value={doctorId}
              onChange={(value) => {
                setNews('');
                setChosen(value);
              }}
            >
              {doctors.map(({ id, name }) => (
                <Radio key={id} value={id}>
                  <bdi>{name}</bdi>
                </Radio>
              ))}
            </RadioGroup>
          ) : (
            <p className="text-label-large text-text-primary">
              <bdi>{doctor}</bdi>
            </p>
          )}
          <DoctorSchedule
            key={doctorId}
            doctorId={doctorId}
            doctor={doctor}
            services={services}
            canGenerate={role !== 'DOCTOR'}
            onDone={setNews}
          />
        </div>
      )}
    </>
  );
}
