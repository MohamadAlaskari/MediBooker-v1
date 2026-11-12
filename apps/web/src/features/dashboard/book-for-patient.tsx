'use client';

import {
  isApiError,
  useAddDeskPatient,
  useBookDeskAppointment,
  useGetDeskAvailability,
  useGetDeskCatalog,
  useGetDeskFreeTimes,
  useSearchDeskPatients,
  type DeskCatalogDto,
  type DeskPatientRowDto,
} from '@medibooker/api-client';
import { isolate } from '@medibooker/i18n';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, ChevronLeft, ChevronRight, UserPlus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { TextAreaField, TextField } from '@/components/ui/text-field';
import type { PracticeFormat } from '@/lib/format';
import { cn } from '@/lib/utils';
import { FormError } from '../auth/form-parts';
import { ROVING_GROUP, ROVING_ITEM, useRovingFocus } from '../portal/free-times/use-roving-focus';
import { noteToSend, textIn } from '../portal/appointment-view';
import { useDesk } from './desk-context';
import { initialsOf } from './desk-view';
import { useSettled } from './pager';
import {
  asksOf,
  Choice,
  LABEL,
  PATIENT_FIELDS,
  type PatientField,
  PatientFields,
  type PatientValues,
} from './patient-fields';
import { isDeskQueryOf } from './use-desk-change';

/** A patient the dialog books for: one found, one added, or the one of an open record (W8). */
export type BookPatient = Pick<
  DeskPatientRowDto,
  'id' | 'firstName' | 'lastName' | 'dateOfBirth' | 'age'
>;

const ANY = 'any';
const DAYS_SHOWN = 7;
const MATCHES_SHOWN = 5;
const MIN_QUERY_LENGTH = 2;
/** As long as the API takes a reason of the team (`MAX_NOTE_LENGTH`). */
const MAX_REASON_LENGTH = 500;
const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus';
/** What the dialog says in its own words: the API's texts of these codes speak to a patient. */
const OWN_ERRORS = [
  'SLOT_NOT_AVAILABLE',
  'BOOKING_LIMIT_REACHED',
  'APPOINTMENT_OVERLAP',
  'OUTSIDE_BOOKING_WINDOW',
  'SERVICE_NOT_BOOKABLE',
  'NOT_FOUND',
] as const;
function nameOf(patient: Pick<BookPatient, 'firstName' | 'lastName'>): string {
  return isolate(`${patient.firstName} ${patient.lastName}`);
}

/** The error of a booking, in the team's words where the dialog has them. */
function BookingError({ error }: { readonly error: unknown }): ReactNode {
  const t = useTranslations('dashboard.book.errors');
  if (!isApiError(error)) return <FormError error={error} />;
  const code = OWN_ERRORS.find((own) => own === error.code);
  if (code === undefined) return <FormError error={error} />;
  return (
    <Alert role="alert" className="bg-bg-danger-subtle">
      <AlertDescription className="text-text-danger">
        {t(code, (error.params ?? {}) as Record<string, string | number>)}
      </AlertDescription>
    </Alert>
  );
}

/** A patient as a line of the dialog: initials, name, and the date of birth with the age. */
function PatientLine({
  patient,
  format,
}: {
  readonly patient: BookPatient;
  readonly format: PracticeFormat;
}): ReactNode {
  const t = useTranslations('dashboard.patients');
  const locale = useLocale();
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-bg-brand-subtle text-label-default text-text-brand"
      >
        {initialsOf(patient.firstName, patient.lastName, locale)}
      </span>
      <span className="flex min-w-0 flex-col text-start">
        <span className="truncate text-label-large text-text-primary">{nameOf(patient)}</span>
        <span className="text-body-small text-text-secondary">
          {t('born', { date: format.calendarDate(patient.dateOfBirth), age: patient.age })}
        </span>
      </span>
    </span>
  );
}

/** W8's search in small: up to five patients, one of whom the team chooses. */
function FindPatient({
  format,
  onChoose,
  onNew,
}: {
  readonly format: PracticeFormat;
  readonly onChoose: (patient: BookPatient) => void;
  readonly onNew: () => void;
}): ReactNode {
  const t = useTranslations('dashboard.book');
  const { practiceId } = useDesk();
  const [text, setText] = useState('');
  const query = useSettled(text.trim());
  const asks = query.length >= MIN_QUERY_LENGTH;
  // In the body of a POST, never in a URL: what is typed here is personal data.
  const found = useSearchDeskPatients(
    practiceId,
    { query, limit: MATCHES_SHOWN },
    // Gone from the client's cache as soon as no one shows it: a search names a person.
    { query: { enabled: asks, retry: false, gcTime: 0 } },
  );
  const onKeyDown = useRovingFocus();
  const matches = asks ? (found.data?.items ?? []) : [];
  return (
    <div className="flex flex-col gap-3">
      <TextField
        label={t('search')}
        hint={t('searchHint')}
        value={text}
        onChange={setText}
        autoComplete="off"
      />
      {asks && found.isPending ? (
        <p role="status" className="text-body-small text-text-secondary">
          {t('searching')}
        </p>
      ) : null}
      <FormError error={found.error} />
      {matches.length > 0 ? (
        <ul aria-label={t('results')} className="flex flex-col gap-2" {...ROVING_GROUP}>
          {matches.map((patient, index) => (
            <li key={patient.id}>
              <button
                type="button"
                tabIndex={index === 0 ? 0 : -1}
                onKeyDown={onKeyDown}
                onClick={() => {
                  onChoose(patient);
                }}
                className={cn(
                  'flex min-h-touch-target w-full items-center rounded-md border border-border-default bg-bg-surface px-4 py-2 hover:bg-bg-subtle',
                  FOCUS_RING,
                )}
                {...ROVING_ITEM}
              >
                <PatientLine patient={patient} format={format} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {asks && found.isSuccess && matches.length === 0 ? (
        <p role="status" className="text-body-default text-text-secondary">
          {t('noResults')}
        </p>
      ) : null}
      <div>
        <Button variant="outline" onPress={onNew}>
          <UserPlus aria-hidden data-icon="inline-start" />
          {t('newPatient')}
        </Button>
      </div>
    </div>
  );
}

/** W7 "Add patient": a person without an account, with what the practice asks (BR-10). */
function NewPatient({
  insurance,
  onAdded,
  onBack,
}: {
  readonly insurance: DeskCatalogDto['insurance'];
  readonly onAdded: (patient: BookPatient) => void;
  readonly onBack: () => void;
}): ReactNode {
  const t = useTranslations('dashboard.book');
  const { practiceId } = useDesk();
  // Its request holds the insurance number: kept no longer than the dialog shows it.
  const add = useAddDeskPatient({ mutation: { gcTime: 0 } });
  const [values, setValues] = useState<PatientValues>({
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    phone: '',
    insuranceType: insurance.types.length === 1 ? (insurance.types[0] ?? '') : '',
    insuranceProvider: '',
    insuranceNumber: '',
  });
  const type = values.insuranceType;
  const asks = asksOf(insurance, type);
  const errorOf = (field: PatientField): string | undefined => {
    if (!isApiError(add.error)) return undefined;
    const problem = add.error.fieldErrors.find((fieldError) => fieldError.field === field);
    if (problem === undefined) return undefined;
    return problem.code === 'REQUIRED' ? t('required') : t('invalid');
  };
  const set = (field: PatientField) => (value: string) => {
    setValues((before) => ({ ...before, [field]: value }));
    // Other details are another question: "add anyway" must not confirm them unseen.
    if (add.error !== null) add.reset();
  };
  const filled = (value: string): string | undefined => (value.trim() === '' ? undefined : value);
  const mayExist = isApiError(add.error) && add.error.code === 'PATIENT_MAY_EXIST';
  const submit = (): void => {
    add.mutate(
      {
        practiceId,
        data: {
          // Only after the team saw that the person may be there already, and chose to go on.
          ...(mayExist ? { confirmDuplicate: true } : {}),
          firstName: filled(values.firstName),
          lastName: filled(values.lastName),
          dateOfBirth: filled(values.dateOfBirth),
          insuranceType: filled(type) as (typeof insurance.types)[number] | undefined,
          ...(filled(values.phone) === undefined ? {} : { phone: values.phone.trim() }),
          ...(asks.provider && filled(values.insuranceProvider) !== undefined
            ? { insuranceProvider: values.insuranceProvider.trim() }
            : {}),
          ...(asks.number && filled(values.insuranceNumber) !== undefined
            ? { insuranceNumber: values.insuranceNumber.trim() }
            : {}),
        },
      },
      { onSuccess: onAdded },
    );
  };
  // Enter in a field adds the patient, as a form would, instead of sending the booking.
  const enterAdds = {
    onKeyDown: (event: { readonly key: string; readonly preventDefault: () => void }) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      submit();
    },
  };
  // Not a form of its own: it sits inside the booking's form, and HTML has no form in a form.
  return (
    <div
      role="group"
      aria-label={t('newPatientTitle')}
      className="flex flex-col gap-4 rounded-lg border border-border-default p-4"
    >
      <div>
        <p className="text-label-large text-text-primary">{t('newPatientTitle')}</p>
        <p className="text-body-small text-text-secondary">{t('newPatientHint')}</p>
      </div>
      {mayExist ? (
        <Alert role="alert" className="bg-bg-danger-subtle">
          <AlertDescription className="text-text-danger">
            {t('errors.PATIENT_MAY_EXIST')}
          </AlertDescription>
        </Alert>
      ) : (
        <FormError error={add.error} fields={[...PATIENT_FIELDS]} />
      )}
      <PatientFields
        insurance={insurance}
        values={values}
        onChange={set}
        errorOf={errorOf}
        fieldProps={enterAdds}
      />
      <div className="flex flex-wrap gap-3">
        <Button isPending={add.isPending} onPress={submit}>
          {mayExist ? t('addAnyway') : t('addPatient')}
        </Button>
        <Button variant="outline" isDisabled={add.isPending} onPress={onBack}>
          {t('backToSearch')}
        </Button>
      </div>
    </div>
  );
}

/** A week of the 42 days the API answers, with the days that have a free time to choose. */
function Days({
  days,
  selected,
  format,
  onSelect,
}: {
  readonly days: readonly { readonly date: string; readonly hasFreeTimes: boolean }[];
  readonly selected: string | undefined;
  readonly format: PracticeFormat;
  readonly onSelect: (date: string) => void;
}): ReactNode {
  const t = useTranslations('dashboard.book');
  const [start, setStart] = useState(0);
  const onKeyDown = useRovingFocus({ selectOnMove: true });
  const shown = days.slice(start, start + DAYS_SHOWN);
  const firstFree = shown.find(({ hasFreeTimes }) => hasFreeTimes)?.date;
  const tabStop =
    selected !== undefined && shown.some(({ date }) => date === selected) ? selected : firstFree;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className={LABEL}>{t('days')}</p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label={t('earlierDays')}
            isDisabled={start === 0}
            onPress={() => {
              setStart(Math.max(0, start - DAYS_SHOWN));
            }}
          >
            <ChevronLeft aria-hidden className="rtl:-scale-x-100" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={t('laterDays')}
            isDisabled={start + DAYS_SHOWN >= days.length}
            onPress={() => {
              setStart(start + DAYS_SHOWN);
            }}
          >
            <ChevronRight aria-hidden className="rtl:-scale-x-100" />
          </Button>
        </div>
      </div>
      <div
        role="radiogroup"
        aria-label={t('days')}
        className="grid grid-cols-[repeat(7,minmax(var(--spacing-touch-target),1fr))] gap-1 overflow-x-auto pb-1"
        {...ROVING_GROUP}
      >
        {shown.map(({ date, hasFreeTimes }) => {
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
                disabled={!hasFreeTimes}
                tabIndex={date === tabStop ? 0 : -1}
                onKeyDown={onKeyDown}
                onClick={() => {
                  onSelect(date);
                }}
                className={cn(
                  'flex size-touch-target flex-col items-center justify-center gap-1 rounded-full text-label-default',
                  isSelected && 'bg-bg-brand text-text-on-brand',
                  !isSelected && hasFreeTimes && 'text-text-primary hover:bg-bg-subtle',
                  !hasFreeTimes && 'text-text-disabled',
                  FOCUS_RING,
                )}
                {...ROVING_ITEM}
              >
                <span className="tabular-times">{format.dayOfMonth(date)}</span>
                {hasFreeTimes ? (
                  <span aria-hidden className="size-1 rounded-full bg-current" />
                ) : null}
              </button>
            </div>
          );
        })}
      </div>
      {shown.every(({ hasFreeTimes }) => !hasFreeTimes) ? (
        <p className="text-body-small text-text-secondary">{t('noDays')}</p>
      ) : null}
    </div>
  );
}

/** The free times of the chosen day, one of which the team chooses. */
function Times({
  times,
  selected,
  day,
  format,
  onSelect,
}: {
  readonly times: readonly { readonly startsAt: string }[];
  readonly selected: string | undefined;
  readonly day: string;
  readonly format: PracticeFormat;
  readonly onSelect: (startsAt: string) => void;
}): ReactNode {
  const t = useTranslations('dashboard.book');
  const onKeyDown = useRovingFocus({ selectOnMove: true });
  const dayLabel = format.dayLong(day);
  if (times.length === 0) {
    return <p className="text-body-default text-text-secondary">{t('noTimes')}</p>;
  }
  const tabStop = selected ?? times[0]?.startsAt;
  return (
    <div
      role="radiogroup"
      aria-label={t('times', { day: dayLabel })}
      className="grid grid-cols-3 gap-2 tablet:grid-cols-4"
      {...ROVING_GROUP}
    >
      {times.map(({ startsAt }) => {
        const isSelected = startsAt === selected;
        const time = format.instantTime(startsAt);
        return (
          <button
            key={startsAt}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={t('timeLabel', { time, day: dayLabel })}
            tabIndex={startsAt === tabStop ? 0 : -1}
            onKeyDown={onKeyDown}
            onClick={() => {
              onSelect(startsAt);
            }}
            className={cn(
              'tabular-times flex min-h-touch-target items-center justify-center rounded-md border text-label-large',
              isSelected
                ? 'border-border-brand bg-bg-brand text-text-on-brand'
                : 'border-border-brand bg-bg-surface text-text-brand hover:bg-bg-brand-subtle',
              FOCUS_RING,
            )}
            {...ROVING_ITEM}
          >
            {time}
          </button>
        );
      })}
    </div>
  );
}

interface BookingFormProps {
  readonly patient: BookPatient | undefined;
  readonly format: PracticeFormat;
  readonly booking: ReturnType<typeof useBookDeskAppointment>;
  readonly onBooked: (news: string) => void;
  readonly onCancel: () => void;
}

/** The dialog's steps on one page, as in Figma: patient, service and doctor, day, time, summary. */
function BookingForm({
  patient: given,
  format,
  booking,
  onBooked,
  onCancel,
}: BookingFormProps): ReactNode {
  const t = useTranslations('dashboard.book');
  const locale = useLocale();
  const { practiceId } = useDesk();
  const [patient, setPatient] = useState<BookPatient | undefined>(given);
  const [adding, setAdding] = useState(false);
  const [serviceId, setServiceId] = useState<string | undefined>(undefined);
  const [providerId, setProviderId] = useState(ANY);
  const [date, setDate] = useState<string | undefined>(undefined);
  const [startsAt, setStartsAt] = useState<string | undefined>(undefined);
  // A new attempt gets a new key; the same attempt sent again gets the first answer (BR-01).
  const [key, setKey] = useState(() => crypto.randomUUID());
  // BR-02: past the practice's limit the team books only with a reason, which the practice keeps.
  const [overriding, setOverriding] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonMissing, setReasonMissing] = useState(false);
  const catalog = useGetDeskCatalog(practiceId, { query: { retry: false } });
  const doctor = providerId === ANY ? {} : { providerId };
  const ready = patient !== undefined && serviceId !== undefined;
  const availability = useGetDeskAvailability(
    practiceId,
    { serviceId: serviceId ?? '', ...doctor },
    { query: { enabled: ready, retry: false } },
  );
  const freeTimes = useGetDeskFreeTimes(
    practiceId,
    { serviceId: serviceId ?? '', date: date ?? '', ...doctor },
    { query: { enabled: ready && date !== undefined, retry: false } },
  );
  const services = (catalog.data?.services ?? []).filter(({ active }) => active);
  const service = services.find(({ id }) => id === serviceId);
  const providers = catalog.data?.providers ?? [];
  const doctorName =
    providerId === ANY
      ? t('anyDoctor')
      : (providers.find(({ id }) => id === providerId)?.name ?? '');
  const anew = (): void => {
    setStartsAt(undefined);
    setKey(crypto.randomUUID());
    setOverriding(false);
    setReason('');
    setReasonMissing(false);
    booking.reset();
  };
  const when =
    startsAt === undefined
      ? ''
      : `${format.dayLong(format.instantDate(startsAt))} ${format.instantTime(startsAt)}`;
  return (
    <form
      noValidate
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (patient === undefined || serviceId === undefined || startsAt === undefined) return;
        const limitOverrideReason = overriding ? noteToSend(reason) : undefined;
        if (overriding && limitOverrideReason === undefined) {
          setReasonMissing(true);
          return;
        }
        booking.mutate(
          {
            practiceId,
            data: {
              patientId: patient.id,
              serviceId,
              startsAt,
              ...doctor,
              ...(limitOverrideReason === undefined ? {} : { limitOverrideReason }),
            },
            headers: { 'Idempotency-Key': key },
          },
          {
            onSuccess: () => {
              onBooked(t('booked', { name: nameOf(patient), when }));
            },
            onError: (error) => {
              // Taken meanwhile: the times are read again, and the team chooses another one.
              if (isApiError(error) && error.code === 'SLOT_NOT_AVAILABLE') {
                setStartsAt(undefined);
                void freeTimes.refetch();
                void availability.refetch();
              }
              // The limit reached: the team may book anyway, with a reason (BR-02).
              if (isApiError(error) && error.code === 'BOOKING_LIMIT_REACHED') setOverriding(true);
            },
          },
        );
      }}
    >
      <section aria-label={t('patient')} className="flex flex-col gap-3">
        <p className={LABEL}>{t('patient')}</p>
        {patient === undefined ? (
          adding && catalog.data !== undefined ? (
            <NewPatient
              insurance={catalog.data.insurance}
              onAdded={(added) => {
                setAdding(false);
                setPatient(added);
                anew();
              }}
              onBack={() => {
                setAdding(false);
              }}
            />
          ) : (
            <FindPatient
              format={format}
              onChoose={(found) => {
                setPatient(found);
                anew();
              }}
              onNew={() => {
                setAdding(true);
              }}
            />
          )
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border-brand bg-bg-brand-subtle px-4 py-2">
            <PatientLine patient={patient} format={format} />
            {given === undefined ? (
              <Button
                variant="ghost"
                onPress={() => {
                  setPatient(undefined);
                  anew();
                }}
              >
                {t('change')}
              </Button>
            ) : null}
          </div>
        )}
      </section>
      <FormError error={catalog.error} />
      <div className="grid grid-cols-1 gap-4 tablet:grid-cols-2">
        <Choice
          label={t('service')}
          value={serviceId}
          placeholder={t('chooseService')}
          onChange={(id) => {
            setServiceId(id);
            setDate(undefined);
            anew();
          }}
          options={services.map(({ id, name, durationMinutes, referralRequired }) => ({
            id,
            label: t(referralRequired ? 'serviceOptionReferral' : 'serviceOption', {
              name: textIn(name, locale),
              minutes: durationMinutes,
            }),
          }))}
        />
        <Choice
          label={t('doctor')}
          value={providerId}
          onChange={(id) => {
            setProviderId(id);
            setDate(undefined);
            anew();
          }}
          options={[
            { id: ANY, label: t('anyDoctor') },
            ...providers.map(({ id, name }) => ({ id, label: name })),
          ]}
        />
      </div>
      {ready ? (
        <div className="grid grid-cols-1 gap-6 desktop:grid-cols-2">
          {availability.data === undefined ? (
            <FormError error={availability.error} />
          ) : (
            <Days
              days={availability.data.days}
              selected={date}
              format={format}
              onSelect={(day) => {
                setDate(day);
                anew();
              }}
            />
          )}
          {date === undefined ? null : (
            <div className="flex flex-col gap-2">
              <p className={LABEL}>{t('times', { day: format.dayLong(date) })}</p>
              {freeTimes.data === undefined ? (
                freeTimes.isPending ? (
                  <p role="status" className="text-body-small text-text-secondary">
                    {t('loadingTimes')}
                  </p>
                ) : (
                  <FormError error={freeTimes.error} />
                )
              ) : (
                <Times
                  times={freeTimes.data.times}
                  selected={startsAt}
                  day={date}
                  format={format}
                  onSelect={(time) => {
                    setStartsAt(time);
                    setKey(crypto.randomUUID());
                    booking.reset();
                  }}
                />
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="text-body-default text-text-secondary">{t('chooseFirst')}</p>
      )}
      <BookingError error={booking.error} />
      {overriding ? (
        <TextAreaField
          label={t('overrideReason')}
          hint={t('overrideHint')}
          value={reason}
          onChange={(value) => {
            setReason(value);
            setReasonMissing(false);
          }}
          maxLength={MAX_REASON_LENGTH}
          isRequired
          error={reasonMissing ? t('required') : undefined}
        />
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border-subtle pt-4">
        {patient === undefined || service === undefined || startsAt === undefined ? null : (
          <p className="me-auto text-body-small text-text-secondary">
            {t('summary', {
              name: nameOf(patient),
              service: isolate(textIn(service.name, locale)),
              when,
              doctor: isolate(doctorName),
            })}
          </p>
        )}
        <Button variant="outline" isDisabled={booking.isPending} onPress={onCancel}>
          {t('cancel')}
        </Button>
        <Button
          type="submit"
          isPending={booking.isPending}
          isDisabled={patient === undefined || startsAt === undefined}
        >
          <CalendarPlus aria-hidden data-icon="inline-start" />
          {overriding ? t('bookAnyway') : t('confirm')}
        </Button>
      </div>
    </form>
  );
}

/**
 * W7: the team books for a patient, on the phone or at the desk: a patient found or added without
 * an account, a service, any doctor or one by name, a free day and time (BR-03 for the team).
 */
export function BookForPatient({
  patient,
  format,
  onBooked,
}: {
  /** The patient of an open record (W8); left out, the dialog asks for one. */
  readonly patient?: BookPatient;
  readonly format: PracticeFormat;
  readonly onBooked: (news: string) => void;
}): ReactNode {
  const t = useTranslations('dashboard.book');
  const { practiceId } = useDesk();
  const queryClient = useQueryClient();
  const [isOpen, setOpen] = useState(false);
  const booking = useBookDeskAppointment({
    mutation: {
      // Its request may hold a reason to book past the limit: kept no longer than the dialog.
      gcTime: 0,
      // Whatever the answer: the day, the lists and the records show what is now there.
      onSettled: () =>
        queryClient.invalidateQueries({
          predicate: ({ queryKey }) => isDeskQueryOf(practiceId, queryKey),
        }),
    },
  });
  return (
    <DialogTrigger
      isOpen={isOpen}
      onOpenChange={(open) => {
        setOpen(open);
        if (!open) booking.reset();
      }}
    >
      <Button>
        <CalendarPlus aria-hidden data-icon="inline-start" />
        {patient === undefined ? t('open') : t('openFor')}
      </Button>
      <DialogContent title={t('title')} size="wide" isDismissable={!booking.isPending}>
        {(close) => (
          <BookingForm
            patient={patient}
            format={format}
            booking={booking}
            onBooked={(news) => {
              close();
              onBooked(news);
            }}
            onCancel={close}
          />
        )}
      </DialogContent>
    </DialogTrigger>
  );
}
