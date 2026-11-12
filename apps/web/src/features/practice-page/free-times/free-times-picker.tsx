'use client';

import {
  createQueryClient,
  isApiError,
  useGetPublicAvailability,
  useGetPublicFreeTimes,
} from '@medibooker/api-client';
import { QueryClientProvider } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, Phone, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { I18nProvider, Label } from 'react-aria-components';
import { flushSync } from 'react-dom';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { practiceFormat, type PracticeFormat, type PracticeFormatSettings } from '@/lib/format';
import { DURATION_FAST, EASE_ENTER, gsap, useGSAP } from '@/lib/motion/gsap';
import { onSessionChangeElsewhere } from '@/lib/session-broadcast';
import { cn } from '@/lib/utils';
import { clearChoice, expireChoice, saveChoice } from '../../portal/booking-choice';
import { telHref } from '../practice-view';
import {
  bookHref,
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
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus';

/** The service went offline or out of sight: that reads like nothing free, and trying again is no use. */
function noLongerOffered(error: unknown): boolean {
  return isApiError(error) && error.status === 404;
}

/** A time a person chose. */
export interface ChosenTime {
  readonly serviceId: string;
  readonly providerId: string | undefined;
  readonly startsAt: string;
}

/** What choosing a time does: where its link leads, and what happens on the way. */
interface TimeAction {
  readonly href: string;
  /** Prevent the default to stay on the page. */
  readonly onChoose: (time: ChosenTime, event: MouseEvent<HTMLAnchorElement>) => void;
}

interface FreeTimesPickerProps {
  readonly slug: string;
  readonly locale: string;
  readonly settings: PracticeFormatSettings;
  readonly today: string;
  readonly weekStart: number;
  /**
   * `label` is plain text, which React Aria's typeahead matches what is typed against: a mark that
   * isolates a name would stop that. `display` is what the list and the field show, with the name
   * isolated inside the sentence (B06); left out, the label shows on its own, isolated whole.
   */
  readonly services: readonly {
    readonly id: string;
    readonly label: string;
    readonly display?: string;
  }[];
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
      // A week without a free day has no stop in it, and a keyboard must still be able to scroll it.
      tabIndex={firstFree === undefined ? 0 : undefined}
      // Seven targets of 44 px are 308 px, which a phone of 360 px has only without the gaps and with
      // most of the card's padding; a narrower one scrolls this strip and not the page. The padding
      // is what keeps a scrolling box from cutting off the rings, and its scroll padding the same for
      // a day the focus brings into view.
      className={cn(
        '-mx-3 grid scroll-px-1 grid-cols-[repeat(7,minmax(var(--spacing-touch-target),1fr))] overflow-x-auto px-1 pb-1 tablet:mx-0 tablet:gap-1',
        FOCUS_RING,
      )}
      {...ROVING_GROUP}
    >
      {week.map((date) => {
        const free = days.some((day) => day.date === date && day.hasFreeTimes);
        const isSelected = date === selected;
        return (
          <div key={date} className="flex flex-col items-center gap-1">
            <span aria-hidden className="text-caption text-text-secondary">
              {/* A short name in Arabic is as wide as a phone's column, and runs into the next. */}
              <span className="tablet:hidden">{format.weekdayNarrow(date)}</span>
              <span className="hidden tablet:inline">{format.weekdayShort(date)}</span>
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
  readonly action: TimeAction;
  readonly serviceId: string;
  readonly providerId: string | undefined;
  readonly date: string;
  readonly format: PracticeFormat;
  /** A "Try again" passed: the chooser moves the focus, which its button had. */
  readonly onRetried: () => void;
}

function TimeGroup({
  label,
  times,
  action,
  serviceId,
  providerId,
  dayLabel,
  format,
}: {
  readonly label: string;
  readonly times: readonly { readonly startsAt: string }[];
  readonly action: TimeAction;
  readonly serviceId: string;
  readonly providerId: string | undefined;
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
              href={action.href}
              tabIndex={index === 0 ? 0 : -1}
              onKeyDown={onKeyDown}
              onClick={(event) => {
                action.onChoose({ serviceId, providerId, startsAt }, event);
              }}
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

function Times({
  slug,
  action,
  serviceId,
  providerId,
  date,
  format,
  onRetried,
}: TimesProps): ReactNode {
  const t = useTranslations('practicePage.freeTimes');
  const container = useRef<HTMLDivElement>(null);
  const { data, isPending, isError, error, refetch } = useGetPublicFreeTimes(
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
  if (noLongerOffered(error)) {
    return <p className="text-body-default text-text-primary">{t('empty')}</p>;
  }
  if (isError) {
    return (
      <Alert>
        <AlertDescription>{t('error')}</AlertDescription>
        <Button
          variant="outline"
          className="mt-2"
          onPress={() => {
            void refetch().then(({ isSuccess }) => {
              if (isSuccess) onRetried();
            });
          }}
        >
          {t('retry')}
        </Button>
      </Alert>
    );
  }
  const { morning, afternoon } = partsOfDay(times, ({ startsAt }) => format.instantHour(startsAt));
  const dayLabel = format.dayLong(date);
  const group = { action, serviceId, providerId, dayLabel, format };
  return (
    <div ref={container} className="flex flex-col gap-4">
      <TimeGroup label={t('morning')} times={morning} {...group} />
      <TimeGroup label={t('afternoon')} times={afternoon} {...group} />
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

interface FreeTimesChooserProps extends FreeTimesPickerProps {
  readonly action: TimeAction;
  /** What the picker says below the times; on a public page, how booking goes on. */
  readonly hint?: string;
  /** The doctor to start on, as long as the list has them; "Any doctor" stays a choice. */
  readonly initialProviderId?: string | null;
  /** What follows the headings above the chooser on its page: an `h3` under a section's `h2`. */
  readonly dayHeadingLevel?: 'h2' | 'h3';
}

/**
 * Service, doctor, a week of days and the times of the chosen day, on a page that has its query
 * client and React Aria's language.
 */
export function FreeTimesChooser({
  slug,
  locale,
  settings,
  today,
  weekStart,
  services,
  doctors,
  phone,
  action,
  hint,
  initialProviderId,
  dayHeadingLevel: DayHeading = 'h3',
}: FreeTimesChooserProps): ReactNode {
  const t = useTranslations('practicePage.freeTimes');
  const format = practiceFormat(locale, settings);
  const hasJavaScript = useHasJavaScript();
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [providerId, setProviderId] = useState(
    () => doctors.find(({ id }) => id === initialProviderId)?.id,
  );
  const [chosenDate, setChosenDate] = useState<string>();
  const [shownWeek, setShownWeek] = useState<number>();
  const previousArrow = useRef<HTMLButtonElement>(null);
  const nextArrow = useRef<HTMLButtonElement>(null);
  // A "Try again" that passed took its button, and the focus, away: the day's heading takes it, or
  // what the chooser says instead of a day (B06).
  const dayHeading = useRef<HTMLHeadingElement>(null);
  const noDays = useRef<HTMLParagraphElement>(null);
  const [retried, setRetried] = useState(0);
  useEffect(() => {
    if (retried > 0) (dayHeading.current ?? noDays.current)?.focus();
  }, [retried]);
  const onRetried = (): void => {
    setRetried((count) => count + 1);
  };

  const availability = useGetPublicAvailability(
    slug,
    { serviceId, ...(providerId === undefined ? {} : { providerId }) },
    { query: { refetchInterval: POLL_MS }, request: REQUEST },
  );
  const gone = noLongerOffered(availability.error);
  const days = gone ? [] : (availability.data?.days ?? []);
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

  // At the first or last week the pressed arrow disables itself, which would drop the focus to the
  // page. So it goes to the other arrow, which can be disabled until this week is on screen.
  const showWeek = (index: number, otherArrow: RefObject<HTMLButtonElement | null>): void => {
    flushSync(() => {
      setShownWeek(index);
    });
    if (index === 0 || index === weeks.length - 1) otherArrow.current?.focus();
  };

  return (
    <div className="grid grid-cols-1 gap-8 rounded-lg border border-border-default bg-bg-surface p-4 tablet:p-6 desktop:grid-cols-3">
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
            {services.map(({ id, label, display }) => (
              <SelectItem key={id} id={id} textValue={label}>
                {display ?? <bdi>{label}</bdi>}
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
        ) : availability.isError && !gone ? (
          <Alert>
            <AlertDescription>{t('error')}</AlertDescription>
            <Button
              variant="outline"
              className="mt-2"
              onPress={() => {
                void availability.refetch().then(({ isSuccess }) => {
                  if (isSuccess) onRetried();
                });
              }}
            >
              {t('retry')}
            </Button>
          </Alert>
        ) : selected === undefined ? (
          // Only a script focuses it, after a "Try again". Its ring stays: `outline-none` would also
          // hide the rings of the chooser's own targets (see its test).
          <p ref={noDays} tabIndex={-1} className="text-body-default text-text-primary">
            {t('empty')}
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <p className="text-label-large text-text-primary">
                {format.monthYear(week[0] ?? today)}
              </p>
              <div className="flex">
                <Button
                  ref={previousArrow}
                  variant="ghost"
                  size="icon"
                  aria-label={t('previousWeek')}
                  isDisabled={weekIndex === 0}
                  onPress={() => {
                    showWeek(weekIndex - 1, nextArrow);
                  }}
                >
                  <ChevronLeft aria-hidden className="size-5 rtl:rotate-180" />
                </Button>
                <Button
                  ref={nextArrow}
                  variant="ghost"
                  size="icon"
                  aria-label={t('nextWeek')}
                  isDisabled={weekIndex >= weeks.length - 1}
                  onPress={() => {
                    showWeek(weekIndex + 1, previousArrow);
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
            <DayHeading
              ref={dayHeading}
              tabIndex={-1}
              className="text-heading-h3 text-text-primary"
            >
              {format.dayLong(selected)}
            </DayHeading>
            <Times
              slug={slug}
              action={action}
              serviceId={serviceId}
              providerId={providerId}
              date={selected}
              format={format}
              onRetried={onRetried}
            />
            <p className="text-caption text-text-tertiary">{hint ?? t('hint')}</p>
          </>
        )}
        <CallUs phone={phone} />
      </div>
    </div>
  );
}

/**
 * Free times without sign-in (PW13, P-77). Its own query client and React Aria's language, because
 * nothing else on this page needs them on the client. A chosen time goes along to the booking, which
 * signs a visitor in on the way.
 */
export function FreeTimesPicker(props: FreeTimesPickerProps): ReactNode {
  const [queryClient] = useState(createQueryClient);
  const { slug, locale } = props;
  // This page has no signed-in frame, so nothing else here looks after a choice stored earlier.
  useEffect(() => {
    expireChoice();
    return onSessionChangeElsewhere(clearChoice);
  }, []);
  const action: TimeAction = {
    href: bookHref(locale, slug),
    onChoose: ({ serviceId, providerId, startsAt }) => {
      saveChoice({ slug, serviceId, startsAt, providerId });
    },
  };
  return (
    <I18nProvider locale={locale}>
      <QueryClientProvider client={queryClient}>
        <FreeTimesChooser {...props} action={action} />
      </QueryClientProvider>
    </I18nProvider>
  );
}
