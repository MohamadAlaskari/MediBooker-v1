'use client';

import type { AppointmentDto } from '@medibooker/api-client';
import { CalendarDays, MapPin, Stethoscope, Syringe, type LucideIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { PracticeFormat } from '@/lib/format';
import { FormError } from '../auth/form-parts';
import { formatOf, phoneInSentence, textIn, whenParts } from './appointment-view';

/** The white card of the portal's screens. */
export function Card({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <section className="rounded-lg border border-border-default bg-bg-surface p-6">
      {children}
    </section>
  );
}

/** A form of a few fields: as wide as on the pages of the account, and not as the whole page. */
export function NarrowForm({ children }: { readonly children: ReactNode }): ReactNode {
  return <div className="mx-auto w-full max-w-[28rem]">{children}</div>;
}

/** Text on what a page is waiting for, for a screen reader too. */
export function Loading({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <p role="status" className="text-body-default text-text-secondary">
      {children}
    </p>
  );
}

/**
 * For a page whose rows and cards can go with the focus on them, after a cancel or another try: its
 * heading takes the focus, each time, with `arrival` as its key. What there is to say stays said.
 */
export function useArrivals(): {
  readonly arrival: number;
  readonly said: string | undefined;
  readonly onChanged: (news?: string) => void;
} {
  const [arrival, setArrival] = useState(0);
  const [said, setSaid] = useState<string>();
  return {
    arrival,
    said,
    onChanged: (news) => {
      if (news !== undefined) setSaid(news);
      setArrival((count) => count + 1);
    },
  };
}

/**
 * What has just happened, for a screen reader too. On the page before it has anything to say: a live
 * region that arrives together with its text is often not read out.
 */
export function StatusNote({ children }: { readonly children: string | undefined }): ReactNode {
  return (
    <div role="status">
      {children === undefined ? null : (
        <p className="mb-4 text-body-default text-text-success">{children}</p>
      )}
    </div>
  );
}

/** A read of the API, as much of it as another try needs. */
interface ReadQuery {
  readonly error: unknown;
  readonly isFetching: boolean;
  readonly refetch: () => Promise<{ readonly isSuccess: boolean }>;
}

interface RetryProps {
  readonly query: ReadQuery;
  /** It passed, and this button and the focus on it are about to go: the page knows where to. */
  readonly onPassed?: (() => void) | undefined;
}

export function RetryButton({ query, onPassed }: RetryProps): ReactNode {
  const t = useTranslations('portal.list');
  return (
    <Button
      variant="outline"
      isPending={query.isFetching}
      onPress={() => {
        void query.refetch().then(({ isSuccess }) => {
          if (isSuccess) onPassed?.();
        });
      }}
    >
      {t('retry')}
    </Button>
  );
}

/** What a page needs could not be read: what the API said, and another try. */
export function LoadError({ query, onPassed }: RetryProps): ReactNode {
  return (
    <div className="flex flex-col gap-2">
      <FormError error={query.error} />
      <RetryButton query={query} onPassed={onPassed} />
    </div>
  );
}

/**
 * The last look for changes failed, so the page still shows what it knew before: a row that was
 * cancelled a moment ago, for instance. It says so.
 */
export function StaleNotice({ query, onPassed }: RetryProps): ReactNode {
  const t = useTranslations('portal.list');
  return (
    <Alert role="alert" className="gap-2">
      <AlertDescription>{t('stale')}</AlertDescription>
      <RetryButton query={query} onPassed={onPassed} />
    </Alert>
  );
}

export function StatusBadge({
  appointment,
}: {
  readonly appointment: Pick<AppointmentDto, 'status' | 'started'>;
}): ReactNode {
  const t = useTranslations('portal.status');
  const { status, started } = appointment;
  // Until staff set a status (M05), only the API's clock says that a booked appointment has begun.
  const booked = status === 'BOOKED' && !started;
  return (
    <Badge variant={booked ? 'success' : 'neutral'}>
      {t(status === 'BOOKED' && started ? 'STARTED' : status)}
    </Badge>
  );
}

interface FactProps {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly children: ReactNode;
}

/** One line of what is known about an appointment (PW5, PW8). */
function Fact({ icon: Icon, label, children }: FactProps): ReactNode {
  return (
    <li className="flex items-start gap-3 border-b border-border-subtle py-3 last:border-b-0">
      <span
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-md bg-bg-subtle text-icon-secondary"
      >
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="text-body-default wrap-anywhere text-text-primary">{children}</p>
        <p className="text-body-small text-text-secondary">{label}</p>
      </div>
    </li>
  );
}

interface FactsProps {
  readonly service: string;
  readonly when: string;
  readonly doctor: string | null;
  /** Empty when the name is not known: a label alone says nothing. */
  readonly practice: string;
  readonly address?: string | null | undefined;
}

export function Facts({ service, when, doctor, practice, address }: FactsProps): ReactNode {
  const t = useTranslations('portal.appointment');
  const hasAddress = address !== null && address !== undefined;
  return (
    <ul>
      <Fact icon={Syringe} label={t('service')}>
        <bdi>{service}</bdi>
      </Fact>
      <Fact icon={CalendarDays} label={t('date')}>
        {when}
      </Fact>
      <Fact icon={Stethoscope} label={t('doctor')}>
        {doctor === null ? t('noDoctor') : <bdi>{doctor}</bdi>}
      </Fact>
      {practice === '' && !hasAddress ? null : (
        <Fact icon={MapPin} label={t('practice')}>
          {practice === '' ? null : <bdi>{practice}</bdi>}
          {hasAddress ? (
            <span className="block text-body-small text-text-secondary">
              <bdi>{address}</bdi>
            </span>
          ) : null}
        </Fact>
      )}
    </ul>
  );
}

/** What is known about an appointment, read from its answer. */
export function AppointmentFacts({
  appointment,
  practice,
  address,
}: {
  readonly appointment: AppointmentDto;
  readonly practice: string;
  readonly address?: string | null;
}): ReactNode {
  const t = useTranslations('portal.appointment');
  const locale = useLocale();
  const format = formatOf(appointment, locale);
  return (
    <Facts
      service={textIn(appointment.serviceName, locale)}
      when={t('when', whenParts(format, appointment.startsAt))}
      doctor={appointment.providerName}
      practice={practice}
      address={address}
    />
  );
}

/** Whom to call: after the deadline sentence, or now, when it has passed. */
function CallSentence({
  phone,
  now,
}: {
  readonly phone: string | null | undefined;
  readonly now: boolean;
}): ReactNode {
  const t = useTranslations('portal.appointment');
  if (phone === null || phone === undefined) return t(now ? 'callNowOnly' : 'callOnly');
  return t(now ? 'callNow' : 'call', { phone: phoneInSentence(phone) });
}

/** BR-04 in words: until when, and what is left after that. */
export function ChangeNote({
  hours,
  phone,
  format,
}: {
  readonly hours: number;
  readonly phone: string | null | undefined;
  /** The digits of the practice: a plural's own number would take the language's. */
  readonly format: PracticeFormat;
}): ReactNode {
  const t = useTranslations('portal.appointment');
  return (
    <Alert>
      <AlertDescription>
        {t('deadline', { count: hours, hours: format.number(hours) })}{' '}
        <CallSentence phone={phone} now={false} />
      </AlertDescription>
    </Alert>
  );
}

/** Past the deadline, and not yet begun: what is left to do. Without a number where none is known. */
export function TooLateText({ phone }: { readonly phone?: string | null | undefined }): ReactNode {
  const t = useTranslations('portal.appointment');
  return (
    <>
      {t('tooLate')} <CallSentence phone={phone} now />
    </>
  );
}

export function TooLateNote({ phone }: { readonly phone: string | null | undefined }): ReactNode {
  return (
    <Alert>
      <AlertDescription>
        <TooLateText phone={phone} />
      </AlertDescription>
    </Alert>
  );
}
