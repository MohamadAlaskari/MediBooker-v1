'use client';

import {
  isApiError,
  useCreateSpecialDay,
  useDeleteSpecialDay,
  useGetOpeningHours,
  useListSpecialDays,
  useReplaceOpeningHours,
  type OpeningHoursDto,
  type SpecialDayDto,
  type SpecialDayListDto,
} from '@medibooker/api-client';
import { getDirection, isolate, isLocale } from '@medibooker/i18n';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { TextField } from '@/components/ui/text-field';
import { practiceFormat, type PracticeFormat } from '@/lib/format';
import { cn } from '@/lib/utils';
import { FormError } from '../auth/form-parts';
import { textIn } from '../portal/appointment-view';
import { useDesk } from './desk-context';
import {
  draftOf,
  intervalsOfDraft,
  isPracticeQueryOf,
  languageName,
  nextRangeOf,
  problemOf,
  weekdaysFrom,
  weekLinesOf,
  type DraftRange,
  type RangeProblem,
  type WeekDraft,
} from './setup-view';

/** As long as the API takes it. */
const LABEL_MAX = 80;
/** How far ahead a special day can be set, as the API counts it. */
const HORIZON_DAYS = 730;
const DAY_MS = 86_400_000;
const CARD = 'flex flex-col gap-4 rounded-lg border border-border-subtle bg-bg-surface p-5';
const CONTROL =
  'min-h-touch-target rounded-md border border-border-strong bg-bg-surface px-3 text-body-default text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus aria-[invalid=true]:border-border-danger';

type Problem = RangeProblem | 'overlaps';

function useInvalidatePractice(): () => Promise<void> {
  const { practiceId } = useDesk();
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      predicate: ({ queryKey }) => isPracticeQueryOf(practiceId, queryKey),
    });
}

/** Keys for the ranges the week starts with; those added later count on in a ref. */
function counter(prefix: string): () => string {
  let count = 0;
  return () => {
    count += 1;
    return `${prefix}-${String(count)}`;
  };
}

/** A time of the practice's wall clock, as the browser's own time field takes it. */
function TimeInput({
  label,
  value,
  onChange,
  invalid = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly invalid?: boolean;
}): ReactNode {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-body-small text-text-secondary">
        {label}
      </label>
      <input
        id={id}
        type="time"
        step={300}
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className={CONTROL}
      />
    </div>
  );
}

/** The hours of one line of the week: "08:00–12:00, 16:00–20:00", or closed. */
function hoursText(
  ranges: readonly { readonly opensAt: string; readonly closesAt: string }[],
  format: PracticeFormat,
  locale: string,
  t: ReturnType<typeof useTranslations<'dashboard.settings'>>,
): string {
  if (ranges.length === 0) return t('closed');
  return new Intl.ListFormat(locale, { type: 'unit', style: 'short' }).format(
    ranges.map(({ opensAt, closesAt }) =>
      t('range', { from: format.clock(opensAt), to: format.clock(closesAt) }),
    ),
  );
}

/** The week editor of W20: each day open or closed, with one or more ranges. */
function HoursForm({
  week,
  onSaved,
  onCancel,
}: {
  readonly week: OpeningHoursDto;
  readonly onSaved: () => void;
  readonly onCancel: () => void;
}): ReactNode {
  const t = useTranslations('dashboard.hoursForm');
  const locale = useLocale();
  const { practiceId } = useDesk();
  const format = practiceFormat(locale, week);
  const keys = useRef(0);
  const nextKey = (): string => {
    keys.current += 1;
    return `range-${String(keys.current)}`;
  };
  const [draft, setDraft] = useState<WeekDraft>(() => draftOf(week.intervals, counter('saved')));
  const [problems, setProblems] = useState<Readonly<Record<string, Problem>>>({});
  const invalidate = useInvalidatePractice();
  const replace = useReplaceOpeningHours({ mutation: { onSettled: invalidate } });
  const dayIds = useId();

  const change = (weekday: number, ranges: readonly DraftRange[]): void => {
    setDraft({ ...draft, [weekday]: ranges });
  };

  const submit = (): void => {
    const found: Record<string, Problem> = {};
    for (const weekday of weekdaysFrom(1)) {
      for (const range of draft[weekday] ?? []) {
        const problem = problemOf(range);
        if (problem !== undefined) found[range.key] = problem;
      }
    }
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    const { intervals, keys: sent } = intervalsOfDraft(draft, week.weekStart);
    replace.mutate(
      { practiceId, data: { intervals } },
      {
        onSuccess: onSaved,
        onError: (failure) => {
          if (!isApiError(failure)) return;
          const named: Record<string, Problem> = {};
          for (const { field, code } of failure.fieldErrors) {
            const index = /^intervals\[(\d+)\]/u.exec(field)?.[1];
            const key = index === undefined ? undefined : sent[Number(index)];
            if (key === undefined) continue;
            named[key] = code === 'OVERLAPS_EXISTING' ? 'overlaps' : 'closesBeforeOpens';
          }
          setProblems(named);
        },
      },
    );
  };

  const named = Object.keys(problems).length > 0;
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {named ? null : <FormError error={replace.error} />}
      <ul aria-label={t('week')} className="flex flex-col divide-y divide-border-subtle">
        {weekdaysFrom(week.weekStart).map((weekday) => {
          const ranges = draft[weekday] ?? [];
          const dayId = `${dayIds}-${String(weekday)}`;
          return (
            <li key={weekday} className="py-3">
              <div role="group" aria-labelledby={dayId} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-3">
                  <span id={dayId} className="me-auto text-label-default text-text-primary">
                    {format.weekday(weekday)}
                  </span>
                  {ranges.length === 0 ? (
                    <span className="text-body-default text-text-secondary">{t('closedDay')}</span>
                  ) : null}
                  <Button
                    variant="ghost"
                    onPress={() => {
                      change(weekday, [...ranges, { key: nextKey(), ...nextRangeOf(ranges) }]);
                    }}
                  >
                    <Plus aria-hidden data-icon="inline-start" />
                    {t('addHours')}
                  </Button>
                </div>
                {ranges.map((range) => {
                  const problem = problems[range.key];
                  return (
                    <div key={range.key} className="flex flex-wrap items-end gap-3">
                      <TimeInput
                        label={t('opens')}
                        value={range.opensAt}
                        invalid={problem !== undefined}
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
                        label={t('closes')}
                        value={range.closesAt}
                        invalid={problem !== undefined}
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
                      {problem === undefined ? null : (
                        <p role="alert" className="w-full text-body-small text-text-danger">
                          {t(problem)}
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
      <div className="flex flex-wrap justify-end gap-3 border-t border-border-subtle pt-4">
        <Button variant="outline" isDisabled={replace.isPending} onPress={onCancel}>
          {t('cancel')}
        </Button>
        <Button type="submit" isPending={replace.isPending}>
          {t('save')}
        </Button>
      </div>
    </form>
  );
}

function HoursDialog({
  week,
  onDone,
}: {
  readonly week: OpeningHoursDto;
  readonly onDone: (news: string) => void;
}): ReactNode {
  const t = useTranslations('dashboard.hoursForm');
  const page = useTranslations('dashboard.settings');
  const [isOpen, setOpen] = useState(false);
  return (
    <DialogTrigger isOpen={isOpen} onOpenChange={setOpen}>
      <Button variant="outline">
        <Pencil aria-hidden data-icon="inline-start" />
        {page('editHours')}
      </Button>
      <DialogContent title={t('title')} description={t('description')} size="medium">
        {(close) => (
          <HoursForm
            week={week}
            onCancel={close}
            onSaved={() => {
              close();
              onDone(page('savedHours'));
            }}
          />
        )}
      </DialogContent>
    </DialogTrigger>
  );
}

function dateMessageOf(code: string): 'dateTaken' | 'datePast' | 'dateFar' | 'dateMissing' {
  if (code === 'ALREADY_EXISTS') return 'dateTaken';
  if (code === 'TOO_SMALL') return 'datePast';
  if (code === 'TOO_LARGE') return 'dateFar';
  return 'dateMissing';
}

/** A new special day: closed, or other hours, with a reason per language. */
function SpecialDayForm({
  list,
  onSaved,
  onCancel,
}: {
  readonly list: SpecialDayListDto;
  readonly onSaved: (day: SpecialDayDto) => void;
  readonly onCancel: () => void;
}): ReactNode {
  const t = useTranslations('dashboard.specialForm');
  const hours = useTranslations('dashboard.hoursForm');
  const texts = useTranslations('dashboard.serviceForm');
  const { practiceId } = useDesk();
  const invalidate = useInvalidatePractice();
  const create = useCreateSpecialDay({ mutation: { onSettled: invalidate } });
  const [date, setDate] = useState('');
  const [closed, setClosed] = useState(true);
  const [range, setRange] = useState({ opensAt: '09:00', closesAt: '13:00' });
  const [labels, setLabels] = useState<Readonly<Record<string, string>>>({});
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const dateId = useId();
  const latest = new Date(Date.parse(`${list.today}T00:00:00Z`) + HORIZON_DAYS * DAY_MS)
    .toISOString()
    .slice(0, 10);

  const submit = (): void => {
    const found: Record<string, string> = {};
    if (date === '') found.date = t('dateMissing');
    const problem = closed ? undefined : problemOf(range);
    if (problem !== undefined) found.hours = hours(problem);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const closesAt = range.closesAt === '00:00' ? '24:00' : range.closesAt;
    create.mutate(
      {
        practiceId,
        data: {
          date,
          closed,
          ...(closed ? {} : { opensAt: range.opensAt, closesAt }),
          label: labels,
        },
      },
      {
        onSuccess: onSaved,
        onError: (failure) => {
          if (!isApiError(failure)) return;
          const named: Record<string, string> = {};
          for (const { field, code } of failure.fieldErrors) {
            if (field === 'date') named.date = t(dateMessageOf(code));
            else if (field === 'closesAt' || field === 'opensAt') {
              named.hours = hours('closesBeforeOpens');
            } else if (field.startsWith('label.')) {
              named[field] =
                code === 'TOO_LONG'
                  ? texts('textTooLong', { max: String(LABEL_MAX) })
                  : texts('textInvalid');
            }
          }
          setErrors(named);
        },
      },
    );
  };

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {Object.keys(errors).length > 0 ? null : <FormError error={create.error} />}
      <div className="flex flex-col gap-1">
        <label htmlFor={dateId} className="text-label-default text-text-primary">
          {t('date')}
        </label>
        <input
          id={dateId}
          type="date"
          min={list.today}
          max={latest}
          value={date}
          required
          aria-invalid={errors.date === undefined ? undefined : true}
          aria-describedby={`${dateId}-hint ${dateId}-error`}
          onChange={(event) => {
            setDate(event.target.value);
          }}
          className={cn(CONTROL, 'tablet:max-w-[16rem]')}
        />
        <p id={`${dateId}-hint`} className="text-body-small text-text-secondary">
          {t('dateHint')}
        </p>
        <p
          id={`${dateId}-error`}
          role="alert"
          className="text-body-small text-text-danger empty:hidden"
        >
          {errors.date ?? ''}
        </p>
      </div>
      <Checkbox isSelected={closed} onChange={setClosed}>
        {t('closedAllDay')}
      </Checkbox>
      {closed ? null : (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap gap-3">
            <TimeInput
              label={t('opens')}
              value={range.opensAt}
              invalid={errors.hours !== undefined}
              onChange={(opensAt) => {
                setRange({ ...range, opensAt });
              }}
            />
            <TimeInput
              label={t('closes')}
              value={range.closesAt}
              invalid={errors.hours !== undefined}
              onChange={(closesAt) => {
                setRange({ ...range, closesAt });
              }}
            />
          </div>
          {errors.hours === undefined ? null : (
            <p role="alert" className="text-body-small text-text-danger">
              {errors.hours}
            </p>
          )}
        </div>
      )}
      {list.locales.map((code, index) => {
        const dir = isLocale(code) ? getDirection(code) : undefined;
        return (
          <TextField
            key={code}
            label={t('label', { language: languageName(code) })}
            hint={index === 0 ? t('labelHint') : undefined}
            value={labels[code] ?? ''}
            onChange={(value) => {
              setLabels({ ...labels, [code]: value });
            }}
            maxLength={LABEL_MAX}
            lang={code}
            {...(dir === undefined ? {} : { dir })}
            error={errors[`label.${code}`]}
          />
        );
      })}
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

function SpecialDayDialog({
  list,
  onDone,
}: {
  readonly list: SpecialDayListDto;
  readonly onDone: (day: SpecialDayDto) => void;
}): ReactNode {
  const t = useTranslations('dashboard.specialForm');
  const page = useTranslations('dashboard.settings');
  const [isOpen, setOpen] = useState(false);
  return (
    <DialogTrigger isOpen={isOpen} onOpenChange={setOpen}>
      <Button variant="outline">
        <CalendarPlus aria-hidden data-icon="inline-start" />
        {page('addSpecial')}
      </Button>
      <DialogContent title={t('title')} size="medium">
        {(close) => (
          <SpecialDayForm
            list={list}
            onCancel={close}
            onSaved={(day) => {
              close();
              onDone(day);
            }}
          />
        )}
      </DialogContent>
    </DialogTrigger>
  );
}

/** How a special day reads in the list: closed or its hours, with its reason. */
function specialLine(
  day: SpecialDayDto,
  format: PracticeFormat,
  locale: string,
  t: ReturnType<typeof useTranslations<'dashboard.settings'>>,
): string {
  const label = textIn(day.label, locale).trim();
  if (day.closed || day.opensAt === null || day.closesAt === null) {
    return label === '' ? t('specialClosed') : t('specialClosedLabel', { label: isolate(label) });
  }
  const from = format.clock(day.opensAt);
  const to = format.clock(day.closesAt);
  return label === ''
    ? t('specialOpen', { from, to })
    : t('specialOpenLabel', { from, to, label: isolate(label) });
}

function SpecialDayRow({
  day,
  format,
  canEdit,
  onDone,
}: {
  readonly day: SpecialDayDto;
  readonly format: PracticeFormat;
  readonly canEdit: boolean;
  readonly onDone: (news: string) => void;
}): ReactNode {
  const t = useTranslations('dashboard.settings');
  const locale = useLocale();
  const { practiceId } = useDesk();
  const invalidate = useInvalidatePractice();
  const remove = useDeleteSpecialDay({ mutation: { onSettled: invalidate } });
  const date = format.dayLongWithYear(day.date);
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="me-auto min-w-0">
          <p className="text-label-default text-text-primary">{date}</p>
          <p className="text-body-default text-text-secondary">
            {specialLine(day, format, locale, t)}
          </p>
        </div>
        {canEdit ? (
          <Button
            variant="ghost"
            aria-label={t('removeSpecial', { date })}
            isPending={remove.isPending}
            onPress={() => {
              remove.mutate(
                { practiceId, specialDayId: day.id },
                {
                  onSuccess: () => {
                    onDone(t('removedSpecial', { date }));
                  },
                },
              );
            }}
          >
            <Trash2 aria-hidden data-icon="inline-start" />
            {t('remove')}
          </Button>
        ) : null}
      </div>
      <FormError error={remove.error} />
    </li>
  );
}

/**
 * Settings – Practice page (W20), the part M02 brings: the opening hours and the special days that
 * the public page shows. The reception and the admin change them; the doctors read them.
 */
export function SettingsPage(): ReactNode {
  const t = useTranslations('dashboard.settings');
  const locale = useLocale();
  const { practiceId, role } = useDesk();
  const canEdit = role === 'STAFF' || role === 'ADMIN';
  const week = useGetOpeningHours(practiceId, { query: { retry: false } });
  const special = useListSpecialDays(practiceId, { query: { retry: false } });
  const [news, setNews] = useState('');
  const newsRef = useRef<HTMLParagraphElement>(null);
  const hoursId = useId();
  const specialId = useId();
  useEffect(() => {
    if (news !== '') newsRef.current?.focus();
  }, [news]);
  const weekFormat = week.data === undefined ? undefined : practiceFormat(locale, week.data);
  const dayFormat = special.data === undefined ? undefined : practiceFormat(locale, special.data);
  return (
    <>
      <header className="mb-6">
        <h1 className="text-heading-h1 text-text-primary">{t('title')}</h1>
        <p className="text-body-default text-text-secondary">{t('practicePage')}</p>
      </header>
      <p
        ref={newsRef}
        role="status"
        tabIndex={-1}
        className="mb-4 text-body-default text-text-success outline-none empty:hidden"
      >
        {news}
      </p>
      <div className="grid grid-cols-1 items-start gap-6 desktop:grid-cols-2">
        <section aria-labelledby={hoursId} className={CARD}>
          <div>
            <h2 id={hoursId} className="text-heading-h3 text-text-primary">
              {t('hoursTitle')}
            </h2>
            <p className="text-body-default text-text-secondary">{t('hoursBody')}</p>
          </div>
          {week.data === undefined || weekFormat === undefined ? (
            week.isError ? (
              <FormError error={week.error} />
            ) : (
              <p role="status" className="text-body-default text-text-secondary">
                {t('loading')}
              </p>
            )
          ) : (
            <>
              {week.data.intervals.length === 0 ? (
                <p className="text-body-default text-text-secondary">{t('noHours')}</p>
              ) : (
                <dl className="flex flex-col gap-2">
                  {weekLinesOf(week.data.intervals, week.data.weekStart).map((line) => (
                    <div key={line.first} className="flex flex-wrap justify-between gap-x-4">
                      <dt className="text-body-default text-text-primary">
                        {line.first === line.last
                          ? weekFormat.weekday(line.first)
                          : t('days', {
                              first: weekFormat.weekday(line.first),
                              last: weekFormat.weekday(line.last),
                            })}
                      </dt>
                      <dd className="tabular-times text-body-default text-text-primary">
                        {hoursText(line.ranges, weekFormat, locale, t)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {canEdit ? (
                <div>
                  <HoursDialog week={week.data} onDone={setNews} />
                </div>
              ) : (
                <p className="text-body-small text-text-secondary">{t('readOnly')}</p>
              )}
            </>
          )}
        </section>
        <section aria-labelledby={specialId} className={CARD}>
          <div>
            <h2 id={specialId} className="text-heading-h3 text-text-primary">
              {t('specialTitle')}
            </h2>
            <p className="text-body-default text-text-secondary">{t('specialBody')}</p>
          </div>
          {special.data === undefined || dayFormat === undefined ? (
            special.isError ? (
              <FormError error={special.error} />
            ) : (
              <p role="status" className="text-body-default text-text-secondary">
                {t('loading')}
              </p>
            )
          ) : (
            <>
              {special.data.specialDays.length === 0 ? (
                <p className="text-body-default text-text-secondary">{t('noSpecial')}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border-subtle">
                  {special.data.specialDays.map((day) => (
                    <SpecialDayRow
                      key={day.id}
                      day={day}
                      format={dayFormat}
                      canEdit={canEdit}
                      onDone={setNews}
                    />
                  ))}
                </ul>
              )}
              {canEdit ? (
                <div>
                  <SpecialDayDialog
                    list={special.data}
                    onDone={(day) => {
                      setNews(t('addedSpecial', { date: dayFormat.dayLongWithYear(day.date) }));
                    }}
                  />
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
    </>
  );
}
