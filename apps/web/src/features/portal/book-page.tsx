'use client';

import {
  getGetAvailabilityQueryKey,
  getGetFreeTimesQueryKey,
  isApiError,
  useBookAppointment,
  useGetMe,
  useGetPublicPractice,
  useListMyPractices,
  type AppointmentDto,
  type PublicPracticeDto,
  type PublicServiceDto,
} from '@medibooker/api-client';
import { isolate } from '@medibooker/i18n';
import { bookAppointmentBodyPatientNoteMax } from '@medibooker/api-client/zod';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarPlus, Check } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, LinkButton } from '@/components/ui/button';
import { TextAreaField } from '@/components/ui/text-field';
import { practiceFormat } from '@/lib/format';
import { FormError, PageHeading, useFocusOnArrival } from '../auth/form-parts';
import { ResendButton } from '../auth/resend-button';
import { useWaitOut, WaitNote } from '../auth/wait-out';
import { doctorsOf, fullNameOf } from '../practice-page/practice-view';
import { isChoiceGone, noteToSend, whenParts } from './appointment-view';
import { downloadCalendarFile } from './calendar-file';
import { FreeTimesChooser, type ChosenTime } from './free-times/free-times-picker';
import { bookHref } from './free-times/free-times-view';
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

/** Nothing to book as it stands: why, and the way back to the times. */
function ChooseAgain({
  title,
  body,
  onChooseAgain,
}: {
  readonly title: string;
  readonly body: string;
  readonly onChooseAgain: () => void;
}): ReactNode {
  const t = useTranslations('portal.book');
  return (
    <Alert className="gap-2">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{body}</AlertDescription>
      <Button onPress={onChooseAgain}>{t('back')}</Button>
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
  onChooseAgain,
}: {
  readonly practice: PublicPracticeDto;
  readonly service: PublicServiceDto;
  readonly choice: ChosenTime;
  readonly note: string;
  readonly onNoteChange: (note: string) => void;
  readonly onBooked: (appointment: AppointmentDto) => void;
  readonly onIncomplete: () => void;
  /** Back to the times; `stale` when the chosen one was taken, so that they are asked again. */
  readonly onChooseAgain: (stale: boolean) => void;
}): ReactNode {
  const t = useTranslations('portal');
  const freeTimes = useTranslations('practicePage.freeTimes');
  const locale = useLocale();
  const [key, setKey] = useState(() => crypto.randomUUID());
  const book = useBookAppointment();
  const doctor = practice.team.find(({ id }) => id === choice.providerId);
  const format = practiceFormat(locale, practice);
  const taken = isChoiceGone(book.error);
  const wait = useWaitOut(book.error);
  const noteIsWrong =
    isApiError(book.error) && book.error.fieldErrors.some(({ field }) => field === NOTE_FIELD);
  const noteField = useFocusOnArrival<HTMLTextAreaElement>(noteIsWrong);
  // It takes the place of the button with the focus.
  const otherTime = useFocusOnArrival<HTMLButtonElement>(taken);
  if (choice.providerId !== undefined && doctor === undefined) {
    return (
      <ChooseAgain
        title={t('book.doctorGoneTitle')}
        body={t('book.doctorGoneBody')}
        onChooseAgain={() => {
          onChooseAgain(false);
        }}
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
            <Button
              ref={otherTime}
              onPress={() => {
                onChooseAgain(true);
              }}
            >
              {t('reschedule.other')}
            </Button>
          ) : (
            <Button
              // Also while it waits out a Retry-After: that keeps the focus on it.
              isPending={book.isPending || wait !== undefined}
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
                    onSuccess: onBooked,
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
          <WaitNote seconds={wait} />
          <Button
            variant="outline"
            onPress={() => {
              onChooseAgain(false);
            }}
          >
            <ArrowLeft aria-hidden data-icon="inline-start" className="rtl:rotate-180" />
            {t('book.back')}
          </Button>
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

/**
 * A booking, signed in from its start (B07): a time from the practice's free times, then PW5 and PW6,
 * and the details at the first time. The choice stays in this page and in no storage.
 */
export function BookPage({ slug }: { readonly slug: string }): ReactNode {
  const t = useTranslations('portal.book');
  const freeTimes = useTranslations('practicePage.freeTimes');
  const services = useTranslations('practicePage.services');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const me = useGetMe();
  const practice = useGetPublicPractice(slug);
  const practices = useListMyPractices();
  const [choice, setChoice] = useState<ChosenTime>();
  const [booked, setBooked] = useState<AppointmentDto>();
  const [step, setStep] = useState<Step>('review');
  // Here and in no storage: a step about the person comes between, and a note can say what someone has.
  const [note, setNote] = useState('');
  // Whatever the list says by then: the join has answered, also that the person was there already.
  const [joined, setJoined] = useState(false);
  // A press replaced what had the focus: what comes next takes it, each time (B06).
  const [arrival, setArrival] = useState(0);
  const onPassed = (): void => {
    setArrival((count) => count + 1);
  };
  const moved = arrival > 0;
  const service = practice.data?.services.find(({ id }) => id === choice?.serviceId);
  if (me.isPending || practice.isPending || practices.isPending) {
    return (
      <>
        <PageHeading title={t('title')} />
        <Loading>{t('loading')}</Loading>
      </>
    );
  }
  const heading = <PageHeading key={arrival} title={t('title')} focusOnArrival={moved} />;
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
  if (!me.data.emailVerified) {
    return (
      <>
        {heading}
        <ConfirmEmail email={me.data.email} />
      </>
    );
  }
  // Also a service the practice no longer offers online: its time is chosen again.
  if (choice === undefined || service === undefined) {
    const format = practiceFormat(locale, practice.data);
    const offers = practice.data.services.map(({ id: serviceId, name, durationMinutes }) => {
      const duration = services('duration', {
        count: durationMinutes,
        minutes: format.number(durationMinutes),
      });
      return {
        id: serviceId,
        // Plain for React Aria's typeahead; isolated where it shows (B06).
        label: freeTimes('serviceOption', { name: name ?? '', duration }),
        display: freeTimes('serviceOption', { name: isolate(name ?? ''), duration }),
      };
    });
    const { numberingSystem, hourCycle, timeZone, today, weekStart, team, phone } = practice.data;
    return (
      <>
        <PageHeading
          key={arrival}
          title={t('title')}
          body={t('chooseBody')}
          focusOnArrival={moved}
        />
        {offers.length === 0 ? (
          <p className="text-body-default text-text-primary">{freeTimes('placeholder')}</p>
        ) : (
          <FreeTimesChooser
            practiceId={id}
            locale={locale}
            settings={{ numberingSystem, hourCycle, timeZone }}
            today={today}
            weekStart={weekStart}
            services={offers}
            doctors={doctorsOf(team)}
            phone={phone}
            // This page has no section heading above the chooser.
            dayHeadingLevel="h2"
            action={{
              href: bookHref(locale, slug),
              onChoose: (time, event) => {
                event.preventDefault();
                setChoice(time);
                setNote('');
                onPassed();
              },
            }}
          />
        )}
      </>
    );
  }
  const chooseAgain = (stale: boolean): void => {
    if (stale) {
      // The answers of before would offer the same time again.
      void queryClient.invalidateQueries({ queryKey: getGetAvailabilityQueryKey(id) });
      void queryClient.invalidateQueries({ queryKey: getGetFreeTimesQueryKey(id) });
    }
    setChoice(undefined);
    setStep('review');
    onPassed();
  };
  if (!joined) {
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
              onPassed();
              void queryClient.invalidateQueries();
            }}
          />
        </NarrowForm>
      );
    }
  }
  if (step === 'update-details') {
    return (
      <NarrowForm>
        <UpdateDetailsStep
          practice={practice.data}
          onDone={() => {
            setStep('review');
            onPassed();
          }}
        />
      </NarrowForm>
    );
  }
  return (
    <>
      {heading}
      <Review
        practice={practice.data}
        service={service}
        choice={choice}
        note={note}
        onChooseAgain={chooseAgain}
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
    </>
  );
}
