'use client';

import {
  useGetProfile,
  useGetPublicPractice,
  useListMyAppointments,
  useListMyPractices,
  type AppointmentDto,
  type MyPracticeDto,
  type PublicPracticeDto,
} from '@medibooker/api-client';
import { isolate } from '@medibooker/i18n';
import { CalendarDays, CalendarPlus, ChevronRight, Mail, MapPin, Phone } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Button, LinkButton } from '@/components/ui/button';
import { practiceFormat } from '@/lib/format';
import { TEXT_LINK, useFocusOnArrival } from '../auth/form-parts';
import { ContactRow } from '../practice-page/contact-row';
import { mailtoHref, mapsHref, telHref } from '../practice-page/practice-view';
import { formatOf, practiceById, textIn, whenParts } from './appointment-view';
import { fanOutRetryDelay, MissingPractices, retryFanOut } from './appointments-page';
import { downloadCalendarFile } from './calendar-file';
import { CancelButton } from './cancel-button';
import { bookHref } from './free-times/free-times-view';
import {
  Card,
  LoadError,
  Loading,
  RetryButton,
  StaleNotice,
  StatusBadge,
  StatusNote,
  TooLateText,
  useArrivals,
} from './portal-parts';

/** What comes after the next appointment on the home; the rest is on PW7. */
const UPCOMING_SHOWN = 3;
const MINUTE_MS = 60_000;
const ICON_TILE =
  'flex size-10 shrink-0 items-center justify-center rounded-md bg-bg-subtle text-icon-secondary';

/** A practice as the home names it: the installation's, else the person's list. */
interface PracticeNames {
  readonly contact: PublicPracticeDto | undefined;
  readonly practices: readonly MyPracticeDto[] | undefined;
}

function practiceNameOf(
  { contact, practices }: PracticeNames,
  practiceId: string,
  locale: string,
): string {
  if (contact?.id === practiceId) return contact.name ?? '';
  const known = practiceById(practices, practiceId);
  return known === undefined ? '' : textIn(known.name, locale);
}

/** The day of the practice, and a greeting with the person's first name where the account has one. */
function Greeting({
  name,
  today,
  focusOnArrival,
}: {
  readonly name: string | undefined;
  readonly today: string | undefined;
  readonly focusOnArrival: boolean;
}): ReactNode {
  const t = useTranslations('portal.home');
  const heading = useFocusOnArrival(focusOnArrival);
  return (
    <div className="min-w-0">
      {today === undefined ? null : (
        <p className="text-body-default text-text-secondary">{today}</p>
      )}
      {/* Only a script can focus it: the focus is shown by what is read out, not by a ring. */}
      <h1
        ref={heading}
        tabIndex={focusOnArrival ? -1 : undefined}
        className="text-heading-h1 wrap-anywhere text-text-primary outline-none"
      >
        {name === undefined || name === '' ? t('hello') : t('helloName', { name: isolate(name) })}
      </h1>
    </div>
  );
}

/** PW2's first card: the next appointment, and what can be done about it now. */
function NextAppointment({
  appointment,
  practiceName,
  address,
  onChanged,
}: {
  readonly appointment: AppointmentDto;
  readonly practiceName: string;
  readonly address: string | null | undefined;
  readonly onChanged: (news?: string) => void;
}): ReactNode {
  const t = useTranslations('portal');
  const locale = useLocale();
  const format = formatOf(appointment, locale);
  const date = format.instantDate(appointment.startsAt);
  const { date: day, time } = whenParts(format, appointment.startsAt);
  // The visit's own length (BR-27), from the answer: the page reads no clock.
  const minutes = Math.round(
    (Date.parse(appointment.endsAt) - Date.parse(appointment.startsAt)) / MINUTE_MS,
  );
  const service = textIn(appointment.serviceName, locale);
  const named = { service: isolate(service), date: day, time };
  const detailsHref = `/${locale}/appointments/${appointment.practiceId}/${appointment.id}`;
  const ahead = appointment.status === 'BOOKED' && !appointment.started;
  const who = [appointment.providerName ?? '', practiceName].filter((part) => part !== '');
  return (
    <section
      aria-labelledby="next-appointment"
      className="rounded-lg border border-border-brand bg-bg-brand-subtle p-6"
    >
      <div className="flex flex-col gap-4 tablet:flex-row">
        <div
          aria-hidden
          className="flex size-16 shrink-0 flex-col items-center justify-center rounded-md bg-bg-surface"
        >
          <span className="text-caption text-text-brand">{format.monthShort(date)}</span>
          <span className="tabular-times text-heading-h2 text-text-brand">
            {format.dayOfMonth(date)}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="next-appointment" className="text-body-small text-text-secondary">
              {t('home.next')}
            </h2>
            <StatusBadge appointment={appointment} />
          </div>
          {/* Its name is what it shows (WCAG 2.5.3): the card's heading says whose it is. */}
          <a
            href={detailsHref}
            className="inline-flex min-h-touch-target items-center text-heading-h2 wrap-anywhere text-text-primary hover:underline"
          >
            <bdi>{service}</bdi>
          </a>
          <p className="text-body-default text-text-primary">
            {t('home.when', { date: day, time, count: minutes, minutes: format.number(minutes) })}
          </p>
          {who.length === 0 ? null : (
            <p className="text-body-small wrap-anywhere text-text-secondary">
              {who.map((part, index) => (
                <span key={part}>
                  {index === 0 ? null : ' · '}
                  <bdi>{part}</bdi>
                </span>
              ))}
            </p>
          )}
          {ahead ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {appointment.changeable ? (
                <>
                  <LinkButton
                    variant="outline"
                    href={`${detailsHref}/reschedule`}
                    aria-label={t('list.rescheduleLabel', named)}
                  >
                    {t('list.reschedule')}
                  </LinkButton>
                  <CancelButton
                    appointment={appointment}
                    label={t('list.cancel')}
                    name={t('list.cancelLabel', named)}
                    onChanged={onChanged}
                  />
                </>
              ) : null}
              <Button
                variant="ghost"
                className="text-text-brand"
                onPress={() => {
                  downloadCalendarFile(
                    {
                      id: appointment.id,
                      startsAt: appointment.startsAt,
                      endsAt: appointment.endsAt,
                      bookedAt: appointment.bookedAt,
                      summary: t('book.calendarSummary', {
                        practice: practiceName === '' ? t('list.somePractice') : practiceName,
                      }),
                      location: address ?? null,
                    },
                    t('book.calendarFileName'),
                  );
                }}
              >
                <CalendarPlus aria-hidden data-icon="inline-start" />
                {t('book.addToCalendar')}
              </Button>
            </div>
          ) : null}
          {ahead && !appointment.changeable ? (
            <p className="text-body-small text-text-secondary">
              <TooLateText />
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** The appointments after the next one, each a way to its details. */
function Upcoming({
  items,
  names,
}: {
  readonly items: readonly AppointmentDto[];
  readonly names: PracticeNames;
}): ReactNode {
  const t = useTranslations('portal');
  const locale = useLocale();
  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-heading-h3 text-text-primary">{t('home.upcoming')}</h2>
        <a href={`/${locale}/appointments`} className={TEXT_LINK}>
          {t('home.all')}
        </a>
      </div>
      <ul>
        {items.map((appointment) => {
          const format = formatOf(appointment, locale);
          const { date, time } = whenParts(format, appointment.startsAt);
          const service = textIn(appointment.serviceName, locale);
          const practiceName = practiceNameOf(names, appointment.practiceId, locale);
          const who = [appointment.providerName ?? '', practiceName].filter((part) => part !== '');
          return (
            <li key={appointment.id} className="border-b border-border-subtle last:border-b-0">
              {/* Its name is what it shows: service, day, time and who (WCAG 2.5.3). */}
              <a
                href={`/${locale}/appointments/${appointment.practiceId}/${appointment.id}`}
                className="flex min-h-touch-target items-center gap-3 py-3 hover:bg-bg-subtle"
              >
                <span aria-hidden className={ICON_TILE}>
                  <CalendarDays className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-body-default wrap-anywhere text-text-primary">
                    <bdi>{service}</bdi>
                  </span>
                  <span className="block text-body-small wrap-anywhere text-text-secondary">
                    {t('appointment.when', { date, time })}
                    {who.map((part) => (
                      <span key={part}>
                        {' · '}
                        <bdi>{part}</bdi>
                      </span>
                    ))}
                  </span>
                </span>
                <ChevronRight
                  aria-hidden
                  className="size-5 shrink-0 text-icon-secondary rtl:rotate-180"
                />
              </a>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** How to reach the practice, from its public page (P03). */
function PracticeContact({
  practice,
  practiceHref,
}: {
  readonly practice: PublicPracticeDto;
  readonly practiceHref: string | undefined;
}): ReactNode {
  const t = useTranslations('portal');
  const iconClass = 'size-5 text-icon-secondary';
  return (
    <Card>
      <h2 className="text-heading-h3 wrap-anywhere text-text-primary">
        <bdi>{practice.name ?? t('home.contactTitle')}</bdi>
      </h2>
      <ul className="mt-2">
        {practice.address === null ? null : (
          <ContactRow
            icon={<MapPin aria-hidden className={iconClass} />}
            title={<bdi>{practice.address}</bdi>}
            note={t('home.openInMaps')}
            href={mapsHref(practice.address)}
            external
          />
        )}
        {practice.phone === null ? null : (
          <ContactRow
            icon={<Phone aria-hidden className={iconClass} />}
            title={<span dir="ltr">{practice.phone}</span>}
            note={t('home.phone')}
            href={telHref(practice.phone)}
          />
        )}
        {practice.email === null ? null : (
          <ContactRow
            icon={<Mail aria-hidden className={iconClass} />}
            title={<span dir="ltr">{practice.email}</span>}
            note={t('home.email')}
            href={mailtoHref(practice.email)}
          />
        )}
      </ul>
      {practiceHref === undefined ? null : (
        <a href={practiceHref} className={`${TEXT_LINK} mt-2`}>
          {t('home.practicePage')}
        </a>
      )}
    </Card>
  );
}

interface HomePageProps {
  /** The installation's practice (ADR 0016); undefined where it serves several. */
  readonly slug: string | undefined;
  /** Its page, which only the server knows. */
  readonly practiceHref: string | undefined;
}

/**
 * PW2: the next appointment and what is to come, and how to reach the practice. Where a sign-in
 * without a way back lands (B06). Family, the record and a doctor's instructions follow with FA01,
 * R03 and R01.
 */
export function HomePage({ slug, practiceHref }: HomePageProps): ReactNode {
  const t = useTranslations('portal');
  const locale = useLocale();
  const profile = useGetProfile();
  const practice = useGetPublicPractice(slug ?? '', undefined, {
    query: { enabled: slug !== undefined },
  });
  const list = useListMyAppointments({
    query: { retry: retryFanOut, retryDelay: fanOutRetryDelay },
  });
  const practices = useListMyPractices();
  const { arrival, said, onChanged } = useArrivals();
  // A booking starts on its own page (B07); where there are several practices, the list leads to each.
  const booking = slug === undefined ? `/${locale}/appointments` : bookHref(locale, slug);
  const today =
    practice.data === undefined
      ? undefined
      : practiceFormat(locale, practice.data).dayLongWithYear(practice.data.today);
  const names: PracticeNames = { contact: practice.data, practices: practices.data?.items };
  let appointments: ReactNode;
  if (list.isPending) {
    appointments = <Loading>{t('list.loading')}</Loading>;
  } else if (list.data === undefined) {
    appointments = <LoadError query={list} onPassed={onChanged} />;
  } else {
    const { items, unavailablePractices } = list.data;
    const [next, ...rest] = items;
    appointments = (
      <>
        {list.isRefetchError ? <StaleNotice query={list} onPassed={onChanged} /> : null}
        <MissingPractices
          missing={unavailablePractices}
          practices={practices.data?.items}
          retry={<RetryButton query={list} onPassed={onChanged} />}
        />
        {next === undefined ? (
          // With a practice missing there is no telling: a person must not read that there is nothing.
          unavailablePractices.length === 0 ? (
            <Card>
              <p className="text-body-default text-text-primary">{t('home.empty')}</p>
            </Card>
          ) : null
        ) : (
          <NextAppointment
            appointment={next}
            practiceName={practiceNameOf(names, next.practiceId, locale)}
            address={practice.data?.id === next.practiceId ? practice.data.address : undefined}
            onChanged={onChanged}
          />
        )}
        {rest.length === 0 ? (
          <a href={`/${locale}/appointments`} className={TEXT_LINK}>
            {t('home.all')}
          </a>
        ) : (
          <Upcoming items={rest.slice(0, UPCOMING_SHOWN)} names={names} />
        )}
      </>
    );
  }
  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <Greeting
          key={arrival}
          name={profile.data?.firstName}
          today={today}
          focusOnArrival={arrival > 0}
        />
        <LinkButton href={booking}>
          <CalendarPlus aria-hidden data-icon="inline-start" />
          {t('home.book')}
        </LinkButton>
      </header>
      <StatusNote>{said}</StatusNote>
      <div className="grid grid-cols-1 gap-6 desktop:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 desktop:col-span-2">{appointments}</div>
        <div className="flex min-w-0 flex-col gap-6">
          {practice.data === undefined ? (
            practice.isError ? (
              <LoadError query={practice} />
            ) : null
          ) : (
            <PracticeContact practice={practice.data} practiceHref={practiceHref} />
          )}
        </div>
      </div>
    </>
  );
}
