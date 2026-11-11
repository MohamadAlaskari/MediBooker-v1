'use client';

import { isApiError, type DeskAppointmentRowDto } from '@medibooker/api-client';
import { isolate } from '@medibooker/i18n';
import { useLocale, useTranslations } from 'next-intl';
import { Fragment, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { PracticeFormat } from '@/lib/format';
import { FormError } from '../auth/form-parts';
import { textIn } from '../portal/appointment-view';
import { useDesk } from './desk-context';
import { initialsOf, mainActionOf, statusVariantOf } from './desk-view';
import { useDeskChange } from './use-desk-change';

/** Rows under one heading, such as a day; without a label, rows on their own. */
export interface RowGroup {
  readonly key: string;
  readonly label?: string;
  readonly rows: readonly DeskAppointmentRowDto[];
}

const CELL = 'px-5 py-3 align-middle';
const COLUMNS = 6;

function AppointmentRow({
  row,
  format,
  isPending,
  isBusy,
  onAct,
  onOpen,
}: {
  readonly row: DeskAppointmentRowDto;
  readonly format: PracticeFormat;
  readonly isPending: boolean;
  readonly isBusy: boolean;
  readonly onAct: (action: 'CHECK_IN' | 'COMPLETE') => void;
  readonly onOpen: () => void;
}): ReactNode {
  const t = useTranslations('dashboard.today');
  const dashboard = useTranslations('dashboard');
  const locale = useLocale();
  const { patient } = row;
  const fullName = `${patient.firstName} ${patient.lastName}`;
  const name = isolate(fullName);
  const time = format.instantTime(row.startsAt);
  const main = mainActionOf(row);
  return (
    <tr className="border-t border-border-subtle">
      <td className={`${CELL} text-label-large whitespace-nowrap text-text-primary`}>{time}</td>
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
              {t('patientLine', {
                insurance: patient.insuranceType,
                online: row.bookedOnline ? 'yes' : 'no',
              })}
            </p>
          </div>
        </div>
      </td>
      <td className={`${CELL} text-body-default text-text-primary`}>
        <span dir="auto">{textIn(row.serviceName, locale)}</span>
      </td>
      <td className={`${CELL} text-body-default text-text-secondary`}>
        <span dir="auto">{row.providerName}</span>
      </td>
      <td className={CELL}>
        <Badge variant={statusVariantOf(row.status)}>
          {dashboard('status', { status: row.status })}
        </Badge>
      </td>
      <td className={CELL}>
        <div className="flex justify-end gap-2">
          {main === undefined ? null : (
            <Button
              // A new button for a new change: a second press of "check in" never completes the visit.
              key={main}
              variant="outline"
              isPending={isPending}
              isDisabled={isBusy}
              aria-label={t('rowAction', {
                action: t(main === 'CHECK_IN' ? 'checkIn' : 'complete'),
                name,
                time,
              })}
              onPress={() => {
                onAct(main);
              }}
            >
              {t(main === 'CHECK_IN' ? 'checkIn' : 'complete')}
            </Button>
          )}
          <Button
            variant="ghost"
            className="text-text-brand"
            aria-label={t('rowAction', { action: t('details'), name, time })}
            onPress={onOpen}
          >
            {t('details')}
          </Button>
        </div>
      </td>
    </tr>
  );
}

/**
 * The appointments of the team in rows (W1, W5): who, what, with whom and in which status, the change
 * a row offers at once, and its details. A change that another member made first says so.
 */
export function AppointmentTable({
  groups,
  format,
  onOpen,
  onDone,
}: {
  readonly groups: readonly RowGroup[];
  readonly format: PracticeFormat;
  readonly onOpen: (id: string) => void;
  readonly onDone: (news: string) => void;
}): ReactNode {
  const t = useTranslations('dashboard.today');
  const { practiceId } = useDesk();
  const change = useDeskChange(practiceId);
  const stale = isApiError(change.error, 'INVALID_STATUS_TRANSITION');
  const head = 'px-5 py-3 text-start text-body-small';
  return (
    <>
      <div className="px-5">
        {stale ? (
          <p role="alert" className="pb-4 text-body-default text-text-danger">
            {t('stale')}
          </p>
        ) : (
          <FormError error={change.error} />
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] border-collapse">
          <thead className="bg-bg-subtle text-text-secondary">
            <tr>
              <th scope="col" className={head}>
                {t('time')}
              </th>
              <th scope="col" className={head}>
                {t('patient')}
              </th>
              <th scope="col" className={head}>
                {t('service')}
              </th>
              <th scope="col" className={head}>
                {t('doctor')}
              </th>
              <th scope="col" className={head}>
                {t('status')}
              </th>
              <th scope="col" className={head}>
                <span className="sr-only">{t('actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map(({ key, label, rows }) => (
              <Fragment key={key}>
                {label === undefined ? null : (
                  <tr className="border-t border-border-subtle bg-bg-subtle">
                    <th
                      scope="colgroup"
                      colSpan={COLUMNS}
                      className="px-5 py-2 text-start text-label-default text-text-secondary"
                    >
                      {label}
                    </th>
                  </tr>
                )}
                {rows.map((row) => (
                  <AppointmentRow
                    key={row.id}
                    row={row}
                    format={format}
                    isPending={change.isPending && change.variables.appointmentId === row.id}
                    isBusy={change.isPending}
                    onOpen={() => {
                      onOpen(row.id);
                    }}
                    onAct={(action) => {
                      change.mutate(
                        { action, appointmentId: row.id },
                        {
                          onSuccess: () => {
                            const name = isolate(
                              `${row.patient.firstName} ${row.patient.lastName}`,
                            );
                            onDone(t('done', { action, name }));
                          },
                        },
                      );
                    }}
                  />
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
