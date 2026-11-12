'use client';

import {
  isApiError,
  shouldRetryQuery,
  useListMyAppointments,
  useListMyAppointmentsInPractice,
  useListMyPractices,
  type AppointmentDto,
  type MyPracticeDto,
  type UnavailablePracticeDto,
} from '@medibooker/api-client';
import { isolate } from '@medibooker/i18n';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';
import type { Key } from 'react-aria-components';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, LinkButton } from '@/components/ui/button';
import { Tab, TabList, TabPanel, Tabs } from '@/components/ui/tabs';
import { useFragmentValue } from '../auth/fragment';
import { PageHeading, useFocusOnArrival } from '../auth/form-parts';
import {
  formatOf,
  isId,
  MAX_REVEAL_PAGES,
  nameInSentence,
  practiceById,
  practiceNames,
  textIn,
  whenParts,
} from './appointment-view';
import { CancelButton } from './cancel-button';
import { bookHref } from './free-times/free-times-view';
import {
  LoadError,
  Loading,
  RetryButton,
  StaleNotice,
  StatusBadge,
  StatusNote,
  TooLateText,
  useArrivals,
} from './portal-parts';

/**
 * One fan-out at a time per account: a second tab's question passes when the first is done, at most
 * two `ME_FANOUT_TIMEOUT_MS` later, 4 seconds by default. So it asks again for longer than that, as
 * often as the API says, and only while the wait is short: a throttle's minute shows the error at
 * once, because a person should know, and another try would only count against the same limit.
 */
const FAN_OUT_RETRIES = 5;
const FAN_OUT_SHORT_WAIT_SECONDS = 5;
const SECOND_MS = 1000;

function retryAfterOf(error: unknown): number | undefined {
  return isApiError(error) ? error.retryAfterSeconds : undefined;
}

export function retryFanOut(failures: number, error: unknown): boolean {
  const wait = retryAfterOf(error);
  if (wait !== undefined && wait > FAN_OUT_SHORT_WAIT_SECONDS) return false;
  return wait !== undefined && isApiError(error, 'RATE_LIMITED')
    ? failures < FAN_OUT_RETRIES
    : shouldRetryQuery(failures, error);
}

export function fanOutRetryDelay(_failures: number, error: unknown): number {
  return Math.max(retryAfterOf(error) ?? 1, 1) * SECOND_MS;
}

type OnChanged = (news?: string) => void;

interface AppointmentRowProps {
  readonly appointment: AppointmentDto;
  readonly practice: MyPracticeDto | undefined;
  /** In the history: the way back from its details leads there again. */
  readonly past?: boolean;
  /** The first of the rows "Show more" brought: the button that had the focus has gone. */
  readonly focusOnArrival?: boolean;
  readonly onChanged: OnChanged;
}

function AppointmentRow({
  appointment,
  practice,
  past = false,
  focusOnArrival = false,
  onChanged,
}: AppointmentRowProps): ReactNode {
  const t = useTranslations('portal.list');
  const locale = useLocale();
  const link = useFocusOnArrival<HTMLAnchorElement>(focusOnArrival);
  const format = formatOf(appointment, locale);
  const { date, time } = whenParts(format, appointment.startsAt);
  const service = textIn(appointment.serviceName, locale);
  const practiceName = practice === undefined ? '' : textIn(practice.name, locale);
  const named = { service: isolate(service), date, time };
  const detailsHref = `/${locale}/appointments/${appointment.practiceId}/${appointment.id}`;
  return (
    <li className="grid grid-cols-1 items-center gap-3 border-b border-border-subtle p-4 last:border-b-0 tablet:grid-cols-4">
      <div>
        <p className="text-label-default text-text-primary">{date}</p>
        <p className="tabular-times text-body-small text-text-secondary">{time}</p>
      </div>
      <div className="min-w-0">
        <a
          ref={link}
          href={past ? `${detailsHref}#from=past` : detailsHref}
          aria-label={t('rowLabel', named)}
          // A service with a short name is still a target of 44 px.
          className="inline-flex min-h-touch-target min-w-touch-target items-center text-label-default text-text-brand hover:underline"
        >
          <bdi>{service}</bdi>
        </a>
        {appointment.providerName === null ? null : (
          <p className="text-body-small text-text-secondary">
            <bdi>{appointment.providerName}</bdi>
          </p>
        )}
        {practiceName === '' ? null : (
          <p className="text-body-small wrap-anywhere text-text-secondary">
            <bdi>{practiceName}</bdi>
          </p>
        )}
      </div>
      <div>
        <StatusBadge appointment={appointment} />
      </div>
      {appointment.changeable ? (
        <div className="flex flex-wrap items-center gap-2 tablet:justify-end">
          <LinkButton
            variant="outline"
            href={`${detailsHref}/reschedule`}
            aria-label={t('rescheduleLabel', named)}
          >
            {t('reschedule')}
          </LinkButton>
          <CancelButton
            appointment={appointment}
            label={t('cancel')}
            name={t('cancelLabel', named)}
            onChanged={onChanged}
          />
        </div>
      ) : appointment.status === 'BOOKED' && !appointment.started ? (
        // A list knows no phone numbers: the row's details have the number.
        <p className="text-body-small text-text-secondary tablet:text-end">
          <TooLateText />
        </p>
      ) : null}
    </li>
  );
}

function RowList({ children }: { readonly children: ReactNode }): ReactNode {
  return <ul className="rounded-lg border border-border-default bg-bg-surface">{children}</ul>;
}

/** What could not be read, by reason: a person should not take a part for the whole (ADR 0005 §9.1). */
export function MissingPractices({
  missing,
  practices,
  retry,
}: {
  readonly missing: readonly UnavailablePracticeDto[];
  readonly practices: readonly MyPracticeDto[] | undefined;
  readonly retry: ReactNode;
}): ReactNode {
  const t = useTranslations('portal.list');
  const locale = useLocale();
  const named = (reasons: readonly string[]): readonly string[] =>
    missing.filter(({ reason }) => reasons.includes(reason)).map(({ practiceId }) => practiceId);
  const failed = named(['UNAVAILABLE', 'TIMEOUT']);
  const beyond = named(['LIMIT']);
  const names = (ids: readonly string[]): string =>
    practiceNames(ids, practices, locale, t('somePractice'));
  return (
    <>
      {failed.length === 0 ? null : (
        <Alert className="gap-2">
          <AlertDescription>{t('unavailable', { practices: names(failed) })}</AlertDescription>
          {retry}
        </Alert>
      )}
      {beyond.length === 0 ? null : (
        <Alert>
          <AlertDescription>{t('limit', { practices: names(beyond) })}</AlertDescription>
        </Alert>
      )}
    </>
  );
}

/** The ways to a new appointment: each practice has its own page. */
function BookLinks({ practices }: { readonly practices: readonly MyPracticeDto[] }): ReactNode {
  const t = useTranslations('portal.list');
  const locale = useLocale();
  const own = practices.filter(({ capacity }) => capacity === 'PATIENT');
  if (own.length === 0) {
    return <p className="text-body-default text-text-secondary">{t('noPractices')}</p>;
  }
  const known = own.filter(({ slug }) => slug !== null);
  return known.length === 0 ? null : (
    <div className="flex flex-wrap gap-2">
      {known.map(({ id, slug, name }) => (
        <LinkButton
          key={id}
          variant="outline"
          href={bookHref(locale, slug ?? '')}
          // A practice's name can be longer than a phone is wide, in one word too.
          className="max-w-full py-2 text-start wrap-anywhere whitespace-normal"
        >
          {t('bookAt', { practice: nameInSentence(textIn(name, locale), t('somePractice')) })}
        </LinkButton>
      ))}
    </div>
  );
}

function Upcoming({
  practices,
  onChanged,
  children,
}: {
  readonly practices: readonly MyPracticeDto[] | undefined;
  readonly onChanged: OnChanged;
  /** What stands below the list. */
  readonly children: ReactNode;
}): ReactNode {
  const t = useTranslations('portal.list');
  const list = useListMyAppointments({
    query: { retry: retryFanOut, retryDelay: fanOutRetryDelay },
  });
  if (list.isPending) return <Loading>{t('loading')}</Loading>;
  if (list.data === undefined) return <LoadError query={list} onPassed={onChanged} />;
  const { items, unavailablePractices } = list.data;
  // With a practice missing there is no telling: a person must not read that there is nothing.
  const isEmpty = items.length === 0 && unavailablePractices.length === 0;
  return (
    <div className="flex flex-col gap-4">
      {list.isRefetchError ? <StaleNotice query={list} onPassed={onChanged} /> : null}
      <MissingPractices
        missing={unavailablePractices}
        practices={practices}
        retry={<RetryButton query={list} onPassed={onChanged} />}
      />
      {isEmpty ? <p className="text-body-default text-text-primary">{t('empty')}</p> : null}
      {items.length === 0 ? null : (
        <RowList>
          {items.map((appointment) => (
            <AppointmentRow
              key={appointment.id}
              appointment={appointment}
              practice={practiceById(practices, appointment.practiceId)}
              onChanged={onChanged}
            />
          ))}
        </RowList>
      )}
      {children}
    </div>
  );
}

/** One page of a practice's history, and the way to the next. All of it stands in the list. */
function PastPage({
  practice,
  cursor,
  index: pageIndex,
  reveal,
  isLast,
  onMore,
  onReveal,
  onChanged,
}: {
  readonly practice: MyPracticeDto;
  readonly cursor: string | undefined;
  /** Its place among the pages on screen, from 0. */
  readonly index: number;
  /** The appointment a way back comes from (B06): the pages follow until it shows, and it takes the focus. */
  readonly reveal: string | undefined;
  readonly isLast: boolean;
  /** A press on "Show more". */
  readonly onMore: (cursor: string) => void;
  /** The next page, while the appointment of the way back is not on screen yet. */
  readonly onReveal: (cursor: string) => void;
  readonly onChanged: OnChanged;
}): ReactNode {
  const t = useTranslations('portal.list');
  const page = useListMyAppointmentsInPractice(practice.id, {
    scope: 'past',
    ...(cursor === undefined ? {} : { cursor }),
  });
  const next = page.data?.nextCursor ?? null;
  const shows = page.data?.items.some(({ id }) => id === reveal) ?? false;
  const nextToReveal =
    reveal !== undefined && isLast && pageIndex < MAX_REVEAL_PAGES - 1 && next !== null && !shows
      ? next
      : undefined;
  useEffect(() => {
    if (nextToReveal !== undefined) onReveal(nextToReveal);
  }, [nextToReveal, onReveal]);
  if (page.isPending) {
    return (
      <li className="p-4">
        <Loading>{t('loading')}</Loading>
      </li>
    );
  }
  if (page.data === undefined) {
    // After "Show more", whose button went with the focus: another try takes it, and when it passes
    // the first of its rows does.
    const afterMore = cursor !== undefined;
    return (
      <li className="p-4">
        <LoadError
          query={page}
          onPassed={afterMore ? undefined : onChanged}
          focusOnArrival={afterMore}
        />
      </li>
    );
  }
  const { items, nextCursor } = page.data;
  if (items.length === 0 && cursor === undefined) {
    return (
      <li className="p-4">
        <p className="text-body-default text-text-secondary">{t('emptyPast')}</p>
      </li>
    );
  }
  return (
    <>
      {page.isRefetchError ? (
        <li className="p-4">
          <StaleNotice query={page} onPassed={onChanged} />
        </li>
      ) : null}
      {items.map((appointment, index) => (
        <AppointmentRow
          key={appointment.id}
          appointment={appointment}
          practice={practice}
          past
          // The row of the way back; else the first row "Show more" brought.
          focusOnArrival={
            reveal === undefined ? cursor !== undefined && index === 0 : appointment.id === reveal
          }
          onChanged={onChanged}
        />
      ))}
      {isLast && nextCursor !== null ? (
        <li className="p-4">
          <Button
            variant="outline"
            onPress={() => {
              onMore(nextCursor);
            }}
          >
            {t('more')}
          </Button>
        </li>
      ) : null}
    </>
  );
}

/** History stays per practice (ADR 0005 §9.1). */
export function PastOfPractice({
  practice,
  reveal,
  onChanged,
}: {
  readonly practice: MyPracticeDto;
  /** The appointment of this history a way back comes from (B06). */
  readonly reveal?: string | undefined;
  readonly onChanged: OnChanged;
}): ReactNode {
  const t = useTranslations('portal.list');
  const locale = useLocale();
  const [cursors, setCursors] = useState<readonly (string | undefined)[]>([undefined]);
  // Until the person asks for more themselves: then the first row of a new page takes the focus again.
  const [revealing, setRevealing] = useState(reveal);
  const name = textIn(practice.name, locale);
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-heading-h3 wrap-anywhere text-text-primary">
        <bdi>{name === '' ? t('somePractice') : name}</bdi>
      </h2>
      <RowList>
        {cursors.map((cursor, index) => (
          <PastPage
            key={cursor ?? 'first'}
            practice={practice}
            cursor={cursor}
            index={index}
            reveal={revealing}
            isLast={index === cursors.length - 1}
            onMore={(next) => {
              setRevealing(undefined);
              setCursors([...cursors, next]);
            }}
            onReveal={(next) => {
              setCursors((before) => (before.includes(next) ? before : [...before, next]));
            }}
            onChanged={onChanged}
          />
        ))}
      </RowList>
    </section>
  );
}

/** PW7: what is to come across the person's practices, and what has been in each. */
export function AppointmentsPage(): ReactNode {
  const t = useTranslations('portal.list');
  const practices = useListMyPractices();
  // Back from an appointment of the history, to the history, which shows it again (B06).
  const tabInAddress = useFragmentValue('tab') === 'past' ? 'past' : 'upcoming';
  const backFrom = useFragmentValue('practice');
  const cameFrom = useFragmentValue('appointment');
  const reveal = cameFrom !== undefined && isId(cameFrom) ? cameFrom : undefined;
  const [chosenTab, setChosenTab] = useState<Key>();
  const { arrival, said, onChanged } = useArrivals();
  const own = practices.data?.items.filter(({ capacity }) => capacity === 'PATIENT');
  return (
    <>
      <PageHeading key={arrival} title={t('title')} focusOnArrival={arrival > 0} />
      <StatusNote>{said}</StatusNote>
      <Tabs selectedKey={chosenTab ?? tabInAddress} onSelectionChange={setChosenTab}>
        <TabList aria-label={t('title')}>
          <Tab id="upcoming">{t('upcoming')}</Tab>
          <Tab id="past">{t('past')}</Tab>
        </TabList>
        <TabPanel id="upcoming">
          <Upcoming practices={practices.data?.items} onChanged={onChanged}>
            {practices.data !== undefined ? (
              <BookLinks practices={practices.data.items} />
            ) : practices.isPending ? null : (
              <LoadError query={practices} onPassed={onChanged} />
            )}
          </Upcoming>
        </TabPanel>
        <TabPanel id="past">
          <div className="flex flex-col gap-6">
            {practices.isPending ? (
              <Loading>{t('loading')}</Loading>
            ) : own === undefined ? (
              <LoadError query={practices} onPassed={onChanged} />
            ) : own.length === 0 ? (
              <p className="text-body-default text-text-secondary">{t('emptyPast')}</p>
            ) : (
              own.map((practice) => (
                <PastOfPractice
                  key={practice.id}
                  practice={practice}
                  reveal={practice.id === backFrom ? reveal : undefined}
                  onChanged={onChanged}
                />
              ))
            )}
          </div>
        </TabPanel>
      </Tabs>
    </>
  );
}
