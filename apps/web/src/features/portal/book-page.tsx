'use client';

import {
  isApiError,
  useBookAppointment,
  useGetMe,
  useGetPublicPractice,
  useListMyPractices,
  type AppointmentDto,
  type PublicPracticeDto,
  type PublicServiceDto,
} from '@medibooker/api-client';
import { bookAppointmentBodyPatientNoteMax } from '@medibooker/api-client/zod';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarPlus, Check } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, LinkButton } from '@/components/ui/button';
import { TextAreaField } from '@/components/ui/text-field';
import { practiceFormat } from '@/lib/format';
import { FormError, PageHeading, useFocusOnArrival } from '../auth/form-parts';
import { ResendButton } from '../auth/resend-button';
import { fullNameOf } from '../practice-page/practice-view';
import { isChoiceGone, noteToSend, whenParts } from './appointment-view';
import { clearChoice, parseChoice, readRawChoice, type BookingChoice } from './booking-choice';
import { downloadCalendarFile } from './calendar-file';
import {
  AppointmentFacts,
  Card,
  ChangeNote,
  Facts,
  LoadError,
  Loading,
  NarrowForm,
} from './portal-parts';
import { JoinStep, UpdateDetailsStep } from './practice-details-steps';

const NOTE_FIELD = 'patientNote';

function noChanges(): () => void {
  return () => undefined;
}

/** What was chosen on the practice's page, in this tab. */
function useBookingChoice(slug: string): BookingChoice | undefined {
  const raw = useSyncExternalStore(noChanges, readRawChoice, () => null);
  const choice = useMemo(() => parseChoice(raw, slug), [raw, slug]);
  // What is too old or for another practice helps nobody here, and need not wait for the tab to close.
  useEffect(() => {
    if (raw !== null && choice === undefined) clearChoice();
  }, [raw, choice]);
  return choice;
}

/** Nothing to book as it stands: why, and the way to the practice's times. */
function ChooseAgain({
  timesHref,
  title,
  body,
}: {
  readonly timesHref: string;
  readonly title: string;
  readonly body: string;
}): ReactNode {
  const t = useTranslations('portal.book');
  return (
    <Alert className="gap-2">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{body}</AlertDescription>
      <LinkButton href={timesHref}>{t('seeTimes')}</LinkButton>
    </Alert>
  );
}

function ConfirmEmail({ email }: { readonly email: string }): ReactNode {
  const t = useTranslations('portal.book');
  return (
    <Alert className="gap-2">
      <AlertTitle>{t('confirmEmailTitle')}</AlertTitle>
      <AlertDescription>{t('confirmEmailBody')}</AlertDescription>
      <ResendButton email={email} label={t('resend')} sentLabel={t('resent')} />
    </Alert>
  );
}

/** PW6. Names no service in the calendar: see calendar-file.ts. */
export function Booked({
  appointment,
  practice,
}: {
  readonly appointment: AppointmentDto;
  readonly practice: PublicPracticeDto;
}): ReactNode {
  const t = useTranslations('portal');
  const locale = useLocale();
  const heading = useFocusOnArrival();
  const name = practice.name ?? '';
  return (
    <div className="grid grid-cols-1 gap-6 desktop:grid-cols-3">
      <div className="flex flex-col gap-4 desktop:col-span-2">
        <h1 ref={heading} tabIndex={-1} className="text-heading-h1 text-text-primary outline-none">
          {t('book.bookedTitle')}
        </h1>
        {/* A time close by can already be past the practice's deadline, and only the API knows. */}
        <p className="text-body-default text-text-secondary">
          {t(appointment.changeable ? 'book.bookedBody' : 'book.bookedBodyCall')}
        </p>
        <Card>
          <AppointmentFacts appointment={appointment} practice={name} address={practice.address} />
        </Card>
      </div>
      <div className="flex flex-col gap-2">
        <Button
          onPress={() => {
            downloadCalendarFile(
              {
                id: appointment.id,
                startsAt: appointment.startsAt,
                endsAt: appointment.endsAt,
                bookedAt: appointment.bookedAt,
                summary: t('book.calendarSummary', {
                  practice: name === '' ? t('list.somePractice') : name,
                }),
                location: practice.address,
              },
              t('book.calendarFileName'),
            );
          }}
        >
          <CalendarPlus aria-hidden data-icon="inline-start" />
          {t('book.addToCalendar')}
        </Button>
        <LinkButton variant="outline" href={`/${locale}/appointments`}>
          {t('book.toAppointments')}
        </LinkButton>
      </div>
    </div>
  );
}

/** PW5: what will be booked, and the last word. The key lasts as long as the attempt does. */
export function Review({
  practice,
  service,
  choice,
  note,
  onNoteChange,
  onBooked,
  onIncomplete,
  timesHref,
}: {
  readonly practice: PublicPracticeDto;
  readonly service: PublicServiceDto;
  readonly choice: BookingChoice;
  readonly note: string;
  readonly onNoteChange: (note: string) => void;
  readonly onBooked: (appointment: AppointmentDto) => void;
  readonly onIncomplete: () => void;
  /** The practice's free times, where its page is: the root of an installation (ADR 0016). */
  readonly timesHref: string;
}): ReactNode {
  const t = useTranslations('portal');
  const freeTimes = useTranslations('practicePage.freeTimes');
  const locale = useLocale();
  const [key, setKey] = useState(() => crypto.randomUUID());
  const book = useBookAppointment();
  const doctor = practice.team.find(({ id }) => id === choice.providerId);
  const format = practiceFormat(locale, practice);
  const taken = isChoiceGone(book.error);
  const noteIsWrong =
    isApiError(book.error) && book.error.fieldErrors.some(({ field }) => field === NOTE_FIELD);
  const noteField = useFocusOnArrival<HTMLTextAreaElement>(noteIsWrong);
  // It takes the place of the button with the focus.
  const otherTime = useFocusOnArrival<HTMLAnchorElement>(taken);
  if (choice.providerId !== undefined && doctor === undefined) {
    return (
      <ChooseAgain
        timesHref={timesHref}
        title={t('book.doctorGoneTitle')}
        body={t('book.doctorGoneBody')}
      />
    );
  }
  return (
    <div className="grid grid-cols-1 gap-6 desktop:grid-cols-3">
      <div className="flex flex-col gap-4 desktop:col-span-2">
        <Card>
          <h2 className="text-heading-h3 text-text-primary">{t('book.reviewTitle')}</h2>
          <Facts
            service={service.name ?? ''}
            when={t('appointment.when', whenParts(format, choice.startsAt))}
            doctor={doctor === undefined ? freeTimes('anyDoctor') : fullNameOf(doctor)}
            practice={practice.name ?? ''}
            address={practice.address}
          />
          {service.referralRequired ? (
            <p className="text-body-default text-text-warning">{t('book.referral')}</p>
          ) : null}
        </Card>
        <TextAreaField
          label={t('book.noteLabel')}
          hint={t('book.noteHint')}
          maxLength={bookAppointmentBodyPatientNoteMax}
          value={note}
          inputRef={noteField}
          onChange={(value) => {
            onNoteChange(value);
            // Another request: the key of the one before would answer that it was used differently.
            setKey(crypto.randomUUID());
          }}
          error={noteIsWrong ? t('book.noteRefused') : undefined}
        />
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <FormError error={book.error} fields={[NOTE_FIELD]} notFound={t('book.timeGone')} />
          {taken ? (
            <LinkButton ref={otherTime} href={timesHref}>
              {t('reschedule.other')}
            </LinkButton>
          ) : (
            <Button
              isPending={book.isPending}
              onPress={() => {
                const patientNote = noteToSend(note);
                book.mutate(
                  {
                    practiceId: practice.id,
                    data: {
                      serviceId: choice.serviceId,
                      startsAt: choice.startsAt,
                      ...(choice.providerId === undefined ? {} : { providerId: choice.providerId }),
                      ...(patientNote === undefined ? {} : { patientNote }),
                    },
                    headers: { 'Idempotency-Key': key },
                  },
                  {
                    onSuccess: (appointment) => {
                      clearChoice();
                      onBooked(appointment);
                    },
                    onError: (failure) => {
                      if (failure.code === 'PATIENT_PROFILE_INCOMPLETE') onIncomplete();
                    },
                  },
                );
              }}
            >
              <Check aria-hidden data-icon="inline-start" />
              {t('book.confirm')}
            </Button>
          )}
          <LinkButton variant="outline" href={timesHref}>
            <ArrowLeft aria-hidden data-icon="inline-start" className="rtl:rotate-180" />
            {t('book.back')}
          </LinkButton>
        </div>
        <ChangeNote
          hours={practice.cancellationDeadlineHours}
          phone={practice.phone}
          format={format}
        />
      </div>
    </div>
  );
}

type Step = 'review' | 'update-details';

/** The booking of a time chosen on a practice's page: PW5 and PW6, and the details at the first time. */
export function BookPage({
  slug,
  practiceHref,
}: {
  readonly slug: string;
  /** Where the practice's page is, which only the server knows (ADR 0016). */
  readonly practiceHref: string;
}): ReactNode {
  const timesHref = `${practiceHref}#free-times`;
  const t = useTranslations('portal.book');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const me = useGetMe();
  const practice = useGetPublicPractice(slug);
  const practices = useListMyPractices();
  const choice = useBookingChoice(slug);
  const [booked, setBooked] = useState<AppointmentDto>();
  const [step, setStep] = useState<Step>('review');
  // Here and in no storage: a step about the person comes between, and a note can say what someone has.
  const [note, setNote] = useState('');
  // Whatever the list says by then: the join has answered, also that the person was there already.
  const [joined, setJoined] = useState(false);
  // A press replaced what had the focus: what comes next takes it.
  const [moved, setMoved] = useState(false);
  const onPassed = (): void => {
    setMoved(true);
  };
  const service = practice.data?.services.find(({ id }) => id === choice?.serviceId);
  const serviceGone = choice !== undefined && practice.data !== undefined && service === undefined;
  useEffect(() => {
    if (serviceGone) clearChoice();
  }, [serviceGone]);
  if (me.isPending || practice.isPending || practices.isPending) {
    return (
      <>
        <PageHeading title={t('title')} />
        <Loading>{t('loading')}</Loading>
      </>
    );
  }
  const heading = <PageHeading title={t('title')} focusOnArrival={moved} />;
  if (me.data === undefined) {
    return (
      <>
        {heading}
        <LoadError query={me} onPassed={onPassed} />
      </>
    );
  }
  if (practice.data === undefined) {
    return (
      <>
        {heading}
        {isApiError(practice.error) && practice.error.status === 404 ? (
          <div className="flex flex-col items-start gap-4">
            <p className="text-body-default text-text-primary">{t('notFound')}</p>
            <LinkButton variant="outline" href={`/${locale}/appointments`}>
              {t('toAppointments')}
            </LinkButton>
          </div>
        ) : (
          <LoadError query={practice} onPassed={onPassed} />
        )}
      </>
    );
  }
  if (booked !== undefined) return <Booked appointment={booked} practice={practice.data} />;
  const { id } = practice.data;
  const canBook = me.data.emailVerified && choice !== undefined && service !== undefined;
  if (canBook && !joined) {
    // Join or review only from a list that loaded: a failure says nothing about who is a patient.
    if (practices.data === undefined) {
      return (
        <>
          {heading}
          <LoadError query={practices} onPassed={onPassed} />
        </>
      );
    }
    const known = practices.data.items.some(
      (item) => item.id === id && item.capacity === 'PATIENT',
    );
    // The steps about the person have their own heading: a page has one.
    if (!known) {
      return (
        <NarrowForm>
          <JoinStep
            practice={practice.data}
            focusOnArrival={moved}
            onDone={() => {
              setJoined(true);
              setMoved(true);
              void queryClient.invalidateQueries();
            }}
          />
        </NarrowForm>
      );
    }
  }
  if (canBook && step === 'update-details') {
    return (
      <NarrowForm>
        <UpdateDetailsStep
          practice={practice.data}
          onDone={() => {
            setStep('review');
            setMoved(true);
          }}
        />
      </NarrowForm>
    );
  }
  return (
    <>
      {heading}
      {!me.data.emailVerified ? (
        <ConfirmEmail email={me.data.email} />
      ) : !canBook ? (
        <ChooseAgain timesHref={timesHref} title={t('noChoiceTitle')} body={t('noChoiceBody')} />
      ) : (
        <Review
          practice={practice.data}
          service={service}
          choice={choice}
          note={note}
          timesHref={timesHref}
          onNoteChange={setNote}
          onBooked={(appointment) => {
            // PW6 stays. A reload or the language switch now shows this appointment, and not a
            // booking page without a choice, which could read as if nothing had been booked.
            window.history.replaceState(
              null,
              '',
              `/${locale}/appointments/${appointment.practiceId}/${appointment.id}`,
            );
            setBooked(appointment);
          }}
          onIncomplete={() => {
            setStep('update-details');
            // The answer says that what this page knows of the practice's rules is out of date, and
            // the form must ask for what the practice asks now.
            void practice.refetch();
          }}
        />
      )}
    </>
  );
}
