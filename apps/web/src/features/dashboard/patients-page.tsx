'use client';

import {
  useSearchDeskPatients,
  type DeskPatientRowDto,
  type DeskPatientSearchDto,
  type DeskPatientSearchDtoInsuranceType,
} from '@medibooker/api-client';
import { isolate } from '@medibooker/i18n';
import { keepPreviousData } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Label } from 'react-aria-components';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { TextField } from '@/components/ui/text-field';
import { practiceFormat, type PracticeFormat } from '@/lib/format';
import { FormError } from '../auth/form-parts';
import { AppointmentSheet } from './appointment-sheet';
import { useDesk } from './desk-context';
import { initialsOf } from './desk-view';
import { Pager, useCursorPages, useSettled } from './pager';
import { PatientSheet } from './patient-sheet';

const PAGE_SIZE = 20;
const ALL = 'all';
const INSURANCE_TYPES: readonly DeskPatientSearchDtoInsuranceType[] = [
  'PUBLIC',
  'PRIVATE',
  'SELF_PAY',
];
const CELL = 'px-5 py-3 align-middle';

function PatientRow({
  patient,
  format,
  onOpen,
}: {
  readonly patient: DeskPatientRowDto;
  readonly format: PracticeFormat;
  readonly onOpen: () => void;
}): ReactNode {
  const t = useTranslations('dashboard.patients');
  const details = useTranslations('dashboard.details');
  const locale = useLocale();
  const fullName = `${patient.firstName} ${patient.lastName}`;
  const when = (instant: string | null): string =>
    instant === null
      ? t('none')
      : `${format.calendarDate(format.instantDate(instant))} ${format.instantTime(instant)}`;
  return (
    <tr className="border-t border-border-subtle">
      <td className={CELL}>
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-bg-brand-subtle text-label-small text-text-brand"
          >
            {initialsOf(patient.firstName, patient.lastName, locale)}
          </span>
          <div className="min-w-0">
            <p dir="auto" className="text-label-default text-text-primary">
              {fullName}
            </p>
            <p className="text-body-small text-text-secondary">
              {t('born', { date: format.calendarDate(patient.dateOfBirth), age: patient.age })}
            </p>
          </div>
        </div>
      </td>
      <td className={`${CELL} text-body-default whitespace-nowrap text-text-primary`}>
        {patient.phone === null ? t('none') : <span dir="ltr">{patient.phone}</span>}
      </td>
      <td className={`${CELL} text-body-default text-text-primary`}>
        {patient.insuranceProvider === null ? (
          details('insurance', { type: patient.insuranceType })
        ) : (
          <span dir="auto">{patient.insuranceProvider}</span>
        )}
        {patient.hasAccount ? null : (
          <p className="text-body-small text-text-secondary">{t('practiceKept')}</p>
        )}
      </td>
      <td className={`${CELL} text-body-default whitespace-nowrap text-text-secondary`}>
        {when(patient.lastVisitAt)}
      </td>
      <td className={`${CELL} text-body-default whitespace-nowrap text-text-secondary`}>
        {when(patient.nextAppointmentAt)}
      </td>
      <td className={CELL}>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('open', { name: isolate(fullName) })}
          onPress={onOpen}
        >
          <ChevronRight aria-hidden className="rtl:-scale-x-100" />
        </Button>
      </td>
    </tr>
  );
}

/** W8: the patients of the practice, found by name however written, phone, birth or insurance. */
export function PatientsPage(): ReactNode {
  const t = useTranslations('dashboard.patients');
  const details = useTranslations('dashboard.details');
  const locale = useLocale();
  const { practiceId } = useDesk();
  const [search, setSearch] = useState('');
  const [insuranceType, setInsuranceType] = useState(ALL);
  const [patientId, setPatientId] = useState<string | undefined>(undefined);
  const [appointmentId, setAppointmentId] = useState<string | undefined>(undefined);
  const query = useSettled(search.trim());
  const pages = useCursorPages(JSON.stringify([query, insuranceType]));
  // In the body of the search, never in a URL: a name or a number typed here is personal data.
  const body: DeskPatientSearchDto = {
    ...(query.length >= 2 ? { query } : {}),
    ...(insuranceType === ALL
      ? {}
      : { insuranceType: insuranceType as DeskPatientSearchDtoInsuranceType }),
    limit: PAGE_SIZE,
    ...(pages.cursor === undefined ? {} : { cursor: pages.cursor }),
  };
  const list = useSearchDeskPatients(practiceId, body, {
    query: { retry: false, placeholderData: keepPreviousData },
  });
  const data = list.data;
  const format = data === undefined ? undefined : practiceFormat(locale, data);
  const head = 'px-5 py-3 text-start text-body-small';
  return (
    <>
      <header className="mb-6">
        <p className="text-body-default text-text-secondary">
          {data === undefined || format === undefined
            ? String.fromCodePoint(0xa0)
            : t('count', { count: format.number(pages.totalOf(data.total)) })}
        </p>
        <h1 className="text-heading-h1 text-text-primary">{t('title')}</h1>
      </header>
      <section
        aria-label={t('filters')}
        className="mb-6 grid grid-cols-1 gap-4 tablet:grid-cols-[2fr_1fr]"
      >
        <TextField label={t('search')} value={search} onChange={setSearch} />
        <Select
          value={insuranceType}
          onChange={(key) => {
            setInsuranceType(String(key));
          }}
        >
          <Label className="text-label-default text-text-primary">{t('insurance')}</Label>
          <SelectTrigger className="mt-2" />
          <SelectContent>
            <SelectItem id={ALL} textValue={t('allInsurance')}>
              {t('allInsurance')}
            </SelectItem>
            {INSURANCE_TYPES.map((type) => (
              <SelectItem key={type} id={type} textValue={details('insurance', { type })}>
                {details('insurance', { type })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </section>
      <section
        aria-label={t('title')}
        className="rounded-lg border border-border-subtle bg-bg-surface"
      >
        {data === undefined || format === undefined ? (
          list.isPending ? (
            <p role="status" className="p-5 text-body-default text-text-secondary">
              {t('loading')}
            </p>
          ) : (
            <div className="p-5">
              <FormError error={list.error} />
            </div>
          )
        ) : (
          <>
            {data.items.length === 0 ? (
              <p className="p-5 text-body-default text-text-secondary">{t('empty')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[56rem] border-collapse">
                  <thead className="bg-bg-subtle text-text-secondary">
                    <tr>
                      <th scope="col" className={head}>
                        {t('patient')}
                      </th>
                      <th scope="col" className={head}>
                        {t('phone')}
                      </th>
                      <th scope="col" className={head}>
                        {t('insurance')}
                      </th>
                      <th scope="col" className={head}>
                        {t('lastVisit')}
                      </th>
                      <th scope="col" className={head}>
                        {t('nextAppointment')}
                      </th>
                      <th scope="col" className={head}>
                        <span className="sr-only">{t('actions')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((patient) => (
                      <PatientRow
                        key={patient.id}
                        patient={patient}
                        format={format}
                        onOpen={() => {
                          setPatientId(patient.id);
                        }}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pager
              page={pages.page}
              limit={PAGE_SIZE}
              count={data.items.length}
              total={pages.totalOf(data.total)}
              nextCursor={data.nextCursor}
              format={format}
              onNext={(cursor) => {
                pages.next(cursor, data.total);
              }}
              onPrevious={pages.previous}
            />
          </>
        )}
      </section>
      <PatientSheet
        patientId={patientId}
        onClose={() => {
          setPatientId(undefined);
        }}
        onOpenAppointment={(id) => {
          // One drawer at a time: the appointment's takes the place of the patient's.
          setPatientId(undefined);
          setAppointmentId(id);
        }}
      />
      <AppointmentSheet
        appointmentId={appointmentId}
        onClose={() => {
          setAppointmentId(undefined);
        }}
        onDone={() => {
          void list.refetch();
        }}
      />
    </>
  );
}
