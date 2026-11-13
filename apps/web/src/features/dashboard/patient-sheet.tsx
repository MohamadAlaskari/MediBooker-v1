'use client';

import { useGetDeskPatient, type DeskAppointmentRowDto } from '@medibooker/api-client';
import { isolate } from '@medibooker/i18n';
import { Pencil } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { practiceFormat, type PracticeFormat } from '@/lib/format';
import { FormError } from '../auth/form-parts';
import { textIn } from '../portal/appointment-view';
import { BookForPatient } from './book-for-patient';
import { useDesk } from './desk-context';
import { initialsOf, statusVariantOf } from './desk-view';
import { EditPatient, PatientExport } from './edit-patient';

function Visits({
  title,
  empty,
  rows,
  format,
  onOpen,
}: {
  readonly title: string;
  readonly empty: string;
  readonly rows: readonly DeskAppointmentRowDto[];
  readonly format: PracticeFormat;
  readonly onOpen: (id: string) => void;
}): ReactNode {
  const today = useTranslations('dashboard.today');
  const dashboard = useTranslations('dashboard');
  const locale = useLocale();
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-label-large text-text-primary">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-body-default text-text-secondary">{empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-subtle rounded-lg border border-border-subtle">
          {rows.map((row) => {
            const when = `${format.dayLong(format.instantDate(row.startsAt))} ${format.instantTime(row.startsAt)}`;
            return (
              <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="me-auto min-w-0">
                  <p className="text-label-default text-text-primary">{when}</p>
                  <p className="text-body-small text-text-secondary">
                    <span dir="auto">{textIn(row.serviceName, locale)}</span>
                    {' · '}
                    <span dir="auto">{row.providerName}</span>
                  </p>
                </div>
                <Badge variant={statusVariantOf(row.status)}>
                  {dashboard('status', { status: row.status })}
                </Badge>
                <Button
                  variant="ghost"
                  className="text-text-brand"
                  aria-label={today('rowAction', {
                    action: today('details'),
                    name: when,
                    time: '',
                  })}
                  onPress={() => {
                    onOpen(row.id);
                  }}
                >
                  {today('details')}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** One patient for the team (W8): how to reach them, and what is to come and what was. Audited. */
export function PatientSheet({
  patientId,
  onClose,
  onOpenAppointment,
}: {
  readonly patientId: string | undefined;
  readonly onClose: () => void;
  readonly onOpenAppointment: (id: string) => void;
}): ReactNode {
  const t = useTranslations('dashboard.patients');
  const details = useTranslations('dashboard.details');
  const locale = useLocale();
  const { practiceId, managesPractice } = useDesk();
  const [news, setNews] = useState('');
  const [editing, setEditing] = useState(false);
  const record = useGetDeskPatient(practiceId, patientId ?? '', {
    query: { enabled: patientId !== undefined, retry: false },
  });
  const data = record.data;
  const format = data === undefined ? undefined : practiceFormat(locale, data);
  const patient = data?.patient;
  const title =
    patient === undefined ? t('loadingRecord') : `${patient.firstName} ${patient.lastName}`;
  return (
    <Sheet
      isOpen={patientId !== undefined}
      onOpenChange={(open) => {
        if (!open) {
          setNews('');
          setEditing(false);
          onClose();
        }
      }}
      kicker={t('kicker')}
      title={title}
      closeLabel={details('close')}
    >
      {data === undefined || format === undefined || patient === undefined ? (
        record.isPending ? (
          <p role="status" className="text-body-default text-text-secondary">
            {t('loadingRecord')}
          </p>
        ) : (
          <FormError error={record.error} />
        )
      ) : (
        <>
          <section className="flex flex-wrap items-center gap-4 rounded-lg bg-bg-subtle p-5">
            <span
              aria-hidden
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-bg-brand-subtle text-label-large text-text-brand"
            >
              {initialsOf(patient.firstName, patient.lastName, locale)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-body-default text-text-secondary">
                {t('born', {
                  date: format.calendarDate(patient.dateOfBirth),
                  age: patient.age,
                })}
                {' · '}
                {details('insurance', { type: patient.insuranceType })}
                {patient.insuranceProvider === null ? null : (
                  <>
                    {' · '}
                    <span dir="auto">{patient.insuranceProvider}</span>
                  </>
                )}
              </p>
              {data.insuranceNumberEnd === null ? null : (
                <p className="text-body-default text-text-secondary">
                  {t('insuranceNumber', { end: isolate(data.insuranceNumberEnd) })}
                </p>
              )}
              <dl className="mt-1 flex flex-wrap gap-x-4 text-body-default text-text-secondary">
                {patient.phone === null ? null : (
                  <div className="flex gap-1">
                    <dt>{details('phone')}:</dt>
                    <dd dir="ltr">{patient.phone}</dd>
                  </div>
                )}
                {patient.email === null ? null : (
                  <div className="flex min-w-0 gap-1">
                    <dt>{details('email')}:</dt>
                    <dd dir="ltr" className="truncate">
                      {patient.email}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          </section>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-3">
              <BookForPatient patient={patient} format={format} onBooked={setNews} />
              {/* A profile of an account is the person's to change, through the account. */}
              {data.hasAccount || editing ? null : (
                <Button
                  variant="outline"
                  onPress={() => {
                    setNews('');
                    setEditing(true);
                  }}
                >
                  <Pencil aria-hidden data-icon="inline-start" />
                  {t('edit')}
                </Button>
              )}
            </div>
            <p role="status" className="text-body-default text-text-primary">
              {news}
            </p>
          </div>
          {editing ? (
            <EditPatient
              record={data}
              onSaved={(saved) => {
                setEditing(false);
                setNews(saved);
              }}
              onCancel={() => {
                setEditing(false);
              }}
            />
          ) : null}
          <Visits
            title={t('upcoming')}
            empty={t('nothingUpcoming')}
            rows={data.upcoming}
            format={format}
            onOpen={onOpenAppointment}
          />
          <Visits
            title={t('recent')}
            empty={t('nothingRecent')}
            rows={data.recent}
            format={format}
            onOpen={onOpenAppointment}
          />
          {managesPractice ? <PatientExport patientId={patient.id} onDone={setNews} /> : null}
          <p className="mt-auto text-caption text-text-tertiary">{t('audited')}</p>
        </>
      )}
    </Sheet>
  );
}
