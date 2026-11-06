'use client';

import {
  createQueryClient,
  useGetPublicAvailability,
  useGetPublicFreeTimes,
} from '@medibooker/api-client';
import { QueryClientProvider } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, Phone, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { I18nProvider, Label } from 'react-aria-components';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { practiceFormat, type PracticeFormat, type PracticeFormatSettings } from '@/lib/format';
import { DURATION_FAST, EASE_ENTER, gsap, useGSAP } from '@/lib/motion/gsap';
import { cn } from '@/lib/utils';
import { telHref } from '../practice-view';
import {
  handOffHref,
  partsOfDay,
  selectedDay,
  weeksFrom,
  type AvailabilityDay,
} from './free-times-view';
import { ROVING_GROUP, ROVING_ITEM, useRovingFocus } from './use-roving-focus';

/** How often an open page asks again; a slot someone else booked disappears within this (08 P06). */
const POLL_MS = 45_000;
/** Past the browser's 30 seconds of keeping an answer: it asks the server whether it still holds. */
const REQUEST = { cache: 'no-cache' } as const;
const CHIP_RISE_PX = 4;
const CHIP_STAGGER_SECONDS = 0.02;

function noSubscription(): () => void {
  return () => undefined;
}

/** False in the HTML of the server: without JavaScript nothing is on its way, so say nothing. */
function useHasJavaScript(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

const FOCUS_RING =
  'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus';

export interface FreeTimesPickerProps {
  readonly slug: string;
  readonly locale: string;
  readonly settings: PracticeFormatSettings;
  readonly today: string;
  readonly weekStart: number;
  readonly services: readonly { readonly id: string; readonly label: string }[];
  readonly doctors: readonly {
    readonly id: string;
    readonly name: string;
    readonly initials: string;
  }[];
  readonly phone: string | null;
}

function Doctors({
  doctors,
  value,
  onChange,
}: {
  readonly doctors: FreeTimesPickerProps['doctors'];
  readonly value: string | undefined;
  readonly onChange: (id: string | undefined) => void;
}): ReactNode {
  const t = useTranslations('practicePage.freeTimes');
  const onKeyDown = useRovingFocus({ selectOnMove: true });
  const options = [{ id: undefined, name: t('anyDoctor'), initials: undefined }, ...doctors];
  return (
    <div>
      <p id="free-times-doctor" className="text-label-default text-text-primary">
        {t('doctor')}
      </p>
      <div
        role="radiogroup"
        aria-labelledby="free-times-doctor"
        className="mt-2 grid grid-cols-3 gap-2"
        {...ROVING_GROUP}
      >
        {options.map(({ id, name, initials }) => {
          const selected = id === value;
          return (
            <button
              key={id ?? 'any'}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onKeyDown={onKeyDown}
              onClick={() => {
                onChange(id);
              }}
              className={cn(
                'flex flex-col items-center gap-2 rounded-md py-1 text-center text-label-small',
                selected ? 'text-text-brand' : 'text-text-primary',
                FOCUS_RING,
              )}
              {...ROVING_ITEM}
            >
              <span
                aria-hidden
                className={cn(
                  'relative flex size-16 items-center justify-center rounded-full text-heading-h3',
                  selected
                    ? 'border-2 border-border-brand bg-bg-brand-muted text-text-brand'
                    : 'bg-bg-subtle text-text-secondary',
                )}
              >
                {initials ?? <Users className="size-6" />}
                {selected ? (
                  <span className="absolute -bottom-1 flex size-5 items-center justify-center rounded-full bg-bg-brand text-text-on-brand">
                    <Check className="size-3" />
                  </span>
                ) : null}
              </span>
              <bdi>{name}</bdi>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WeekStrip({
  week,
  days,
  today,
  selected,
  format,
  onSelect,
}: {
  readonly week: readonly string[];
  readonly days: readonly AvailabilityDay[];
  readonly today: string;
  readonly selected: string | undefined;
  readonly format: PracticeFormat;
  readonly onSelect: (date: string) => void;
}): ReactNode {
  const t = useTranslations('practicePage.freeTimes');
  const onKeyDown = useRovingFocus({ selectOnMove: true });
  const firstFree = week.find((date) => days.some((d) => d.date === date && d.hasFreeTimes));
  const tabStop = selected !== undefined && week.includes(selected) ? selected : firstFree;
  return (
    <div
      role="radiogroup"
      aria-label={t('days')}
      className="grid grid-cols-7 gap-1"
      {...ROVING_GROUP}
    >
      {week.map((date) => {
        const free = days.some((day) => day.date === date && day.hasFreeTimes);
        const isSelected = date === selected;
        return (
          <div key={date} className="flex flex-col items-center gap-1">
            <span aria-hidden className="text-caption text-text-secondary">
              {format.weekdayShort(date)}
            </span>
            <button
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={format.dayLong(date)}
              aria-current={date === today ? 'date' : undefined}
              disabled={!free}
              tabIndex={date === tabStop ? 0 : -1}
              onKeyDown={onKeyDown}
              onClick={() => {
                onSelect(date);
              }}
              className={cn(
                'flex size-touch-target flex-col items-center justify-center gap-1 rounded-full text-label-default',
                isSelected && 'bg-bg-brand text-text-on-brand',
                !isSelected && free && 'text-text-primary hover:bg-bg-subtle',
                !free && 'text-text-disabled',
                date === today && !isSelected && 'border border-border-brand text-text-brand',
                FOCUS_RING,
              )}
              {...ROVING_ITEM}
            >
              <span className="tabular-times">{format.dayOfMonth(date)}</span>
              {free ? <span aria-hidden className="size-1 rounded-full bg-current" /> : null}
            </button>
          </div>
        );
      })}
    </div>
  );
}

interface TimesProps {
  readonly slug: string;
  readonly locale: string;
  readonly serviceId: string;
  readonly providerId: string | undefined;
  readonly date: string;
  readonly format: PracticeFormat;
}

function TimeGroup({
  label,
  times,
  href,
  dayLabel,
  format,
}: {
  readonly label: string;
  readonly times: readonly { readonly startsAt: string }[];
  readonly href: string;
  readonly dayLabel: string;
  readonly format: PracticeFormat;
}): ReactNode {
  const t = useTranslations('practicePage.freeTimes');
  const onKeyDown = useRovingFocus();
  if (times.length === 0) return null;
  return (
    <div>
      <p className="text-label-small text-text-secondary">{label}</p>
      <div
        role="group"
        aria-label={label}
        className="mt-2 grid grid-cols-2 gap-2 tablet:grid-cols-3"
        {...ROVING_GROUP}
      >
        {times.map(({ startsAt }, index) => {
          const time = format.instantTime(startsAt);
          return (
            <a
              key={startsAt}
              href={href}
              tabIndex={index === 0 ? 0 : -1}
              onKeyDown={onKeyDown}
              aria-label={t('timeLabel', { day: dayLabel, time })}
              className={cn(
                'tabular-times flex min-h-touch-target items-center justify-center rounded-md border border-border-brand bg-bg-surface text-label-large text-text-brand hover:bg-bg-brand-subtle',
                FOCUS_RING,
              )}
              {...ROVING_ITEM}
            >
              {time}
            </a>
          );
        })}
      </div>
    </div>
  );
}

function Times({ slug, locale, serviceId, providerId, date, format }: TimesProps): ReactNode {
  const t = useTranslations('practicePage.freeTimes');
  const container = useRef<HTMLDivElement>(null);
  const { data, isPending, isError, refetch } = useGetPublicFreeTimes(
    slug,
    { serviceId, date, ...(providerId === undefined ? {} : { providerId }) },
    { query: { refetchInterval: POLL_MS }, request: REQUEST },
  );
  const times = data?.times ?? [];
  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add('screen and (prefers-reduced-motion: no-preference)', () => {
        gsap.from('a', {
          opacity: 0,
          y: CHIP_RISE_PX,
          duration: DURATION_FAST,
          ease: EASE_ENTER,
          stagger: CHIP_STAGGER_SECONDS,
        });
      });
    },
    {
      scope: container,
      dependencies: [times.map(({ startsAt }) => startsAt).join()],
      revertOnUpdate: true,
    },
  );
  if (isPending) {
    return (
      <p role="status" className="text-body-default text-text-secondary">
        {t('loading')}
      </p>
    );
  }
  if (isError) {
    return (
      <Alert>
        <AlertDescription>{t('error')}</AlertDescription>
        <Button
          variant="outline"
          className="mt-2"
          onPress={() => {
            void refetch();
          }}
        >
          {t('retry')}
        </Button>
      </Alert>
    );
  }
  const { morning, afternoon } = partsOfDay(times, ({ startsAt }) => format.instantHour(startsAt));
  const dayLabel = format.dayLong(date);
  const href = handOffHref(locale, slug);
  return (
    <div ref={container} className="flex flex-col gap-4">
      <TimeGroup
        label={t('morning')}
        times={morning}
        href={href}
        dayLabel={dayLabel}
        format={format}
      />
      <TimeGroup
        label={t('afternoon')}
        times={afternoon}
        href={href}
        dayLabel={dayLabel}
        format={format}
      />
    </div>
  );
}

function CallUs({ phone }: { readonly phone: string | null }): ReactNode {
  const t = useTranslations('practicePage.freeTimes');
  if (phone === null) return null;
  return (
    <p className="flex flex-wrap items-center gap-2 text-body-small text-text-secondary">
      {t('orCall')}
      <a
        href={telHref(phone)}
        className={cn(
          'inline-flex min-h-touch-target items-center gap-2 text-label-default text-text-brand hover:underline',
          FOCUS_RING,
        )}
      >
        <Phone aria-hidden className="size-4" />
        <span dir="ltr">{phone}</span>
      </a>
    </p>
  );
}

function Picker({
  slug,
  locale,
  settings,
  today,
  weekStart,
  services,
  doctors,
  phone,
}: FreeTimesPickerProps): ReactNode {
  const t = useTranslations('practicePage.freeTimes');
  const format = practiceFormat(locale, settings);
  const hasJavaScript = useHasJavaScript();
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [providerId, setProviderId] = useState<string>();
  const [chosenDate, setChosenDate] = useState<string>();
  const [shownWeek, setShownWeek] = useState<number>();

  const availability = useGetPublicAvailability(
    slug,
    { serviceId, ...(providerId === undefined ? {} : { providerId }) },
    { query: { refetchInterval: POLL_MS }, request: REQUEST },
  );
  const days = availability.data?.days ?? [];
  const selected = selectedDay(days, chosenDate);
  const weeks = weeksFrom(today, weekStart, days.at(-1)?.date ?? today);
  const weekOfSelected = weeks.findIndex(
    (week) => selected !== undefined && week.includes(selected),
  );
  const weekIndex = shownWeek ?? Math.max(weekOfSelected, 0);
  const week = weeks[weekIndex] ?? [];

  const startOver = (): void => {
    setChosenDate(undefined);
    setShownWeek(undefined);
  };

  return (
    <div className="grid grid-cols-1 gap-8 rounded-lg border border-border-default bg-bg-surface p-6 desktop:grid-cols-3">
      <div className="flex min-w-0 flex-col gap-4">
        <Select
          value={serviceId}
          onChange={(key) => {
            setServiceId(String(key));
            startOver();
          }}
        >
          <Label className="text-label-default text-text-primary">{t('service')}</Label>
          <SelectTrigger className="mt-2" />
          <SelectContent>
            {services.map(({ id, label }) => (
              <SelectItem key={id} id={id} textValue={label}>
                <bdi>{label}</bdi>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {doctors.length === 0 ? null : (
          <Doctors
            doctors={doctors}
            value={providerId}
            onChange={(id) => {
              setProviderId(id);
              startOver();
            }}
          />
        )}
        <p className="text-caption text-text-tertiary">{t('timeZoneNote')}</p>
      </div>

      <div className="flex min-w-0 flex-col gap-4 desktop:col-span-2">
        {availability.isPending ? (
          hasJavaScript ? (
            <p role="status" className="text-body-default text-text-secondary">
              {t('loading')}
            </p>
          ) : null
        ) : availability.isError ? (
          <Alert>
            <AlertDescription>{t('error')}</AlertDescription>
            <Button
              variant="outline"
              className="mt-2"
              onPress={() => {
                void availability.refetch();
              }}
            >
              {t('retry')}
            </Button>
          </Alert>
        ) : selected === undefined ? (
          <p className="text-body-default text-text-primary">{t('empty')}</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <p className="text-label-large text-text-primary">
                {format.monthYear(week[0] ?? today)}
              </p>
              <div className="flex">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('previousWeek')}
                  isDisabled={weekIndex === 0}
                  onPress={() => {
                    setShownWeek(weekIndex - 1);
                  }}
                >
                  <ChevronLeft aria-hidden className="size-5 rtl:rotate-180" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('nextWeek')}
                  isDisabled={weekIndex >= weeks.length - 1}
                  onPress={() => {
                    setShownWeek(weekIndex + 1);
                  }}
                >
                  <ChevronRight aria-hidden className="size-5 rtl:rotate-180" />
                </Button>
              </div>
            </div>
            <WeekStrip
              week={week}
              days={days}
              today={today}
              selected={selected}
              format={format}
              onSelect={setChosenDate}
            />
            <h3 className="text-heading-h3 text-text-primary">{format.dayLong(selected)}</h3>
            <Times
              slug={slug}
              locale={locale}
              serviceId={serviceId}
              providerId={providerId}
              date={selected}
              format={format}
            />
            <p className="text-caption text-text-tertiary">{t('hint')}</p>
          </>
        )}
        <CallUs phone={phone} />
      </div>
    </div>
  );
}

/**
 * Free times without sign-in (PW13, P-77): service, doctor, a week of days and the times of the
 * chosen day. Its own query client, because nothing else on this page reads on the client.
 */
export function FreeTimesPicker(props: FreeTimesPickerProps): ReactNode {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider locale={props.locale}>
        <Picker {...props} />
      </I18nProvider>
    </QueryClientProvider>
  );
}
