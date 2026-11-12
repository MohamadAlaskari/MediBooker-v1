'use client';

import {
  exportDeskPatient,
  isApiError,
  useChangeDeskPatient,
  useGetDeskCatalog,
  type DeskPatientExportDto,
  type DeskPatientRecordDto,
} from '@medibooker/api-client';
import { isolate } from '@medibooker/i18n';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormError } from '../auth/form-parts';
import { useDesk } from './desk-context';
import { changeOf, missingOf, valuesOf } from './patient-change';
import {
  asksOf,
  PATIENT_FIELDS,
  type PatientField,
  PatientFields,
  type PatientValues,
} from './patient-fields';
import { isDeskQueryOf } from './use-desk-change';

/**
 * The team corrects a patient the practice keeps, without an account (RT-97, Art. 16): what the
 * person tells it. A change that makes the profile match another patient asks first, as W7's add.
 */
export function EditPatient({
  record,
  onSaved,
  onCancel,
}: {
  readonly record: DeskPatientRecordDto;
  readonly onSaved: (news: string) => void;
  readonly onCancel: () => void;
}): ReactNode {
  const t = useTranslations('dashboard.patients');
  const book = useTranslations('dashboard.book');
  const { practiceId } = useDesk();
  const queryClient = useQueryClient();
  const catalog = useGetDeskCatalog(practiceId, { query: { retry: false } });
  const save = useChangeDeskPatient({
    mutation: {
      // Its request may hold an insurance number: kept no longer than the form shows it.
      gcTime: 0,
      // Here, not in mutate: the form is gone once the record shows the change.
      onSuccess: () => {
        onSaved(t('saved'));
      },
      onSettled: () =>
        queryClient.invalidateQueries({
          predicate: ({ queryKey }) => isDeskQueryOf(practiceId, queryKey),
        }),
    },
  });
  const [before] = useState(() => valuesOf(record));
  const [values, setValues] = useState<PatientValues>(before);
  // Named here, never sent: an empty name or date of birth is no change the API takes.
  const [missing, setMissing] = useState<readonly PatientField[]>([]);
  const insurance = catalog.data?.insurance;
  if (insurance === undefined) {
    return catalog.isPending ? (
      <p role="status" className="text-body-small text-text-secondary">
        {t('loadingRecord')}
      </p>
    ) : (
      <FormError error={catalog.error} />
    );
  }
  const errorOf = (field: PatientField): string | undefined => {
    if (missing.includes(field)) return book('required');
    if (!isApiError(save.error)) return undefined;
    const problem = save.error.fieldErrors.find((fieldError) => fieldError.field === field);
    if (problem === undefined) return undefined;
    return problem.code === 'REQUIRED' ? book('required') : book('invalid');
  };
  const set = (field: PatientField) => (value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setMissing((current) => current.filter((named) => named !== field));
    // Other details are another question: "save anyway" must not confirm them unseen.
    if (save.error !== null) save.reset();
  };
  const mayExist = isApiError(save.error) && save.error.code === 'PATIENT_MAY_EXIST';
  const known = record.insuranceNumberEnd;
  return (
    <form
      noValidate
      aria-label={t('editTitle')}
      className="flex flex-col gap-4 rounded-lg border border-border-default p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const empty = missingOf(values);
        setMissing(empty);
        if (empty.length > 0) return;
        const change = changeOf(before, values, asksOf(insurance, values.insuranceType));
        if (Object.keys(change).length === 0) {
          onCancel();
          return;
        }
        save.mutate({
          practiceId,
          patientId: record.patient.id,
          // Only after the team saw that the person may be there already, and chose to go on.
          data: { ...change, ...(mayExist ? { confirmDuplicate: true } : {}) },
        });
      }}
    >
      <div>
        <p className="text-label-large text-text-primary">{t('editTitle')}</p>
        <p className="text-body-small text-text-secondary">{t('editHint')}</p>
      </div>
      {mayExist ? (
        <Alert role="alert" className="bg-bg-danger-subtle">
          <AlertDescription className="text-text-danger">{t('mayExist')}</AlertDescription>
        </Alert>
      ) : (
        <FormError error={save.error} fields={[...PATIENT_FIELDS]} />
      )}
      <PatientFields
        insurance={insurance}
        values={values}
        onChange={set}
        errorOf={errorOf}
        numberHint={
          known === null || values.insuranceType !== before.insuranceType
            ? undefined
            : t('numberKeep', { end: isolate(known) })
        }
      />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" isPending={save.isPending}>
          {mayExist ? t('saveAnyway') : t('save')}
        </Button>
        <Button variant="outline" isDisabled={save.isPending} onPress={onCancel}>
          {t('cancelEdit')}
        </Button>
      </div>
    </form>
  );
}

/** Saves the copy as a file: the only place it stays (no cache keeps it). */
function saveFile(copy: DeskPatientExportDto, name: string): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(copy, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

/**
 * GDPR Art. 15: everything the practice keeps about the patient, as a file for an admin, who checks
 * it before handing it over (RT-97). It holds the whole insurance number.
 */
export function PatientExport({
  patientId,
  onDone,
}: {
  readonly patientId: string;
  readonly onDone: (news: string) => void;
}): ReactNode {
  const t = useTranslations('dashboard.patients');
  const { practiceId } = useDesk();
  const copy = useMutation({
    mutationFn: () => exportDeskPatient(practiceId, patientId),
    gcTime: 0,
    onSuccess: (data) => {
      saveFile(data, `patient-${patientId}.json`);
      onDone(t('exported'));
    },
  });
  return (
    <div className="flex flex-col gap-1">
      <div>
        <Button
          variant="outline"
          isPending={copy.isPending}
          onPress={() => {
            copy.mutate();
          }}
        >
          <Download aria-hidden data-icon="inline-start" />
          {t('export')}
        </Button>
      </div>
      <p className="text-body-small text-text-secondary">{t('exportHint')}</p>
      <FormError error={copy.error} />
    </div>
  );
}
