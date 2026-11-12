'use client';

import type { DeskCatalogDto } from '@medibooker/api-client';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Label } from 'react-aria-components';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { TextField } from '@/components/ui/text-field';

export const LABEL = 'text-label-default text-text-primary';

/** A patient's details as the team enters them (BR-10), for an add (W7) and a correction (RT-97). */
export const PATIENT_FIELDS = [
  'firstName',
  'lastName',
  'dateOfBirth',
  'phone',
  'insuranceType',
  'insuranceProvider',
  'insuranceNumber',
] as const;

export type PatientField = (typeof PATIENT_FIELDS)[number];

export type PatientValues = Readonly<Record<PatientField, string>>;

export type InsuranceRules = DeskCatalogDto['insurance'];

/** Whether the practice asks this type for a provider and a number (BR-10). */
export function asksOf(
  insurance: InsuranceRules,
  type: string,
): { readonly provider: boolean; readonly number: boolean } {
  return {
    provider: insurance.providerTypes.some((asked) => asked === type),
    number: insurance.numberTypes.some((asked) => asked === type),
  };
}

export function Choice({
  label,
  value,
  placeholder,
  onChange,
  options,
}: {
  readonly label: string;
  readonly value: string | undefined;
  readonly placeholder?: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly { readonly id: string; readonly label: string }[];
}): ReactNode {
  return (
    <Select
      value={value ?? null}
      placeholder={placeholder}
      onChange={(key) => {
        if (key !== null) onChange(String(key));
      }}
    >
      <Label className={LABEL}>{label}</Label>
      <SelectTrigger className="mt-2" />
      <SelectContent>
        {options.map(({ id, label: text }) => (
          <SelectItem key={id} id={id} textValue={text}>
            <bdi>{text}</bdi>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The fields of a patient's details: the names, the date of birth, a phone, and the insurance as
 * the practice asks for it. `fieldProps` go to every text field, such as a key handler.
 */
export function PatientFields({
  insurance,
  values,
  onChange,
  errorOf,
  numberHint,
  fieldProps = {},
}: {
  readonly insurance: InsuranceRules;
  readonly values: PatientValues;
  readonly onChange: (field: PatientField) => (value: string) => void;
  readonly errorOf: (field: PatientField) => string | undefined;
  /** What the number field says below it, such as which number stays when it is left empty. */
  readonly numberHint?: string;
  readonly fieldProps?: {
    readonly onKeyDown?: (event: {
      readonly key: string;
      readonly preventDefault: () => void;
    }) => void;
  };
}): ReactNode {
  const t = useTranslations('dashboard.book');
  const labels = useTranslations('auth.details');
  const type = values.insuranceType;
  const asks = asksOf(insurance, type);
  return (
    <div className="grid grid-cols-1 gap-4 tablet:grid-cols-2">
      <TextField
        label={labels('firstName')}
        value={values.firstName}
        onChange={onChange('firstName')}
        autoComplete="off"
        {...fieldProps}
        isRequired
        error={errorOf('firstName')}
      />
      <TextField
        label={labels('lastName')}
        value={values.lastName}
        onChange={onChange('lastName')}
        autoComplete="off"
        {...fieldProps}
        isRequired
        error={errorOf('lastName')}
      />
      <TextField
        label={labels('dateOfBirth')}
        hint={t('dateOfBirthHint')}
        value={values.dateOfBirth}
        onChange={onChange('dateOfBirth')}
        autoComplete="off"
        {...fieldProps}
        dir="ltr"
        isRequired
        error={errorOf('dateOfBirth')}
      />
      <TextField
        label={t('phone')}
        value={values.phone}
        onChange={onChange('phone')}
        autoComplete="off"
        {...fieldProps}
        inputMode="tel"
        dir="ltr"
        error={errorOf('phone')}
      />
      <div>
        <Choice
          label={labels('insuranceType')}
          value={type === '' ? undefined : type}
          onChange={onChange('insuranceType')}
          options={insurance.types.map((id) => ({ id, label: labels(id) }))}
        />
        {errorOf('insuranceType') === undefined ? null : (
          <p className="mt-1 text-body-small text-text-danger">{errorOf('insuranceType')}</p>
        )}
      </div>
      {asks.provider ? (
        <TextField
          label={labels('insuranceProvider')}
          value={values.insuranceProvider}
          onChange={onChange('insuranceProvider')}
          autoComplete="off"
          {...fieldProps}
          isRequired
          error={errorOf('insuranceProvider')}
        />
      ) : null}
      {asks.number ? (
        <TextField
          label={labels('insuranceNumber')}
          hint={numberHint}
          value={values.insuranceNumber}
          onChange={onChange('insuranceNumber')}
          autoComplete="off"
          {...fieldProps}
          dir="ltr"
          isRequired={numberHint === undefined}
          error={errorOf('insuranceNumber')}
        />
      ) : null}
    </div>
  );
}
